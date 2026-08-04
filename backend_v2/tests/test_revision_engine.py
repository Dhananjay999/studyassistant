"""Unit tests for the pure spaced-repetition engine."""

from datetime import UTC, date, datetime, timedelta

from aeva.revision import revision_engine as engine
from aeva.revision.revision_engine import RevisionConfig

CFG = RevisionConfig()
NOW = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)


class TestNormalizeTopic:
    def test_collapses_case_and_whitespace(self):
        assert engine.normalize_topic("  SQL   Joins ") == (
            "SQL Joins",
            "sql joins",
        )

    def test_empty_falls_back_to_general(self):
        assert engine.normalize_topic(None) == ("General", "general")
        assert engine.normalize_topic("   ") == ("General", "general")


class TestParseIntervals:
    def test_parses_ladder(self):
        assert engine.parse_intervals("1,3,7") == (1, 3, 7)

    def test_garbage_falls_back_to_default(self):
        assert engine.parse_intervals("nope") == (1, 3, 7, 14, 30)
        assert engine.parse_intervals("") == (1, 3, 7, 14, 30)


class TestApplySignal:
    def test_good_quiz_steps_up(self):
        up = engine.apply_signal(1, {"kind": "quiz", "score": 85}, CFG, NOW)
        assert up.strength == 2
        assert up.status == "reviewing"
        assert up.due_at == NOW + timedelta(days=7)

    def test_ok_quiz_repeats_interval(self):
        up = engine.apply_signal(2, {"kind": "quiz", "score": 70}, CFG, NOW)
        assert up.strength == 2

    def test_bad_quiz_drops_two_and_floors_at_zero(self):
        assert (
            engine.apply_signal(
                3, {"kind": "quiz", "score": 40}, CFG, NOW
            ).strength
            == 1
        )
        down = engine.apply_signal(1, {"kind": "quiz", "score": 40}, CFG, NOW)
        assert down.strength == 0
        assert down.status == "learning"

    def test_positive_signal_at_top_masters(self):
        up = engine.apply_signal(
            CFG.max_strength, {"kind": "quiz", "score": 95}, CFG, NOW
        )
        assert up.strength == CFG.max_strength
        assert up.status == "mastered"

    def test_flashcard_quality_thresholds(self):
        assert (
            engine.apply_signal(
                1, {"kind": "flashcards", "quality": 0.8}, CFG, NOW
            ).strength
            == 2
        )
        assert (
            engine.apply_signal(
                1, {"kind": "flashcards", "quality": 0.5}, CFG, NOW
            ).strength
            == 1
        )
        assert (
            engine.apply_signal(
                1, {"kind": "flashcards", "quality": 0.3}, CFG, NOW
            ).strength
            == 0
        )

    def test_confidence_mastered_jumps_two(self):
        up = engine.apply_signal(
            2, {"kind": "confidence", "confidence": "mastered"}, CFG, NOW
        )
        assert up.strength == 4
        assert up.status == "mastered"

    def test_confidence_confused_resets(self):
        up = engine.apply_signal(
            4, {"kind": "confidence", "confidence": "confused"}, CFG, NOW
        )
        assert up.strength == 0
        assert up.status == "learning"
        assert up.due_at == NOW + timedelta(days=1)


class TestSeedStrength:
    def test_quiz_thresholds(self):
        assert engine.seed_strength(CFG, quiz_score=90) == 2
        assert engine.seed_strength(CFG, quiz_score=65) == 1
        assert engine.seed_strength(CFG, quiz_score=30) == 0

    def test_flashcard_thresholds(self):
        assert engine.seed_strength(CFG, flashcard_quality=0.8) == 2
        assert engine.seed_strength(CFG, flashcard_quality=0.5) == 1
        assert engine.seed_strength(CFG, flashcard_quality=0.2) == 0

    def test_best_signal_wins(self):
        assert (
            engine.seed_strength(CFG, quiz_score=30, flashcard_quality=0.9) == 2
        )


class TestBatchQuality:
    def test_mean_of_known_ratings(self):
        assert engine.batch_quality(["easy", "needs_revision"]) == 0.5

    def test_empty_is_zero(self):
        assert engine.batch_quality([]) == 0.0
        assert engine.batch_quality(["bogus"]) == 0.0


