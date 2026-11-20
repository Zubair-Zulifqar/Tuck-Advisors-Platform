import pytest

from tuck_scoring.models import MatrixModel, ScoringFacts

DEFAULT_MODEL = {
    "key": "default-ma-matrix",
    "name": "Tuck Default M&A Matrix",
    "version": 3,
    "criteria": [
        {"key": "industry", "label": "Industry overlap", "signal": "industry_overlap", "weight": 20, "required": True},
        {"key": "model", "label": "Business model alignment", "signal": "business_model_alignment", "weight": 15},
        {"key": "products", "label": "Product & service synergy", "signal": "product_synergy", "weight": 20},
        {"key": "customers", "label": "Customer overlap", "signal": "customer_overlap", "weight": 15},
        {"key": "geo", "label": "Geographic synergy", "signal": "geographic_synergy", "weight": 10},
        {"key": "scale", "label": "Scale compatibility", "signal": "scale_compatibility", "weight": 10},
        {"key": "strategy", "label": "Strategic fit", "signal": "strategic_fit", "weight": 10},
    ],
    "exclusions": [],
    "thresholds": {"strong": 70, "moderate": 45},
    "minCoverage": 0.5,
}


@pytest.fixture
def model_dict():
    import copy

    return copy.deepcopy(DEFAULT_MODEL)


@pytest.fixture
def model(model_dict):
    return MatrixModel.model_validate(model_dict)


@pytest.fixture
def buyer_dict():
    return {
        "name": "Northwind Software",
        "industry": "Healthcare Software",
        "industryKeywords": ["EHR", "clinical"],
        "businessModel": "SaaS subscription",
        "products": ["clinical analytics", "patient scheduling software"],
        "customerSegments": ["hospitals", "enterprise health systems"],
        "geographies": ["United States", "Canada"],
        "employeeCount": 800,
        "strategicThemes": ["analytics", "patient engagement"],
        "tags": ["strategic-acquirer"],
        "evidence": {"industry": ["s1"], "products": ["s2"]},
    }


@pytest.fixture
def target_dict():
    return {
        "name": "CareLoop",
        "industry": "Healthcare Software",
        "industryKeywords": ["patient engagement"],
        "businessModel": "SaaS",
        "products": ["patient engagement app", "clinical reporting"],
        "customerSegments": ["hospitals", "clinics"],
        "geographies": ["United States", "UK"],
        "employeeCount": 60,
        "evidence": {"industry": ["s3"], "products": ["s4"], "customerSegments": ["s5"]},
    }


@pytest.fixture
def buyer(buyer_dict):
    return ScoringFacts.model_validate(buyer_dict)


@pytest.fixture
def target(target_dict):
    return ScoringFacts.model_validate(target_dict)
