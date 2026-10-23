"""Plans: the catalog in code with admin overrides, the user's plan row.

Aeva is free today, and everyone gets the Pro experience. This module is
the single place that knows which plans exist, what they cost and which
profile columns hold the user's plan, so that Free vs Pro limits, paid
subscriptions and monthly/yearly billing can be added later by extending
the catalog and the status set rather than touching feature code.

Pricing is REGISTERED here (``PLAN_CATALOG``) and may be OVERRIDDEN per plan
from the admin panel (``plan_overrides`` table, migration 042). ``catalog()``
returns the effective merge through a 60 s per-process cache and fails open
to the code defaults, the same model as ``feature_flag_service``.

Profile columns (migration 040): ``plan``, ``plan_status``,
``pro_activated_at``, ``pro_prompt_shown``. ``project()`` turns a profile
row into the API view every client reads (/auth/me returns the row as is,
``/plan/*`` returns this view).

Feature code should ask ``has_pro_access(profile)`` rather than compare
columns, so that a later paid tier or a trial changes one function.
"""

import logging
import time
from dataclasses import asdict, dataclass, replace
from typing import Any

logger = logging.getLogger(__name__)

# Tiers. A new tier (e.g. "team") is a new constant and a catalog entry.
PLAN_FREE = "free"
PLAN_PRO = "pro"
PLANS: frozenset[str] = frozenset({PLAN_FREE, PLAN_PRO})

# Lifecycle of the current plan. Only "none" (free) and "early_access"
# (pro at ₹0) are produced today; the rest are reserved for billing.
STATUS_NONE = "none"
STATUS_EARLY_ACCESS = "early_access"
STATUS_ACTIVE = "active"
STATUS_PAST_DUE = "past_due"
STATUS_CANCELED = "canceled"
STATUS_EXPIRED = "expired"
PLAN_STATUSES: frozenset[str] = frozenset(
    {
        STATUS_NONE,
        STATUS_EARLY_ACCESS,
        STATUS_ACTIVE,
        STATUS_PAST_DUE,
        STATUS_CANCELED,
        STATUS_EXPIRED,
    },
)

# Statuses under which the plan's features are available.
ACTIVE_STATUSES: frozenset[str] = frozenset(
    {STATUS_EARLY_ACCESS, STATUS_ACTIVE, STATUS_PAST_DUE},
)

# Profile columns this module owns.
COLUMNS: tuple[str, ...] = (
    "plan",
    "plan_status",
    "pro_activated_at",
    "pro_prompt_shown",
    "currency",
)

# Regional pricing: INR for India, USD for everyone else. The client picks
# the currency from the device's region and sends it back on activation so
# the profile remembers what the user was quoted (migration 041).
CURRENCY_INR = "INR"
CURRENCY_USD = "USD"
CURRENCIES: frozenset[str] = frozenset({CURRENCY_INR, CURRENCY_USD})
DEFAULT_CURRENCY = CURRENCY_INR


@dataclass(frozen=True)
class PlanPrice:
    """One price point of a plan, in major currency units (4.99 = $4.99)."""

    interval: str  # "month" | "year"
    amount: float
    currency: str = CURRENCY_INR


@dataclass(frozen=True)
class PlanDef:
    """One entry in the plan catalog."""

    key: str
    label: str
    # Every currency's prices together; the client filters by currency.
    prices: tuple[PlanPrice, ...]
    # What the user pays today, in any currency. 0 during Early Access; a
    # billing launch drops this override and charges the listed prices.
    current_amount: float = 0
    early_access: bool = False


PLAN_CATALOG: tuple[PlanDef, ...] = (
    PlanDef(PLAN_FREE, "Free", prices=()),
    PlanDef(
        PLAN_PRO,
        "Aeva Pro",
        prices=(
            PlanPrice("month", 99, CURRENCY_INR),
            PlanPrice("year", 799, CURRENCY_INR),
            PlanPrice("month", 4.99, CURRENCY_USD),
            PlanPrice("year", 39, CURRENCY_USD),
        ),
        current_amount=0,
        early_access=True,
    ),
)


INTERVALS: frozenset[str] = frozenset({"month", "year"})
PLAN_KEYS: frozenset[str] = frozenset(p.key for p in PLAN_CATALOG)

