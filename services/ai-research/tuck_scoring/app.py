"""FastAPI service exposing the M&A Matrix scoring engine."""

from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException

from . import __version__
from .buckets import classify_buyer
from .engine import score
from .models import ClassifyRequest, ScoreRequest

app = FastAPI(title="Tuck Advisors Scoring Service", version=__version__)


def require_token(authorization: Optional[str] = Header(default=None)) -> None:
    expected = os.environ.get("SCORING_SERVICE_TOKEN")
    if not expected:
        return
    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "tuck-scoring", "version": __version__}


@app.post("/v1/score", dependencies=[Depends(require_token)])
def score_endpoint(req: ScoreRequest) -> dict:
    return score(req.model, req.buyer, req.target).dump()


@app.post("/v1/classify-buyer", dependencies=[Depends(require_token)])
def classify_endpoint(req: ClassifyRequest) -> dict:
    return classify_buyer(req.rules, req.buyer).dump()
