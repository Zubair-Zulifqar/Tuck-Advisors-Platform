"""AWS Lambda (API Gateway proxy) entry point. No dependencies beyond the engine itself."""

from __future__ import annotations

import base64
import hmac
import json
import os
from typing import Any

from pydantic import ValidationError

from .buckets import classify_buyer
from .engine import score
from .models import ClassifyRequest, ScoreRequest


def _resp(status: int, body: Any) -> dict:
    return {"statusCode": status, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def handler(event: dict, context: Any = None) -> dict:
    path = event.get("rawPath") or event.get("path") or ""
    method = (event.get("requestContext", {}).get("http", {}).get("method") or event.get("httpMethod") or "GET").upper()

    if path.endswith("/health"):
        return _resp(200, {"status": "ok"})

    expected = os.environ.get("SCORING_SERVICE_TOKEN")
    if expected:
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        auth = headers.get("authorization", "")
        supplied = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            return _resp(401, {"detail": "Invalid or missing bearer token"})

    if method != "POST":
        return _resp(405, {"detail": "Method not allowed"})
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        payload = json.loads(raw)
        if path.endswith("/v1/score"):
            req = ScoreRequest.model_validate(payload)
            return _resp(200, score(req.model, req.buyer, req.target).dump())
        if path.endswith("/v1/classify-buyer"):
            creq = ClassifyRequest.model_validate(payload)
            return _resp(200, classify_buyer(creq.rules, creq.buyer).dump())
    except json.JSONDecodeError:
        return _resp(400, {"detail": "Body must be JSON"})
    except ValidationError as e:
        return _resp(422, {"detail": json.loads(e.json())})
    return _resp(404, {"detail": "Not found"})
