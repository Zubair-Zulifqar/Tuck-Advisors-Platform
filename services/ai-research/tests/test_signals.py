from tuck_scoring import signals as s
from tuck_scoring.models import ScoringFacts


def F(**kw):
    return ScoringFacts(name=kw.pop("name", "X"), **kw)


def test_tokens_apply_synonyms_stopwords_and_stemming():
    assert s.tokens(["SaaS Platforms for Hospitals"]) == {"software", "healthcare"}
    assert "the" not in s.tokens(["the clinics"])
    assert s.tokens(["clinics"]) == {"clinic"}


def test_industry_exact_match_scores_one_with_evidence(buyer, target):
    r = s.industry_overlap(buyer, target, {})
    assert r.score == 1.0
    assert r.evidence == ["s1", "s3"]


def test_industry_missing_returns_none():
    r = s.industry_overlap(F(industry="Software"), F(), {})
    assert r.score is None
    assert "unknown" in r.rationale


def test_industry_partial_overlap_lists_shared_terms():
    r = s.industry_overlap(F(industry="Healthcare analytics"), F(industry="Medical devices"), {})
    assert 0 < r.score < 1
    assert "healthcare" in r.rationale


def test_business_model_same_complementary_different_missing():
    assert s.business_model_alignment(F(business_model="SaaS"), F(business_model="subscription software"), {}).score == 1.0
    assert s.business_model_alignment(F(business_model="SaaS"), F(business_model="consulting services"), {}).score == 0.6
    assert s.business_model_alignment(F(business_model="SaaS"), F(business_model="royalty licensing"), {}).score == 0.2
    assert s.business_model_alignment(F(business_model="SaaS"), F(), {}).score is None


def test_product_and_customer_overlap(buyer, target):
    p = s.product_synergy(buyer, target, {})
    c = s.customer_overlap(buyer, target, {})
    assert p.score and p.score > 0
    assert c.score and c.score > 0
    assert "healthcare" in c.rationale
    assert s.product_synergy(F(products=["x"]), F(), {}).score is None


def test_geographic_synergy_rewards_overlap_and_expansion():
    r = s.geographic_synergy(F(geographies=["USA"]), F(geographies=["Canada", "Germany"]), {})
    # one of two target regions shared (NA) + expansion into Europe
    assert r.score == round(0.7 * 0.5 + 0.3, 4)
    assert "europe" in r.rationale
    assert s.geographic_synergy(F(geographies=[]), F(geographies=["UK"]), {}).score is None


def test_scale_uses_headcount_ratio():
    assert s.scale_compatibility(F(employee_count=1000), F(employee_count=100), {}).score == 1.0
    assert s.scale_compatibility(F(employee_count=100), F(employee_count=1000), {}).score == 0.1


def test_scale_ignores_unverified_revenue():
    r = s.scale_compatibility(F(revenue_usd=1e8), F(revenue_usd=5e9), {})
    assert r.score is None
    assert "unverified revenue" in r.rationale
    verified = s.scale_compatibility(
        F(revenue_usd=1e8, revenue_verified=True), F(revenue_usd=1e7, revenue_verified=True), {}
    )
    assert verified.score == 1.0


def test_scale_mixed_verification_ignores_revenue_but_keeps_headcount():
    r = s.scale_compatibility(
        F(employee_count=1000, revenue_usd=1e6, revenue_verified=True), F(employee_count=2500, revenue_usd=1e9), {}
    )
    assert r.score == 0.1
    assert "unverified revenue figures were ignored" in r.rationale


def test_strategic_fit(buyer, target):
    r = s.strategic_fit(buyer, target, {})
    assert r.score == 1.0  # analytics (reporting synonym) + patient engagement covered
    assert s.strategic_fit(F(), target, {}).score is None


def test_acquisition_criteria_counts_and_skips():
    t = F(industry="Healthcare software", geographies=["US"], employee_count=40)
    r = s.acquisition_criteria(F(), t, {"industries": ["healthcare"], "geographies": ["north america"], "minEmployees": 50})
    assert r.score == round(2 / 3, 4)
    assert "fails: minEmployees" in r.rationale
    r2 = s.acquisition_criteria(F(), F(), {"industries": ["healthcare"]})
    assert r2.score is None and "industry" in r2.rationale
    assert s.acquisition_criteria(F(), t, {}).score is None
