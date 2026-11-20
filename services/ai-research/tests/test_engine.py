from tuck_scoring.engine import score
from tuck_scoring.models import FitScoreResult, MatrixModel, ScoringFacts


def test_full_score_is_strong_and_explained(model, buyer, target):
    r = score(model, buyer, target)
    assert r.grade in ("strong", "moderate")
    assert r.score is not None and 0 <= r.score <= 100
    assert r.coverage == 1.0
    assert abs(sum(c.contribution for c in r.cells) - r.score) < 0.05
    assert r.explanation[0].startswith("Overall fit")
    assert any(e.startswith("Strength") for e in r.explanation)


def test_output_uses_camelcase_keys_matching_ts_schema(model, buyer, target):
    d = score(model, buyer, target).dump()
    assert set(d) == {"modelKey", "modelVersion", "score", "grade", "confidence", "coverage", "cells", "exclusions", "explanation"}
    assert set(d["cells"][0]) == {"criterionKey", "label", "weight", "score", "contribution", "rationale", "evidence", "missing"}
    assert d["modelVersion"] == 3


def test_deterministic(model, buyer, target):
    assert score(model, buyer, target).dump() == score(model, buyer, target).dump()


def test_missing_required_criterion_gives_insufficient_data(model, buyer_dict, target_dict):
    target_dict.pop("industry")
    target_dict["industryKeywords"] = []
    r = score(model, ScoringFacts.model_validate(buyer_dict), ScoringFacts.model_validate(target_dict))
    assert r.grade == "insufficient_data"
    assert r.score is None
    assert any("Required criteria" in e for e in r.explanation)
    assert any(c.missing for c in r.cells)


def test_low_coverage_gives_insufficient_data(model):
    r = score(model, ScoringFacts(name="A", industry="Software"), ScoringFacts(name="B", industry="Software"))
    assert r.grade == "insufficient_data" and r.score is None
    assert r.coverage == 0.2
    assert any("no score is given rather than guessing" in e for e in r.explanation)


def test_missing_cells_contribute_zero_and_are_flagged(model, buyer_dict, target_dict):
    target_dict["geographies"] = []
    r = score(model, ScoringFacts.model_validate(buyer_dict), ScoringFacts.model_validate(target_dict))
    geo = next(c for c in r.cells if c.criterion_key == "geo")
    assert geo.missing and geo.score is None and geo.contribution == 0
    assert r.coverage == 0.9
    assert any(e.startswith("Missing data — Geographic synergy") for e in r.explanation)


def test_exclusion_rule_excludes_with_reason(model_dict, buyer, target):
    model_dict["exclusions"] = [
        {"key": "no_uk", "description": "Buyer will not acquire UK entities", "field": "geography", "operator": "in", "values": ["UK"], "appliesTo": "target"}
    ]
    r = score(MatrixModel.model_validate(model_dict), buyer, target)
    assert r.grade == "excluded" and r.score == 0
    assert r.exclusions[0].rule_key == "no_uk"
    assert len(r.cells) == 7  # cells still returned for transparency


def test_not_in_exclusion_and_unknown_field(model_dict, buyer, target):
    model_dict["exclusions"] = [
        {"key": "only_saas", "description": "Only software targets", "field": "business_model", "operator": "not_in", "values": ["subscription"], "appliesTo": "target"},
        {"key": "tags", "description": "No distressed", "field": "tags", "operator": "contains", "values": ["distressed"], "appliesTo": "target"},
    ]
    r = score(MatrixModel.model_validate(model_dict), buyer, target)
    assert r.grade != "excluded"
    assert any("could not be evaluated" in e for e in r.explanation)


def test_thresholds_drive_grade(model_dict, buyer, target):
    model_dict["thresholds"] = {"strong": 100, "moderate": 99}
    assert score(MatrixModel.model_validate(model_dict), buyer, target).grade == "weak"
    model_dict["thresholds"] = {"strong": 0, "moderate": 0}
    assert score(MatrixModel.model_validate(model_dict), buyer, target).grade == "strong"


def test_confidence_reflects_evidence(model, buyer_dict, target_dict):
    with_ev = score(model, ScoringFacts.model_validate(buyer_dict), ScoringFacts.model_validate(target_dict))
    buyer_dict["evidence"] = {}
    target_dict["evidence"] = {}
    without = score(model, ScoringFacts.model_validate(buyer_dict), ScoringFacts.model_validate(target_dict))
    assert without.confidence < with_ev.confidence
    assert without.confidence == 0.6


def test_unverified_revenue_does_not_change_score(model, buyer_dict, target_dict):
    base = score(model, ScoringFacts.model_validate(buyer_dict), ScoringFacts.model_validate(target_dict))
    buyer_dict["revenueUsd"] = 1e6
    target_dict["revenueUsd"] = 9e9
    after = score(model, ScoringFacts.model_validate(buyer_dict), ScoringFacts.model_validate(target_dict))
    assert after.score == base.score


def test_result_round_trips_through_model(model, buyer, target):
    d = score(model, buyer, target).dump()
    assert FitScoreResult.model_validate(d).dump() == d
