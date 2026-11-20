"""Deterministic, explainable signal functions for the M&A Matrix.

Every signal returns a SignalResult with:
  * score: 0..1, or None when the required inputs are missing (never guessed)
  * rationale: a human-readable sentence explaining the value
  * evidence: source ids drawn from facts.evidence for the fields used
No LLM calls happen here — the same inputs always produce the same output.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

from .models import ScoringFacts

STOPWORDS = frozenset(
    """a an and or the of for to in on at by with from as is are be our your their its this that we
    company companies inc llc ltd corp group global solutions services service provider providers
    based leading platform platforms products product""".split()
)

# Each group collapses to its first member so synonyms count as overlap.
SYNONYM_GROUPS: tuple[tuple[str, ...], ...] = (
    ("software", "saas", "cloud", "app", "apps", "application", "applications"),
    ("enterprise", "b2b", "business", "businesses", "corporate"),
    ("consumer", "b2c", "retail", "shopper", "shoppers"),
    ("smb", "sme", "small", "midsize", "mid-market", "midmarket"),
    ("healthcare", "health", "medical", "clinical", "hospital", "hospitals"),
    ("fintech", "financial", "finance", "banking", "payments", "payment"),
    ("logistics", "shipping", "freight", "supply", "warehousing"),
    ("marketing", "advertising", "adtech", "martech"),
    ("security", "cybersecurity", "infosec"),
    ("analytics", "data", "bi", "insights", "reporting"),
    ("manufacturing", "industrial", "factory", "factories"),
    ("education", "edtech", "learning", "training"),
    ("ecommerce", "e-commerce", "online", "store", "stores"),
    ("realestate", "property", "proptech"),
    ("hr", "hcm", "payroll", "recruiting", "talent"),
)
_SYNONYMS: dict[str, str] = {w: g[0] for g in SYNONYM_GROUPS for w in g}

REGION_ALIASES: dict[str, str] = {
    "us": "north america", "usa": "north america", "united states": "north america", "canada": "north america",
    "na": "north america", "north america": "north america", "mexico": "latin america",
    "uk": "europe", "united kingdom": "europe", "germany": "europe", "france": "europe", "eu": "europe",
    "europe": "europe", "emea": "europe", "ireland": "europe", "netherlands": "europe", "spain": "europe",
    "apac": "asia pacific", "asia": "asia pacific", "asia pacific": "asia pacific", "australia": "asia pacific",
    "india": "asia pacific", "japan": "asia pacific", "singapore": "asia pacific", "china": "asia pacific",
    "latam": "latin america", "latin america": "latin america", "brazil": "latin america",
    "middle east": "middle east", "uae": "middle east", "africa": "africa", "global": "global",
}

BUSINESS_MODELS: dict[str, tuple[str, ...]] = {
    "subscription": ("saas", "subscription", "recurring", "software"),
    "services": ("services", "consulting", "agency", "managed", "professional"),
    "marketplace": ("marketplace", "platform", "two-sided"),
    "transactional": ("ecommerce", "e-commerce", "transaction", "transactional", "retail"),
    "licensing": ("license", "licensing", "royalty"),
    "hardware": ("hardware", "device", "devices", "equipment", "manufacturing"),
}
COMPLEMENTARY_MODELS = {frozenset({"subscription", "services"}), frozenset({"hardware", "subscription"}), frozenset({"marketplace", "transactional"})}


@dataclass(frozen=True)
class SignalResult:
    score: Optional[float]
    rationale: str
    evidence: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- helpers
def _stem(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def tokens(values: Iterable[Optional[str]]) -> set[str]:
    out: set[str] = set()
    for v in values:
        if not v:
            continue
        for raw in re.split(r"[^a-z0-9\-]+", v.lower()):
            raw = raw.strip("-")
            if not raw or raw in STOPWORDS or len(raw) < 2:
                continue
            w = _SYNONYMS.get(raw) or _SYNONYMS.get(_stem(raw)) or _stem(raw)
            out.add(w)
    return out


def overlap(a: set[str], b: set[str]) -> Optional[float]:
    """Overlap coefficient |A∩B| / min(|A|,|B|); None if either side is empty."""
    if not a or not b:
        return None
    return len(a & b) / min(len(a), len(b))


def evidence_for(buyer: ScoringFacts, target: ScoringFacts, *keys: str) -> list[str]:
    seen: list[str] = []
    for facts in (buyer, target):
        for k in keys:
            for sid in facts.evidence.get(k, []):
                if sid not in seen:
                    seen.append(sid)
    return seen


def _fmt(terms: Iterable[str], limit: int = 5) -> str:
    t = sorted(terms)
    return ", ".join(t[:limit]) + ("…" if len(t) > limit else "")


def _r(x: float) -> float:
    return round(max(0.0, min(1.0, x)), 4)


def regions(values: Iterable[str]) -> set[str]:
    out = set()
    for v in values:
        key = v.strip().lower()
        out.add(REGION_ALIASES.get(key, key))
    return {r for r in out if r}


def classify_model(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    low = text.lower()
    for model, words in BUSINESS_MODELS.items():
        if any(re.search(rf"\b{re.escape(w)}\b", low) for w in words):
            return model
    return None


def employee_bucket(count: Optional[float]) -> Optional[str]:
    if count is None:
        return None
    for upper, label in ((10, "1-10"), (50, "11-50"), (200, "51-200"), (500, "201-500"), (1000, "501-1000"), (5000, "1001-5000")):
        if count <= upper:
            return label
    return "5000+"


# ---------------------------------------------------------------- signals
def industry_overlap(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    ev = evidence_for(buyer, target, "industry", "industryKeywords")
    if buyer.industry and target.industry and buyer.industry.strip().lower() == target.industry.strip().lower():
        return SignalResult(1.0, f"Both companies operate in {target.industry}.", ev)
    a = tokens([buyer.industry, *buyer.industry_keywords])
    b = tokens([target.industry, *target.industry_keywords])
    s = overlap(a, b)
    if s is None:
        return SignalResult(None, "Industry is unknown for the buyer or the target.", ev)
    shared = a & b
    why = f"Shared industry terms: {_fmt(shared)}." if shared else "No shared industry terms were found."
    return SignalResult(_r(s), why, ev)


def business_model_alignment(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    ev = evidence_for(buyer, target, "businessModel")
    if not buyer.business_model or not target.business_model:
        return SignalResult(None, "Business model is unknown for the buyer or the target.", ev)
    mb, mt = classify_model(buyer.business_model), classify_model(target.business_model)
    if mb and mt:
        if mb == mt:
            return SignalResult(1.0, f"Both follow a {mb} business model.", ev)
        if frozenset({mb, mt}) in COMPLEMENTARY_MODELS:
            return SignalResult(0.6, f"Complementary models: buyer is {mb}, target is {mt}.", ev)
        return SignalResult(0.2, f"Different models: buyer is {mb}, target is {mt}.", ev)
    s = overlap(tokens([buyer.business_model]), tokens([target.business_model]))
    if s is None:
        return SignalResult(None, "Business model descriptions are too sparse to compare.", ev)
    return SignalResult(_r(s), "Business models compared by description keywords.", ev)


def _list_overlap(name: str, key: str, a_vals: list[str], b_vals: list[str], buyer: ScoringFacts, target: ScoringFacts) -> SignalResult:
    ev = evidence_for(buyer, target, key)
    a, b = tokens(a_vals), tokens(b_vals)
    s = overlap(a, b)
    if s is None:
        return SignalResult(None, f"{name} are unknown for the buyer or the target.", ev)
    shared = a & b
    why = f"Shared {name.lower()} themes: {_fmt(shared)}." if shared else f"No overlapping {name.lower()} were found."
    return SignalResult(_r(s), why, ev)


def product_synergy(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    return _list_overlap("Products and services", "products", buyer.products, target.products, buyer, target)


def customer_overlap(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    return _list_overlap("Customer segments", "customerSegments", buyer.customer_segments, target.customer_segments, buyer, target)


def geographic_synergy(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    ev = evidence_for(buyer, target, "geographies")
    a, b = regions(buyer.geographies), regions(target.geographies)
    if not a or not b:
        return SignalResult(None, "Geographic presence is unknown for the buyer or the target.", ev)
    if "global" in a:
        return SignalResult(0.8, "Buyer operates globally, covering the target's markets.", ev)
    shared, new = a & b, b - a
    base = len(shared) / len(b)
    score = 0.7 * base + (0.3 if new else 0.0)
    parts = []
    if shared:
        parts.append(f"shared presence in {_fmt(shared)}")
    if new:
        parts.append(f"expansion into {_fmt(new)}")
    return SignalResult(_r(score), ("Geography: " + "; ".join(parts) + ".") if parts else "No geographic overlap.", ev)


def scale_compatibility(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    ev: list[str] = []
    parts: list[float] = []
    notes: list[str] = []
    ideal = float(params.get("idealMaxRatio", 0.5))

    def ratio_score(r: float) -> float:
        if r <= ideal:
            return 1.0
        if r <= 1:
            return 0.7
        if r <= 2:
            return 0.4
        return 0.1

    if buyer.employee_count and target.employee_count:
        r = target.employee_count / buyer.employee_count
        parts.append(ratio_score(r))
        notes.append(f"target headcount is {r:.0%} of buyer's")
        ev += evidence_for(buyer, target, "employeeCount")
    if buyer.revenue_verified and target.revenue_verified and buyer.revenue_usd and target.revenue_usd:
        r = target.revenue_usd / buyer.revenue_usd
        parts.append(ratio_score(r))
        notes.append(f"verified target revenue is {r:.0%} of buyer's")
        ev += [e for e in evidence_for(buyer, target, "revenueUsd") if e not in ev]
    elif buyer.revenue_usd is not None or target.revenue_usd is not None:
        notes.append("unverified revenue figures were ignored")
    if not parts:
        return SignalResult(None, "No verified size data (headcount or verified revenue) for both companies" + (f"; {notes[0]}." if notes else "."), ev)
    return SignalResult(_r(sum(parts) / len(parts)), "Scale: " + "; ".join(notes) + ".", ev)


def strategic_fit(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    ev = evidence_for(buyer, target, "strategicThemes", "products", "industry")
    themes = tokens(buyer.strategic_themes)
    offer = tokens([target.industry, *target.industry_keywords, *target.products, *target.customer_segments, *target.strategic_themes])
    if not themes or not offer:
        return SignalResult(None, "Buyer strategic themes or target offering are unknown.", ev)
    hit = themes & offer
    score = len(hit) / len(themes)
    why = f"Target addresses buyer themes: {_fmt(hit)}." if hit else "Target does not address any stated buyer strategic themes."
    return SignalResult(_r(score), why, ev)


def acquisition_criteria(buyer: ScoringFacts, target: ScoringFacts, params: dict[str, Any]) -> SignalResult:
    """Checks the target against explicit buyer criteria in params. Unevaluable checks are skipped, not failed."""
    checks: list[tuple[str, bool]] = []
    skipped: list[str] = []
    ev = evidence_for(buyer, target, "industry", "geographies", "employeeCount", "tags")

    industries = [str(x) for x in params.get("industries", [])]
    if industries:
        if target.industry or target.industry_keywords:
            ok = bool(tokens(industries) & tokens([target.industry, *target.industry_keywords]))
            checks.append(("industry", ok))
        else:
            skipped.append("industry")
    geos = [str(x) for x in params.get("geographies", [])]
    if geos:
        if target.geographies:
            checks.append(("geography", bool(regions(geos) & regions(target.geographies))))
        else:
            skipped.append("geography")
    for key, cmp in (("minEmployees", lambda v, lim: v >= lim), ("maxEmployees", lambda v, lim: v <= lim)):
        if key in params:
            if target.employee_count is not None:
                checks.append((key, cmp(target.employee_count, float(params[key]))))
            else:
                skipped.append(key)
    req_tags = [str(t).lower() for t in params.get("requiredTags", [])]
    if req_tags:
        have = {t.lower() for t in target.tags}
        checks.append(("requiredTags", all(t in have for t in req_tags)))

    if not checks:
        msg = "No acquisition criteria could be evaluated"
        return SignalResult(None, msg + (f" (missing target data: {', '.join(skipped)})." if skipped else " (none configured)."), ev)
    passed = [k for k, ok in checks if ok]
    failed = [k for k, ok in checks if not ok]
    why = f"Meets {len(passed)}/{len(checks)} acquisition criteria"
    if failed:
        why += f"; fails: {', '.join(failed)}"
    if skipped:
        why += f"; not evaluated: {', '.join(skipped)}"
    return SignalResult(_r(len(passed) / len(checks)), why + ".", ev)


SIGNAL_FUNCTIONS: dict[str, Callable[[ScoringFacts, ScoringFacts, dict[str, Any]], SignalResult]] = {
    "industry_overlap": industry_overlap,
    "business_model_alignment": business_model_alignment,
    "product_synergy": product_synergy,
    "customer_overlap": customer_overlap,
    "geographic_synergy": geographic_synergy,
    "scale_compatibility": scale_compatibility,
    "strategic_fit": strategic_fit,
    "acquisition_criteria": acquisition_criteria,
}