class TestLocalDayBounds:
    def test_utc(self):
        start, end = engine.local_day_bounds(0, NOW)
        assert start == datetime(2026, 8, 4, tzinfo=UTC)
        assert end == datetime(2026, 8, 5, tzinfo=UTC)

    def test_ist_offset(self):
        # 04:00 UTC on Aug 4 = 09:30 IST Aug 4; local day starts at
        # midnight IST = 18:30 UTC Aug 3.
        now = datetime(2026, 8, 4, 4, 0, tzinfo=UTC)
        start, end = engine.local_day_bounds(330, now)
        assert start == datetime(2026, 8, 3, 18, 30, tzinfo=UTC)
        assert end == datetime(2026, 8, 4, 18, 30, tzinfo=UTC)

    def test_negative_offset(self):
        # 02:00 UTC Aug 4 = 22:00 Aug 3 in UTC-4; local day is Aug 3.
        now = datetime(2026, 8, 4, 2, 0, tzinfo=UTC)
        start, _ = engine.local_day_bounds(-240, now)
        assert start == datetime(2026, 8, 3, 4, 0, tzinfo=UTC)


class TestBuildReason:
    def test_weak_quiz_wins(self):
        action, reason = engine.build_reason(
            {
                "last_quiz_score": 58,
                "last_quiz_at": (NOW - timedelta(days=3)).isoformat(),
            },
            CFG,
            NOW,
        )
        assert action == "quiz"
        assert reason == "You scored 58% 3 days ago"

    def test_confused_recommends_review(self):
        action, reason = engine.build_reason(
            {"last_confidence": "confused"}, CFG, NOW
        )
        assert action == "review"
        assert "confusing" in reason

    def test_stale_uses_available_source(self):
        item = {
            "last_reviewed_at": (NOW - timedelta(days=7)).isoformat(),
            "sources": {"set_id": "abc"},
        }
        action, reason = engine.build_reason(item, CFG, NOW)
        assert action == "flashcards"
        assert reason == "Not reviewed for 7 days"


class TestBucketize:
    def _item(self, **kw):
        base = {
            "id": "i1",
            "topic": "T",
            "status": "reviewing",
            "strength": 1,
            "due_at": NOW.isoformat(),
            "updated_at": NOW.isoformat(),
            "sources": {},
        }
        base.update(kw)
        return base

    def test_weak_overdue_is_urgent(self):
        item = self._item(
            due_at=(NOW - timedelta(days=1)).isoformat(),
            last_quiz_score=40,
        )
        buckets = engine.bucketize([item], CFG, NOW)
        assert len(buckets["needs_revision"]) == 1

    def test_mildly_overdue_strong_is_due_today(self):
        item = self._item(
            due_at=(NOW - timedelta(days=1)).isoformat(),
            last_quiz_score=90,
        )
        buckets = engine.bucketize([item], CFG, NOW)
        assert len(buckets["needs_revision"]) == 0
        assert len(buckets["due_today"]) == 1

    def test_deep_overdue_is_urgent_even_if_strong(self):
        item = self._item(
            due_at=(NOW - timedelta(days=5)).isoformat(),
            last_quiz_score=90,
        )
        buckets = engine.bucketize([item], CFG, NOW)
        assert len(buckets["needs_revision"]) == 1

    def test_future_due_is_hidden(self):
        item = self._item(due_at=(NOW + timedelta(days=3)).isoformat())
        buckets = engine.bucketize([item], CFG, NOW)
        assert not any(buckets.values())

    def test_recent_mastered_bucket(self):
        item = self._item(status="mastered")
        buckets = engine.bucketize([item], CFG, NOW)
        assert len(buckets["recently_mastered"]) == 1

    def test_old_mastered_is_hidden(self):
        item = self._item(
            status="mastered",
            updated_at=(NOW - timedelta(days=30)).isoformat(),
            due_at=(NOW + timedelta(days=30)).isoformat(),
        )
        buckets = engine.bucketize([item], CFG, NOW)
        assert not any(buckets.values())

    def test_urgent_sorted_most_overdue_first(self):
        a = self._item(
            id="a",
            due_at=(NOW - timedelta(days=2)).isoformat(),
            last_quiz_score=50,
        )
        b = self._item(
            id="b",
            due_at=(NOW - timedelta(days=6)).isoformat(),
            last_quiz_score=50,
        )
        buckets = engine.bucketize([a, b], CFG, NOW)
        assert [i["id"] for i in buckets["needs_revision"]] == ["b", "a"]


class TestStreak:
    def test_counts_back_from_today(self):
        today = date(2026, 8, 4)
        active = {today, today - timedelta(days=1), today - timedelta(days=2)}
        assert engine.streak_from_days(active, today) == 3

    def test_yesterday_keeps_streak_alive(self):
        today = date(2026, 8, 4)
        active = {today - timedelta(days=1), today - timedelta(days=2)}
        assert engine.streak_from_days(active, today) == 2

    def test_gap_breaks_streak(self):
        today = date(2026, 8, 4)
        active = {today, today - timedelta(days=2)}
        assert engine.streak_from_days(active, today) == 1

    def test_empty(self):
        assert engine.streak_from_days(set(), date(2026, 8, 4)) == 0