_CACHE_TTL_SECONDS = 60
_cache: tuple[float, list[PlanDef]] | None = None


def _fetch_overrides() -> dict[str, dict[str, Any]]:
    """Return ``{plan_key: override document}`` from the DB (may raise)."""
    # Imported here so this module stays importable without Flask/Supabase
    # (the prompt layer and the frontend fallback mirror read it).
    from aeva.supabase.supabase_service import SupabaseService

    rows = (
        SupabaseService()
        .client.table("plan_overrides")
        .select("plan_key, value")
        .execute()
    ).data or []
    return {
        r["plan_key"]: r["value"]
        for r in rows
        if r.get("plan_key") in PLAN_KEYS and isinstance(r.get("value"), dict)
    }


def apply_override(plan: PlanDef, value: dict[str, Any] | None) -> PlanDef:
    """Return ``plan`` with the fields of an override document applied.

    Tolerant of a partial or malformed document: a field that is missing or
    of the wrong shape keeps the code default, so a bad row can never take
    pricing off the air.
    """
    if not value:
        return plan
    prices = plan.prices
    raw = value.get("prices")
    if isinstance(raw, list):
        parsed: list[PlanPrice] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            interval, currency = item.get("interval"), item.get("currency")
            amount = item.get("amount")
            if (
                interval in INTERVALS
                and currency in CURRENCIES
                and isinstance(amount, int | float)
                and amount >= 0
            ):
                parsed.append(PlanPrice(interval, float(amount), currency))
        if parsed:
            prices = tuple(parsed)
    current = value.get("current_amount", plan.current_amount)
    if not isinstance(current, int | float) or current < 0:
        current = plan.current_amount
    early = value.get("early_access", plan.early_access)
    if not isinstance(early, bool):
        early = plan.early_access
    return replace(
        plan, prices=prices, current_amount=float(current), early_access=early
    )


def effective_catalog() -> list[PlanDef]:
    """Code catalog overlaid with admin overrides (cached, fail-open)."""
    global _cache  # noqa: PLW0603 - module-level TTL cache
    if _cache and time.monotonic() - _cache[0] < _CACHE_TTL_SECONDS:
        return _cache[1]
    try:
        overrides = _fetch_overrides()
    except Exception:  # noqa: BLE001
        logger.warning("Plan override fetch failed; using code catalog")
        return list(PLAN_CATALOG)
    merged = [apply_override(p, overrides.get(p.key)) for p in PLAN_CATALOG]
    _cache = (time.monotonic(), merged)
    return merged


def invalidate_cache() -> None:
    """Bust the TTL cache (called after an admin save)."""
    global _cache  # noqa: PLW0603 - module-level TTL cache
    _cache = None


def catalog() -> list[dict[str, Any]]:
    """Return the effective plan catalog as plain data (``GET /config``)."""
    return [asdict(plan) for plan in effective_catalog()]


def prices_for(plan_key: str, currency: str) -> list[PlanPrice]:
    """Return one plan's prices in one currency (empty for unknown input)."""
    for plan in effective_catalog():
        if plan.key == plan_key:
            return [p for p in plan.prices if p.currency == currency]
    return []


def list_plans_with_meta() -> list[dict[str, Any]]:
    """Registry merged with DB overrides, uncached, for the admin panel.

    Each entry carries the effective values plus the code ``default`` and
    ``updated_at`` / ``updated_by`` (None while on the code default).
    """
    # Imported lazily for the same reason as ``_fetch_overrides``.
    from aeva.supabase.supabase_service import SupabaseService

    rows = (
        SupabaseService()
        .client.table("plan_overrides")
        .select("plan_key, value, updated_at, updated_by")
        .execute()
    ).data or []
    by_key = {r["plan_key"]: r for r in rows}
    out: list[dict[str, Any]] = []
    for plan in PLAN_CATALOG:
        row = by_key.get(plan.key, {})
        value = row.get("value") if isinstance(row.get("value"), dict) else None
        out.append(
            {
                **asdict(apply_override(plan, value)),
                "default": asdict(plan),
                "updated_at": row.get("updated_at"),
                "updated_by": row.get("updated_by"),
            }
        )
    return out


