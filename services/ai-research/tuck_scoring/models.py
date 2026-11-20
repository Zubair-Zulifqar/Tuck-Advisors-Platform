"""Pydantic models mirroring packages/shared/src/matrix.ts and research.ts (fitScoreResult).

JSON field names are camelCase so the TypeScript zod schemas validate responses unchanged.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Signal = Literal[
    "industry_overlap",
    "business_model_alignment",
    "product_synergy",
    "customer_overlap",
    "geographic_synergy",
    "scale_compatibility",
    "strategic_fit",
    "acquisition_criteria",
]
SIGNALS: tuple[str, ...] = Signal.__args__  # type: ignore[attr-defined]

Grade = Literal["strong", "moderate", "weak", "excluded", "insufficient_data"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore", protected_namespaces=())

    def dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json")


class MatrixCriterion(CamelModel):
    key: str = Field(pattern=r"^[a-z0-9_]+$", max_length=60)
    label: str = Field(max_length=120)
    signal: Signal
    weight: float = Field(ge=0, le=100)
    required: bool = False
    params: dict[str, Any] = Field(default_factory=dict)


class ExclusionRule(CamelModel):
    key: str = Field(pattern=r"^[a-z0-9_]+$", max_length=60)
    description: str = Field(max_length=300)
    field: Literal["industry", "geography", "business_model", "tags", "employee_range"]
    operator: Literal["in", "not_in", "contains"]
    values: list[str] = Field(min_length=1)
    applies_to: Literal["target", "buyer"]


class Thresholds(CamelModel):
    strong: float = Field(default=70, ge=0, le=100)
    moderate: float = Field(default=45, ge=0, le=100)


class MatrixModel(CamelModel):
    key: str = Field(pattern=r"^[a-z0-9_-]+$", max_length=60)
    name: str = Field(max_length=120)
    description: str = ""
    version: int = Field(default=1, ge=1)
    criteria: list[MatrixCriterion] = Field(min_length=1, max_length=40)
    exclusions: list[ExclusionRule] = Field(default_factory=list, max_length=40)
    thresholds: Thresholds = Field(default_factory=Thresholds)
    min_coverage: float = Field(default=0.5, ge=0, le=1)


class ScoringFacts(CamelModel):
    """Only verified / sourced facts belong here. Unknown values stay None / empty."""

    name: str
    industry: Optional[str] = None
    industry_keywords: list[str] = Field(default_factory=list)
    business_model: Optional[str] = None
    products: list[str] = Field(default_factory=list)
    customer_segments: list[str] = Field(default_factory=list)
    geographies: list[str] = Field(default_factory=list)
    employee_count: Optional[float] = None
    revenue_usd: Optional[float] = None
    revenue_verified: bool = False
    strategic_themes: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    evidence: dict[str, list[str]] = Field(default_factory=dict)


class MatrixCellResult(CamelModel):
    criterion_key: str
    label: str
    weight: float
    score: Optional[float] = Field(default=None, ge=0, le=1)
    contribution: float
    rationale: str
    evidence: list[str] = Field(default_factory=list)
    missing: bool


class ExclusionHit(CamelModel):
    rule_key: str
    reason: str


class FitScoreResult(CamelModel):
    model_key: str
    model_version: int
    score: Optional[float] = Field(default=None, ge=0, le=100)
    grade: Grade
    confidence: float = Field(ge=0, le=1)
    coverage: float = Field(ge=0, le=1)
    cells: list[MatrixCellResult]
    exclusions: list[ExclusionHit]
    explanation: list[str]


class ScoreRequest(CamelModel):
    model: MatrixModel
    buyer: ScoringFacts
    target: ScoringFacts


class BucketCondition(CamelModel):
    field: str
    operator: Literal["in", "not_in", "contains", "gte", "lte"]
    values: list[Any] = Field(min_length=1)


class BucketRule(CamelModel):
    key: str
    bucket: str
    priority: int = 100
    conditions: list[BucketCondition] = Field(default_factory=list)


class ClassifyRequest(CamelModel):
    rules: list[BucketRule]
    buyer: ScoringFacts


class ClassifyResult(CamelModel):
    bucket: Optional[str]
    matched_rule_key: Optional[str]
    explanation: list[str]
