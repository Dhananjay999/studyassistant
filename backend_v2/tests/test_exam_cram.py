"""Cram mode for exams within two days (3.3b, 2026-10-16)."""

from aeva.exam_prep.exam_prep_service import CRAM_DAYS, cram_note, is_cram


class TestCram:
    def test_two_days_or_less_is_a_cram(self):
        assert is_cram(0)
        assert is_cram(1)
        assert is_cram(CRAM_DAYS)
        assert not is_cram(CRAM_DAYS + 1)

    def test_note_names_the_day_and_the_time_budget(self):
        assert "TODAY" in cram_note(0, 90)
        assert "TOMORROW" in cram_note(1, 90)
        assert "in 2 days" in cram_note(2, 90)
        assert "90 minutes" in cram_note(1, 90)
        assert "Mock test" in cram_note(1, 90)