def _money(amount: float, currency: str) -> str:
    symbol = "₹" if currency == CURRENCY_INR else "$"
    text = f"{amount:.2f}".rstrip("0").rstrip(".")
    return f"{symbol}{text}"


def prompt_knowledge(plans: list[PlanDef] | None = None) -> str:
    """Return the plan section of the product-info prompt.

    ``plans`` defaults to the effective (admin-edited) catalog; the prompt
    template passes the code catalog for its import-time default so no DB
    call happens at import. Spells out both what Early Access adds and what
    does not exist yet, so Aeva never promises billing features the product
    does not have.
    """
    source = effective_catalog() if plans is None else plans
    pro = next((p for p in source if p.key == PLAN_PRO), None)
    if pro is None:
        return ""

    def pair(currency: str) -> str:
        own = {p.interval: p for p in pro.prices if p.currency == currency}
        parts = []
        if "month" in own:
            parts.append(f"{_money(own['month'].amount, currency)}/month")
        if "year" in own:
            parts.append(f"{_money(own['year'].amount, currency)}/year")
        return " or ".join(parts)

    inr, usd = pair(CURRENCY_INR), pair(CURRENCY_USD)
    today = (
        f"{_money(pro.current_amount, CURRENCY_INR)} / "
        f"{_money(pro.current_amount, CURRENCY_USD)}"
    )
    if pro.early_access:
        status = (
            f"- Aeva is currently FREE: every feature above is the Pro-level "
            f'experience and costs {today} today ("Early Access"). No '
            f"payment, card, trial or cancellation is involved."
        )
        activate = (
            '- Students can turn on "Pro · Early Access" for free from the Pro '
            "popup that appears after a few interactions, or any time from "
            'Profile → Account → Plan ("Activate Pro"). It is instant and '
            "changes nothing about what they can use."
        )
    else:
        status = (
            f"- Aeva Pro is a paid plan; the current price is {today}. "
            f"Students can subscribe from Profile → Account → Plan."
        )
        activate = ""
    future = (
        f"- Aeva Pro pricing: {inr} in India, {usd} elsewhere; the app shows "
        f"the student's regional currency (INR in India, USD otherwise)."
        if pro.early_access
        else f"- Aeva Pro costs {inr} in India and {usd} elsewhere."
    )
    lines = [
        "Plan & pricing (Aeva Pro):",
        status,
        future,
        activate,
        '- Pro status shows as "✨ Pro · Early Access" in Profile/Account with '
        "a ring on the profile picture; Quizzes and Exam Prep carry a small "
        "PRO label, but EVERY feature stays available to everyone during "
        "Early Access.",
        "- Not available yet (never promise these): paid subscriptions or "
        "checkout, payments, invoices or billing history, Free-vs-Pro feature "
        "limits, refunds, discounts or coupons, family/team plans, or a date "
        "when Pro becomes paid. If asked when it will be paid, say it has not "
        "been announced and students will be told in advance.",
    ]
    return "\n".join(line for line in lines if line)


def normalize_currency(value: str | None) -> str | None:
    """Return a supported ISO 4217 code, or None for anything else."""
    if not value:
        return None
    code = value.strip().upper()
    return code if code in CURRENCIES else None


def project(profile: dict[str, Any] | None) -> dict[str, Any]:
    """Return the API view of a profile row's plan fields, with defaults.

    A profile row written before migration 040, or a missing row, reads as
    free / none / never prompted, which is exactly what those users are.
    """
    profile = profile or {}
    plan = profile.get("plan") or PLAN_FREE
    status = profile.get("plan_status") or STATUS_NONE
    return {
        "plan": plan if plan in PLANS else PLAN_FREE,
        "plan_status": status if status in PLAN_STATUSES else STATUS_NONE,
        "pro_activated_at": profile.get("pro_activated_at"),
        "pro_prompt_shown": bool(profile.get("pro_prompt_shown")),
        "currency": normalize_currency(profile.get("currency")),
    }


def has_pro_access(profile: dict[str, Any] | None) -> bool:
    """Whether Pro features are available to this profile.

    Nothing is gated during Early Access, so no feature checks this yet;
    it exists so that the first limit added later has one switch to flip.
    """
    view = project(profile)
    return view["plan"] == PLAN_PRO and view["plan_status"] in ACTIVE_STATUSES
