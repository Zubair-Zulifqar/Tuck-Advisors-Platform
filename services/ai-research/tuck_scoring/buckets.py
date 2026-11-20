"""Configurable buyer-bucket classification. Rules come from the database, never hardcoded."""

from __future__ import annotations

from typing import Any, Optional

from .models import BucketCondition, BucketRule, ClassifyResult, ScoringFacts
from .signals import classify_model, employee_bucket, regions

FIELD_ALIASES = {
    "industry": "industry",
    "business_model": "business_model",
    "businessModel": "business_model",
    "geography": "geography",
    "geographies": "geography",
    "tags": "tags",
    "employee_count": "employee_count",
    "employeeCount": "employee_count",
    "employee_range": "employee_range",
    "strategic_themes": "strategic_themes",
    "strategicThemes": "strategic_themes",
    "products": "products",
    "customer_segments": "customer_segments",
    "customerSegments": "customer_segments",
    "revenue_usd": "revenue_usd",
    "revenueUsd": "revenue_usd",
}


def _value(facts: ScoringFacts, field: str) -> Any:
    f = FIELD_ALIASES.get(field)
    if f is None:
        return None
    if f == "industry":
        vals = [v.lower() for v in [facts.industry, *facts.industry_keywords] if v]
        return vals or None
    if f == "business_model":
        vals = [v.lower() for v in [facts.business_model, classify_model(facts.business_model)] if v]
        return vals or None
    if f == "geography":
        vals = sorted(regions(facts.geographies)) + [g.lower() for g in facts.geographies]
        return vals or None
    if f == "employee_count":
        return facts.employee_count
    if f == "employee_range":
        return employee_bucket(facts.employee_count)
    if f == "revenue_usd":
        # Only verified revenue may drive classification.
        return facts.revenue_usd if facts.revenue_verified else None
    vals = [v.lower() for v in getattr(facts, f)]
    return vals or None


def _check(cond: BucketCondition, facts: ScoringFacts) -> tuple[bool, str]:
    v = _value(facts, cond.field)
    if v is None:
        return False, f"{cond.field} is unknown"
    if cond.operator in ("gte", "lte"):
        if not isinstance(v, (int, float)):
            return False, f"{cond.field} is not numeric"
        lim = float(cond.values[0])
        ok = v >= lim if cond.operator == "gte" else v <= lim
        return ok, f"{cond.field} {v:g} {'≥' if cond.operator == 'gte' else '≤'} {lim:g}" + ("" if ok else " not satisfied")
    vals = v if isinstance(v, list) else [str(v).lower()]
    wanted = [str(x).lower() for x in cond.values]
    if cond.operator == "contains":
        hit = [w for w in wanted if any(w in x for x in vals)]
    else:
        hit = [w for w in wanted if w in vals]
    if cond.operator == "not_in":
        return (not hit), (f"{cond.field} not in {', '.join(wanted)}" if not hit else f"{cond.field} is {', '.join(hit)}")
    return bool(hit), (f"{cond.field} matches {', '.join(hit)}" if hit else f"{cond.field} does not match {', '.join(wanted)}")


def classify_buyer(rules: list[BucketRule], facts: ScoringFacts) -> ClassifyResult:
    explanation: list[str] = []
    for rule in sorted(rules, key=lambda r: (r.priority, r.key)):
        results = [_check(c, facts) for c in rule.conditions]
        if all(ok for ok, _ in results):
            reasons = "; ".join(msg for _, msg in results) or "no conditions (catch-all)"
            explanation.append(f"Matched rule '{rule.key}' → bucket '{rule.bucket}': {reasons}.")
            return ClassifyResult(bucket=rule.bucket, matched_rule_key=rule.key, explanation=explanation)
        failed = "; ".join(msg for ok, msg in results if not ok)
        explanation.append(f"Rule '{rule.key}' ({rule.bucket}) did not match: {failed}.")
    explanation.append("No bucket rule matched; buyer left unclassified for human review.")
    return ClassifyResult(bucket=None, matched_rule_key=None, explanation=explanation)


def classify(rules: list[dict[str, Any]], facts: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Dict convenience wrapper."""
    return classify_buyer([BucketRule.model_validate(r) for r in rules], ScoringFacts.model_validate(facts)).dump()
