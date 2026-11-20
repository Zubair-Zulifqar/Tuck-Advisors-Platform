import json

import pytest
from fastapi.testclient import TestClient

from tuck_scoring.app import app
from tuck_scoring.buckets import classify_buyer
from tuck_scoring.lambda_handler import handler
from tuck_scoring.models import BucketRule, ScoringFacts

RULES = [
    {"key": "catch_all", "bucket": "Other", "priority": 999, "conditions": []},
    {"key": "health_platform", "bucket": "Healthcare Platform", "priority": 10,
     "conditions": [{"field": "industry", "operator": "contains", "values": ["health"]}, {"field": "employeeCount", "operator": "gte", "values": [500]}]},
    {"key": "health_any", "bucket": "Healthcare Tuck-in", "priority": 20,
     "conditions": [{"field": "industry", "operator": "contains", "values": ["health"]}]},
]


def rules():
    return [BucketRule.model_validate(r) for r in RULES]


def test_bucket_lowest_priority_wins(buyer):
    r = classify_buyer(rules(), buyer)
    assert r.bucket == "Healthcare Platform"
    assert r.matched_rule_key == "health_platform"


def test_bucket_falls_through_with_explanations():
    r = classify_buyer(rules(), ScoringFacts(name="Small", industry="Health services", employee_count=20))
    assert r.bucket == "Healthcare Tuck-in"
    assert any("did not match" in e for e in r.explanation)


def test_bucket_missing_field_fails_condition():
    r = classify_buyer(rules()[1:], ScoringFacts(name="Unknown"))
    assert r.bucket is None
    assert any("industry is unknown" in e for e in r.explanation)
    assert r.explanation[-1].startswith("No bucket rule matched")


def test_bucket_revenue_requires_verification():
    rule = [BucketRule.model_validate({"key": "big", "bucket": "Large", "conditions": [{"field": "revenueUsd", "operator": "gte", "values": [1e8]}]})]
    assert classify_buyer(rule, ScoringFacts(name="A", revenue_usd=5e8)).bucket is None
    assert classify_buyer(rule, ScoringFacts(name="A", revenue_usd=5e8, revenue_verified=True)).bucket == "Large"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("SCORING_SERVICE_TOKEN", raising=False)
    return TestClient(app)


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_score_endpoint(client, model_dict, buyer_dict, target_dict):
    r = client.post("/v1/score", json={"model": model_dict, "buyer": buyer_dict, "target": target_dict})
    assert r.status_code == 200
    body = r.json()
    assert body["modelKey"] == "default-ma-matrix"
    assert body["grade"] in ("strong", "moderate", "weak")


def test_score_endpoint_rejects_bad_input(client, model_dict, buyer_dict):
    model_dict["criteria"][0]["signal"] = "vibes"
    r = client.post("/v1/score", json={"model": model_dict, "buyer": buyer_dict, "target": {}})
    assert r.status_code == 422


def test_classify_endpoint(client, buyer_dict):
    r = client.post("/v1/classify-buyer", json={"rules": RULES, "buyer": buyer_dict})
    assert r.status_code == 200
    assert r.json() == {"bucket": "Healthcare Platform", "matchedRuleKey": "health_platform", "explanation": r.json()["explanation"]}


def test_token_required_when_configured(monkeypatch, buyer_dict):
    monkeypatch.setenv("SCORING_SERVICE_TOKEN", "s3cret")
    c = TestClient(app)
    payload = {"rules": RULES, "buyer": buyer_dict}
    assert c.post("/v1/classify-buyer", json=payload).status_code == 401
    assert c.post("/v1/classify-buyer", json=payload, headers={"Authorization": "Bearer nope"}).status_code == 401
    assert c.post("/v1/classify-buyer", json=payload, headers={"Authorization": "Bearer s3cret"}).status_code == 200
    assert c.get("/health").status_code == 200


def test_lambda_handler_score_and_errors(monkeypatch, model_dict, buyer_dict, target_dict):
    monkeypatch.delenv("SCORING_SERVICE_TOKEN", raising=False)
    ev = {"rawPath": "/v1/score", "requestContext": {"http": {"method": "POST"}},
          "body": json.dumps({"model": model_dict, "buyer": buyer_dict, "target": target_dict})}
    r = handler(ev)
    assert r["statusCode"] == 200 and json.loads(r["body"])["modelVersion"] == 3
    assert handler({**ev, "body": "{not json"})["statusCode"] == 400
    assert handler({**ev, "body": json.dumps({"model": {}})})["statusCode"] == 422
    assert handler({"path": "/nope", "httpMethod": "POST", "body": "{}"})["statusCode"] == 404
    assert handler({"path": "/health", "httpMethod": "GET"})["statusCode"] == 200


def test_lambda_handler_auth(monkeypatch, buyer_dict):
    monkeypatch.setenv("SCORING_SERVICE_TOKEN", "tok")
    ev = {"path": "/v1/classify-buyer", "httpMethod": "POST", "body": json.dumps({"rules": RULES, "buyer": buyer_dict})}
    assert handler(ev)["statusCode"] == 401
    assert handler({**ev, "headers": {"Authorization": "Bearer tok"}})["statusCode"] == 200
