"""M&A Matrix scoring engine: weighted, explainable, deterministic."""

from __future__ import annotations

from typing import Optional

from .models import (
    ExclusionHit,
    ExclusionRule,
    FitScoreResult,
    MatrixCellResult,
    MatrixModel,
    ScoringFacts,
)
from .signals import SIGNAL_FUNCTIONS, classify_model, employee_bucket, regions

EVIDENCE_FACTOR_WITH = 1.0
EVIDENCE_FACTOR_WITHOUT = 0.6


def _field_values(facts: ScoringFacts, field: str) -> Optional[list[str]]:
    """Returns lower-cased values for an exclusion field, or None when the data is unknown."""
    if field == "industry":
        vals = [v for v in [facts.industry, *facts.industry_keywords] if v]
    elif field == "geography":
        vals = sorted(regions(facts.geographies)) + [g.lower() for g in facts.geographies]
    elif field == "business_model":
        vals = [v for v in [facts.business_model, classify_model(facts.business_model)] if v]
    elif field == "tags":
        vals = list(facts.tags)
    elif field == "employee_range":
        b = employee_bucket(facts.employee_count)
        vals = [b] if b else []
    else:  # pragma: no cover - guarded by the Literal type
        vals = []
    vals = [v.strip().lower() for v in vals if v and v.strip()]
    return vals or None


def evaluate_exclusion(rule: ExclusionRule, buyer: ScoringFacts, target: ScoringFacts) -> tuple[Optional[bool], str]:
    """(True, reason) if excluded; (False, '') if not; (None, note) if the field is unknown."""
    facts = target if rule.applies_to == "target" else buyer
    vals = _field_values(facts, rule.field)
    who = rule.applies_to
    if vals is None:
        return None, f"Exclusion '{rule.key}' could not be evaluated: {who} {rule.field.replace('_', ' ')} is unknown."
    wanted = [v.strip().lower() for v in rule.values]
    if rule.operator == "contains":
        hits = [w for w in wanted if any(w in v for v in vals)]
        return (True, f"{rule.description} ({who} {rule.field} contains {', '.join(hits)})") if hits else (False, "")
    match = [w for w in wanted if w in vals]
    if rule.operator == "in":
        return (True, f"{rule.description} ({who} {rule.field} is {', '.join(match)})") if match else (False, "")
    # not_in: excluded when none of the allowed values match
    return (False, "") if match else (True, f"{rule.description} ({who} {rule.field} is outside {', '.join(wanted)})")


def score(model: MatrixModel, buyer: ScoringFacts, target: ScoringFacts) -> FitScoreResult:
    total_weight = sum(c.weight for c in model.criteria)
    raw: list[tuple] = []
    for c in model.criteria:
        res = SIGNAL_FUNCTIONS[c.signal](buyer, target, c.params)
        raw.append((c, res))

    scored = [(c, r) for c, r in raw if r.score is not None and c.weight > 0]
    scored_weight = sum(c.weight for c, _ in scored)
    coverage = round(scored_weight / total_weight, 4) if total_weight > 0 else 0.0

    cells: list[MatrixCellResult] = []
    for c, r in raw:
        contribution = 0.0
        if r.score is not None and scored_weight > 0:
            contribution = round(c.weight / scored_weight * r.score * 100, 2)
        cells.append(
            MatrixCellResult(
                criterion_key=c.key,
                label=c.label,
                weight=c.weight,
                score=r.score,
                contribution=contribution,
                rationale=r.rationale,
                evidence=list(r.evidence),
                missing=r.score is None,
            )
        )

    exclusions: list[ExclusionHit] = []
    unevaluated_exclusions: list[str] = []
    for rule in model.exclusions:
        hit, reason = evaluate_exclusion(rule, buyer, target)
        if hit:
            exclusions.append(ExclusionHit(rule_key=rule.key, reason=reason))
        elif hit is None:
            unevaluated_exclusions.append(reason)

    missing_required = [c.label for c, r in raw if c.required and r.score is None]
    raw_score = round(sum(cell.contribution for cell in cells), 2) if scored_weight > 0 else None

    if scored:
        factors = [EVIDENCE_FACTOR_WITH if r.evidence else EVIDENCE_FACTOR_WITHOUT for _, r in scored]
        confidence = round(coverage * sum(factors) / len(factors), 4)
    else:
        confidence = 0.0

    explanation: list[str] = []
    if exclusions:
        grade, final = "excluded", 0.0
        explanation += [f"Excluded: {e.reason}." for e in exclusions]
    elif missing_required or coverage < model.min_coverage or raw_score is None:
        grade, final = "insufficient_data", None
        if missing_required:
            explanation.append(f"Required criteria lack data: {', '.join(missing_required)}.")
        if coverage < model.min_coverage:
            explanation.append(
                f"Only {coverage:.0%} of the matrix weight could be scored (minimum {model.min_coverage:.0%}); no score is given rather than guessing."
            )
    else:
        final = raw_score
        if final >= model.thresholds.strong:
            grade = "strong"
        elif final >= model.thresholds.moderate:
            grade = "moderate"
        else:
            grade = "weak"
        explanation.append(f"Overall fit {final:.1f}/100 ({grade}) from {len(scored)} of {len(raw)} criteria ({coverage:.0%} coverage).")

    drivers = sorted((cell for cell in cells if cell.score is not None and cell.score >= 0.6), key=lambda x: (-x.contribution, x.criterion_key))
    for d in drivers[:3]:
        explanation.append(f"Strength — {d.label}: {d.rationale}")
    gaps = sorted((cell for cell in cells if cell.score is not None and cell.score < 0.4), key=lambda x: (x.score, x.criterion_key))
    for g in gaps[:3]:
        explanation.append(f"Gap — {g.label}: {g.rationale}")
    for m in (cell for cell in cells if cell.missing):
        explanation.append(f"Missing data — {m.label}: {m.rationale}")
    explanation += unevaluated_exclusions

    return FitScoreResult(
        model_key=model.key,
        model_version=model.version,
        score=final,
        grade=grade,
        confidence=min(1.0, confidence),
        coverage=min(1.0, coverage),
        cells=cells,
        exclusions=exclusions,
        explanation=explanation,
    )
