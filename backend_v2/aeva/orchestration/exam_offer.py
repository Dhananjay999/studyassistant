"""Exam-soon hand-off: spot "my exam is tomorrow" in a chat message.

Students state their deadline in chat ("tommorow is my sst exam", "paper on
Monday", "kal exam hai") and the exam-prep feature never hears about it. This
module turns such a message into a small *offer* the client renders as a
one-screen cram setup card, next to the normal answer.

Everything here is deterministic: regular expressions over the message, no
LLM call. The detector is deliberately conservative. It needs an exam noun
AND a near date in the same sentence, close together, and it backs off on
past tense ("I had an exam last week"), negation ("no exam tomorrow"),
verb uses of "test" ("test me today") and exam paperwork ("exam pattern",
"exam form"). A miss costs nothing (the answer is unchanged); a false offer
is a card the student has to dismiss.

The date is returned as a *hint* (kind + offset / weekday / day-month), not
as a resolved calendar date: the server runs in UTC and the student's
"tomorrow" is a local day, so the client resolves the hint on its own clock.

``for_turn`` is the one call the orchestrator makes. It adds the two checks
that need the request: the ``exam_prep`` feature flag, and that the student
has no active plan (creating a plan archives the active one, so an offer is
only safe when there is none). Both run only after the detector matched, so
an ordinary turn pays nothing.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from aeva.feature_flag import feature_flag_service
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# How far ahead still counts as "soon".
MAX_DAYS_AHEAD = 7
# Longer messages are pasted material or a detailed request, not a deadline.
MAX_WORDS = 40
# Exam noun and date must sit this close together (characters between them).
MAX_GAP_CHARS = 48

KIND_TODAY = "today"
KIND_TOMORROW = "tomorrow"
KIND_IN_DAYS = "in_days"
KIND_WEEKDAY = "weekday"
KIND_DATE = "date"

_SENTENCE_SPLIT_RE = re.compile(r"[.!?;\n]+(?:\s+|$)")
_WORD_RE = re.compile(r"[^\s,]+")

# --------------------------------------------------------------- exam nouns

_NOUN_RE = re.compile(
    r"\b(exams?|examinations?|papers?|tests?|boards|pre-?boards?|finals|"
    r"midterms?|mid-?sems?|end-?sems?|viva|olympiad|pariksha|imtihan|"
    r"examen|contr[oô]o?les?|partiels?)\b"
)
# "exam pattern", "exam form": paperwork about an exam, not a deadline.
_NOUN_PAPERWORK_RE = re.compile(
    r"\s+(?:pattern|forms?|fees?|centres?|centers?|syllabus|results?|"
    r"notification|hall\s*ticket|admit|dates?|schedule|time\s*table|"
    r"timetable|registration)\b"
)
# "test me", "to test this": the verb, not an exam.
_TEST_VERB_BEFORE = frozenset({
    "to", "you", "u", "please", "pls", "plz", "lets", "let's", "can",
    "could", "wanna",
})
_TEST_VERB_AFTER_RE = re.compile(
    r"\s+(?:me|my|this|that|it|us|our|your|yourself|myself|the\s+app)\b"
)
# "make a test", "give me a practice test": a request for a quiz. Plain
# "give" / "take" stay out: "I have to give my maths test tomorrow" is how
# many students say they will sit one.
_TEST_REQUEST_RE = re.compile(
    r"\b(?:make|create|generate|start|conduct|banao|bana)\s+"
    r"(?:me\s+)?(?:an?\s+|one\s+|my\s+)?(?:\w+\s+){0,2}tests?\b|"
    r"\bgive\s+me\s+(?:an?\s+|one\s+)?(?:\w+\s+){0,2}tests?\b|"
    r"\bpractice\s+tests?\b"
)
# A "paper" that is not an exam paper.
_PAPER_NOT_EXAM_RE = re.compile(
    r"\b(?:research|term\s+paper|news\s*paper|white\s+paper|paper\s*work|"
    r"submit|submission|publish|presentation|writ(?:e|ing)\s+a\s+paper|"
    r"question\s+papers?|sample\s+papers?|previous\s+year|solve|solved)\b"
)

# -------------------------------------------------------------- date hints

_NUMBER_WORDS = {
    "a": 1, "one": 1, "ek": 1, "two": 2, "do": 2, "three": 3, "teen": 3,
    "four": 4, "char": 4, "chaar": 4, "five": 5, "paanch": 5, "panch": 5,
    "six": 6, "seven": 7,
}
_NUM = r"(\d{1,2}|a|one|two|three|four|five|six|seven)"
_HINDI_NUM = r"(\d{1,2}|ek|do|teen|cha?ar|pa?anch)"

_DAY_AFTER_RE = re.compile(
    r"\b(?:day\s+after\s+to?m+o?r+o?w+|parso|parson|parsu|overmorrow|"
    r"apr[eè]s[- ]demain)\b"
)
_TOMORROW_RE = re.compile(
    r"\b(?:to?m+o?r+o?w+|tmr|tmw|tomo|2mor+ow?|2mrw|2moro|demain|kal)\b"
)
_TODAY_RE = re.compile(r"\b(?:today|tonight|aaj|aj|aujourd'?hui)\b")
_IN_DAYS_RES = (
    re.compile(rf"\bin\s+{_NUM}\s+(?:more\s+)?days?\b"),
    re.compile(rf"\bafter\s+{_NUM}\s+days?\b"),
    re.compile(
        rf"\b{_NUM}\s+(?:more\s+)?days?\s+"
        r"(?:left|to\s+go|away|remaining|later|baad|bache|baa?ki|me|mein)\b"
    ),
    re.compile(
        rf"\b{_HINDI_NUM}\s+din\s+(?:baad|me|mein|bache|bacha|baa?ki)\b"
    ),
)
_IN_A_WEEK_RE = re.compile(r"\bin\s+(?:a|one|1)\s+week\b")

_WEEKDAYS = {
    "monday": 0, "somvar": 0, "somwar": 0,
    "tuesday": 1, "tues": 1, "mangalvar": 1, "mangalwar": 1,
    "wednesday": 2, "budhvar": 2, "budhwar": 2,
    "thursday": 3, "thurs": 3, "guruvar": 3, "guruwar": 3,
    "friday": 4, "shukravar": 4, "shukrawar": 4,
    "saturday": 5, "shanivar": 5, "shaniwar": 5,
    "sunday": 6, "ravivar": 6, "raviwar": 6, "itwar": 6,
}
_WEEKDAY_RE = re.compile(
    r"\b(?:(?:this|next|coming)\s+)?(" + "|".join(_WEEKDAYS) + r")\b"
)

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH = (
    r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)"
)
_ORD = r"(?:st|nd|rd|th)"
_DAY_MONTH_RE = re.compile(
    rf"\b(\d{{1,2}}){_ORD}?\s*(?:of\s+)?{_MONTH}\b(?:,?\s*(\d{{4}}))?"
)
_MONTH_DAY_RE = re.compile(
    rf"\b{_MONTH}\s+(\d{{1,2}}){_ORD}?\b(?:,?\s*(\d{{4}}))?"
)
_ON_ORDINAL_RE = re.compile(rf"\bon\s+(?:the\s+)?(\d{{1,2}}){_ORD}\b")
_ON_NUMERIC_RE = re.compile(
    r"\bon\s+(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b"
)
_CENTURY = 2000
_TWO_DIGIT_YEARS = 100

# ------------------------------------------------------- scoped rejections

# Negation is checked only where it negates the exam itself, so "I have not
# studied and my exam is tomorrow" still counts.
_NEG = r"(?:no|not|never|nahi|nahin|nhi|nai)"
_DET = r"(?:an?\s+|any\s+|my\s+|the\s+|our\s+)?"
_CONTRACTED = "(?:do|does|did|is|are|am|was|wo|ca|have|has)n['\u2019]?t"
# Anywhere between the noun and the date: "exam is not tomorrow".
_NEGATION_BETWEEN_RE = re.compile(rf"\b(?:{_NEG}|pas|{_CONTRACTED})\b")
# Right before the noun: "no maths exam", "not an exam".
_NEGATION_DIRECT_RE = re.compile(
    rf"\b(?:no\s+{_DET}(?:\w+\s+)?|(?:not|never)\s+{_DET})$"
)
# "don't have an exam", "not giving any test".
_NEGATION_HAVE_RE = re.compile(
    rf"\b(?:{_NEG}|{_CONTRACTED})\s+"
    r"(?:have|having|got|giving|writing|taking|sitting)\s+"
    rf"{_DET}(?:\w+\s+)?$"
)
# Hindi negates after the verb phrase: "kal exam nahi hai".
_NEGATION_AFTER_RE = re.compile(r"^\s*(?:hai\s+)?(?:nahi|nahin|nhi|nai)\b")
_PAST_RE = re.compile(
    r"\b(?:had|was|were|gave|given|wrote|written|took|taken|finished|"
    r"completed|went|ended|done|yesterday|ago|previous|"
    r"(?:is|are|got)\s+over|last\s+(?:week|month|year|time|night)|"
    r"tha|thi|hua|hui|gaya|gayi|gya|diya|khatam|hier|[eé]tait)\b"
)
# Words of context checked for past tense around the noun/date pair.
_PAST_AROUND = 4

# -------------------------------------------------------- name and subjects

_SUBJECT_ALIASES: dict[str, str] = {
    "social science": "Social Science",
    "social studies": "Social Science",
    "sst": "Social Science",
    "s.st": "Social Science",
    "computer science": "Computer Science",
    "computers": "Computer Science",
    "computer": "Computer Science",
    "political science": "Political Science",
    "pol sci": "Political Science",
    "business studies": "Business Studies",
    "bst": "Business Studies",
    "physical education": "Physical Education",
    "environmental science": "EVS",
    "environmental studies": "EVS",
    "evs": "EVS",
    "mathematics": "Mathematics",
    "maths": "Mathematics",
    "math": "Mathematics",
    "physics": "Physics",
    "phy": "Physics",
    "chemistry": "Chemistry",
    "chem": "Chemistry",
    "biology": "Biology",
    "bio": "Biology",
    "science": "Science",
    "history": "History",
    "geography": "Geography",
    "geo": "Geography",
    "civics": "Civics",
    "economics": "Economics",
    "eco": "Economics",
    "english": "English",
    "hindi": "Hindi",
    "sanskrit": "Sanskrit",
    "accountancy": "Accountancy",
    "accounts": "Accountancy",
    "accounting": "Accountancy",
    "psychology": "Psychology",
    "sociology": "Sociology",
    "statistics": "Statistics",
    "stats": "Statistics",
}
_SUBJECT_RE = re.compile(
    r"\b("
    + "|".join(
        re.escape(alias)
        for alias in sorted(_SUBJECT_ALIASES, key=len, reverse=True)
    )
    + r")\b"
)
_MAX_SUBJECTS = 4

_EXAM_TYPE_RE = re.compile(
    r"\b(half[- ]yearly|annual|final|pre[- ]?board|board|mid[- ]?term|"
    r"mid[- ]?sem(?:ester)?|end[- ]?sem(?:ester)?|semester|sem|unit|"
    r"internal|term|monthly|weekly|periodic|entrance|mock|practical)\b"
)
# Named exams, kept so the client can apply its own "not supported yet" rule.
_NAMED_EXAM_RE = re.compile(
    r"\b(jee|neet|upsc|ssc|cgl|cuet|nda|clat|ibps|gmat|gre|ielts|toefl|"
    r"cbse|icse|hsc|sslc|ntse|bitsat)\b"
)
# Words before the noun that may describe it ("my class 10 sst board").
_QUALIFIER_WORDS = 5
# Words after the noun that may ("exam of physics", "test in maths").
_TRAILING_WORDS = 3
_NOUN_LABEL = {
    "exam": "exam", "exams": "exams", "examination": "exam",
    "examinations": "exams", "paper": "paper", "papers": "papers",
    "test": "test", "tests": "tests", "boards": "board exams",
    "preboard": "pre-board", "pre-board": "pre-board",
    "preboards": "pre-boards", "pre-boards": "pre-boards",
    "finals": "final exams", "midterm": "midterm", "midterms": "midterms",
    "viva": "viva", "olympiad": "Olympiad", "pariksha": "exam",
    "imtihan": "exam", "examen": "exam",
}


@dataclass(frozen=True)
class DateHint:
    """A near date as the student said it (resolved by the client)."""

    kind: str
    start: int
    end: int
    days_ahead: int | None = None
    # Monday = 0, matching ``date.weekday()``.
    weekday: int | None = None
    day: int | None = None
    month: int | None = None
    year: int | None = None
    # The word itself is ambiguous about past/future ("kal", "parso").
    tense_ambiguous: bool = False


@dataclass(frozen=True)
class ExamOffer:
    """What the cram setup card is prefilled with."""

    date_hint: DateHint
    exam_name: str | None = None
    subjects: list[str] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        """JSON for the client (``content.exam_prep_offer``)."""
        hint = self.date_hint
        return {
            "exam_name": self.exam_name,
            # The hint kind is an enum, safe to report as an analytics prop.
            "date_hint": hint.kind,
            "days_ahead": hint.days_ahead,
            "weekday": hint.weekday,
            "day": hint.day,
            "month": hint.month,
            "year": hint.year,
            "subjects": list(self.subjects),
        }


# ------------------------------------------------------------------ dates


def _number(token: str) -> int | None:
    """Read a small count written as digits or as a word."""
    if token.isdigit():
        return int(token)
    return _NUMBER_WORDS.get(token)


def _month_number(token: str) -> int:
    return _MONTHS[token[:3]]


def _full_year(token: str) -> int:
    """Read "26" or "2026" as a year."""
    year = int(token)
    return year + _CENTURY if year < _TWO_DIGIT_YEARS else year


def _relative_hints(sentence: str) -> list[DateHint]:
    """Today / tomorrow / "in N days" expressions in the sentence."""
    hints = [
        DateHint(
            KIND_IN_DAYS, m.start(), m.end(), days_ahead=2,
            tense_ambiguous=m.group(0).startswith("pars"),
        )
        for m in _DAY_AFTER_RE.finditer(sentence)
    ]
    for regex in _IN_DAYS_RES:
        hints.extend(
            DateHint(
                KIND_IN_DAYS, m.start(), m.end(),
                days_ahead=_number(m.group(1)),
            )
            for m in regex.finditer(sentence)
            if _number(m.group(1))
        )
    hints.extend(
        DateHint(KIND_IN_DAYS, m.start(), m.end(), days_ahead=7)
        for m in _IN_A_WEEK_RE.finditer(sentence)
    )
    hints.extend(
        DateHint(
            KIND_TOMORROW, m.start(), m.end(), days_ahead=1,
            tense_ambiguous=m.group(0) == "kal",
        )
        for m in _TOMORROW_RE.finditer(sentence)
    )
    hints.extend(
        DateHint(KIND_TODAY, m.start(), m.end(), days_ahead=0)
        for m in _TODAY_RE.finditer(sentence)
    )
    return hints


def _calendar_hints(sentence: str) -> list[DateHint]:
    """Explicit dates and weekday names in the sentence."""
    hints = [
        DateHint(
            KIND_DATE, m.start(), m.end(),
            day=int(m.group(1)), month=_month_number(m.group(2)),
            year=int(m.group(3)) if m.group(3) else None,
        )
        for m in _DAY_MONTH_RE.finditer(sentence)
    ]
    hints.extend(
        DateHint(
            KIND_DATE, m.start(), m.end(),
            day=int(m.group(2)), month=_month_number(m.group(1)),
            year=int(m.group(3)) if m.group(3) else None,
        )
        for m in _MONTH_DAY_RE.finditer(sentence)
    )
    hints.extend(
        DateHint(
            KIND_DATE, m.start(), m.end(),
            day=int(m.group(1)), month=int(m.group(2)),
            year=_full_year(m.group(3)) if m.group(3) else None,
        )
        for m in _ON_NUMERIC_RE.finditer(sentence)
    )
    hints.extend(
        DateHint(KIND_DATE, m.start(), m.end(), day=int(m.group(1)))
        for m in _ON_ORDINAL_RE.finditer(sentence)
    )
    hints.extend(
        DateHint(
            KIND_WEEKDAY, m.start(), m.end(), weekday=_WEEKDAYS[m.group(1)]
        )
        for m in _WEEKDAY_RE.finditer(sentence)
    )
    return hints


def _date_hints(sentence: str) -> list[DateHint]:
    """List every date expression in the sentence (overlaps resolved)."""
    return _drop_overlaps(_relative_hints(sentence) + _calendar_hints(sentence))


def _drop_overlaps(hints: list[DateHint]) -> list[DateHint]:
    """Keep the longest reading of each stretch ("day after tomorrow")."""
    kept: list[DateHint] = []
    for hint in sorted(hints, key=lambda h: h.start - h.end):
        if all(hint.end <= k.start or hint.start >= k.end for k in kept):
            kept.append(hint)
    return kept


def _calendar_date(hint: DateHint, today: date) -> date | None:
    """Return the next calendar date a ``date`` hint can mean, if any."""
    grace = today - timedelta(days=1)
    if hint.month is None:
        # "on the 15th": this month, else next month.
        for offset in (0, 1):
            month = today.month + offset
            year = today.year + (month - 1) // 12
            try:
                candidate = date(year, (month - 1) % 12 + 1, hint.day or 0)
            except ValueError:
                continue
            if candidate >= grace:
                return candidate
        return None
    years = [hint.year] if hint.year else [today.year, today.year + 1]
    for year in years:
        try:
            candidate = date(year, hint.month, hint.day or 0)
        except ValueError:
            continue
        if candidate >= grace:
            return candidate
    return None


def days_until(hint: DateHint, today: date) -> int | None:
    """Days from ``today`` to the hinted date, or None when it has no date."""
    if hint.days_ahead is not None:
        return hint.days_ahead
    if hint.kind == KIND_WEEKDAY and hint.weekday is not None:
        # A named weekday is the next one; the same weekday is a week away.
        return (hint.weekday - today.weekday() - 1) % 7 + 1
    if hint.kind == KIND_DATE:
        target = _calendar_date(hint, today)
        # One day of grace: the student's "today" can be the server's
        # yesterday.
        return None if target is None else max((target - today).days, 0)
    return None


# ------------------------------------------------------------------ nouns


def _words_before(sentence: str, index: int, count: int) -> list[str]:
    return _WORD_RE.findall(sentence[:index])[-count:]


def _words_after(sentence: str, index: int, count: int) -> list[str]:
    return _WORD_RE.findall(sentence[index:])[:count]


def _is_exam_noun(sentence: str, match: re.Match[str]) -> bool:
    """Whether this noun match names an exam the student will sit."""
    word = match.group(1)
    rest = sentence[match.end():]
    if _NOUN_PAPERWORK_RE.match(rest):
        return False
    if word.startswith("test"):
        before = _words_before(sentence, match.start(), 1)
        if before and before[0] in _TEST_VERB_BEFORE:
            return False
        if _TEST_VERB_AFTER_RE.match(rest):
            return False
        if _TEST_REQUEST_RE.search(sentence):
            return False
    return not (
        word.startswith("paper") and _PAPER_NOT_EXAM_RE.search(sentence)
    )


def _negated(
    sentence: str, noun: re.Match[str], hint: DateHint
) -> bool:
    """Whether the sentence says there is NO exam on that date."""
    first_end = min(noun.end(), hint.end)
    second_start = max(noun.start(), hint.start)
    if _NEGATION_BETWEEN_RE.search(sentence[first_end:second_start]):
        return True
    before_noun = sentence[: noun.start()]
    if _NEGATION_DIRECT_RE.search(before_noun) or _NEGATION_HAVE_RE.search(
        before_noun
    ):
        return True
    return bool(
        _NEGATION_AFTER_RE.match(sentence[max(noun.end(), hint.end) :])
    )


def _rejected(sentence: str, noun: re.Match[str], hint: DateHint) -> bool:
    """Negated ("no exam tomorrow") or already over ("had a test today")."""
    if _negated(sentence, noun, hint):
        return True
    # "Tomorrow" and "in 2 days" are future by themselves; a day name, a
    # date, "today" and the Hindi "kal" / "parso" can also be past.
    if hint.kind in (KIND_TOMORROW, KIND_IN_DAYS) and not hint.tense_ambiguous:
        return False
    start = min(noun.start(), hint.start)
    end = max(noun.end(), hint.end)
    around = " ".join([
        *_words_before(sentence, start, _PAST_AROUND),
        sentence[start:end],
        *_words_after(sentence, end, _PAST_AROUND),
    ])
    return bool(_PAST_RE.search(around))


# ----------------------------------------------------------- name, subjects


def _subjects(context: str) -> list[str]:
    found: list[str] = []
    for match in _SUBJECT_RE.finditer(context):
        subject = _SUBJECT_ALIASES[match.group(1)]
        if subject not in found:
            found.append(subject)
    return found[:_MAX_SUBJECTS]


def _exam_name(context: str, noun: str, subjects: list[str]) -> str | None:
    """Build a short editable name ("Physics unit test"), None if unknown."""
    label = _NOUN_LABEL.get(noun, "exam")
    named = _NAMED_EXAM_RE.search(context)
    if named:
        return f"{named.group(1).upper()} {label}"
    kind = _EXAM_TYPE_RE.search(context)
    parts = [subjects[0]] if len(subjects) == 1 else []
    if kind and kind.group(1) not in label:
        parts.append(kind.group(1))
    if not parts:
        return None
    name = " ".join([*parts, label])
    return name[0].upper() + name[1:]


# ----------------------------------------------------------------- detect


def _from_sentence(sentence: str, today: date) -> ExamOffer | None:
    nouns = [
        m for m in _NOUN_RE.finditer(sentence) if _is_exam_noun(sentence, m)
    ]
    if not nouns:
        return None
    hints = _date_hints(sentence)
    if not hints:
        return None
    best: tuple[int, re.Match[str], DateHint] | None = None
    for noun in nouns:
        for hint in hints:
            if noun.start() < hint.end and hint.start < noun.end():
                continue  # the "date" is part of the noun itself
            gap = max(noun.start() - hint.end, hint.start - noun.end())
            if gap <= MAX_GAP_CHARS and (best is None or gap < best[0]):
                best = (gap, noun, hint)
    if best is None:
        return None
    _, noun, hint = best
    if _rejected(sentence, noun, hint):
        return None
    ahead = days_until(hint, today)
    if ahead is None or not 0 <= ahead <= MAX_DAYS_AHEAD:
        return None
    context = " ".join(
        _words_before(sentence, noun.start(), _QUALIFIER_WORDS)
        + _words_after(sentence, noun.end(), _TRAILING_WORDS)
    )
    subjects = _subjects(context)
    return ExamOffer(
        date_hint=hint,
        exam_name=_exam_name(context, noun.group(1), subjects),
        subjects=subjects,
    )


def detect(message: str, today: date | None = None) -> ExamOffer | None:
    """Return the offer a message warrants, or None.

    ``today`` is the reference date for "near" (UTC by default; the client
    resolves the actual calendar date on its own clock).
    """
    text = (message or "").strip()
    if not text or len(text.split()) > MAX_WORDS:
        return None
    reference = today or datetime.now(tz=UTC).date()
    lowered = text.lower().replace("\u2019", "'")
    for sentence in _SENTENCE_SPLIT_RE.split(lowered):
        if not sentence.strip():
            continue
        offer = _from_sentence(sentence, reference)
        if offer is not None:
            return offer
    return None


# ------------------------------------------------------------------- turn


def for_turn(ctx: Any, supabase: SupabaseService) -> dict[str, Any] | None:
    """Offer payload for this chat turn, or None.

    Only a message the student typed can carry an offer: a clarification
    reply, a card action (``source_content``) and the quiz / flashcard forms
    never do. Never raises; a failure here must not cost the answer.
    """
    if (
        ctx.clarification is not None
        or ctx.run_id
        or ctx.source_content
        or ctx.quiz_options is not None
        or ctx.flashcard_options is not None
    ):
        return None
    try:
        offer = detect(ctx.message)
        if offer is None:
            return None
        if not feature_flag_service.is_enabled("exam_prep"):
            return None
        # Imported here: the exam-prep package builds on the orchestrator.
        from aeva.exam_prep.exam_prep_repository import ExamPrepRepository

        if ExamPrepRepository(supabase).has_active_plan(ctx.user_id):
            return None
        return offer.to_payload()
    except Exception:
        # An offer is optional: never let it cost the answer.
        logger.exception("Exam offer detection failed")
        return None
