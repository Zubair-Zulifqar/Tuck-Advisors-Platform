# Tuck Scoring Service (`services/ai-research`)

Deterministic, explainable M&A Matrix / AI Fit Score engine. No LLM calls happen here: scores are
computed from **verified CRM facts only**, and unknown data yields `null` cell scores rather than guesses.

## Modules
| File | Purpose |
| --- | --- |
| `tuck_scoring/models.py` | Pydantic models mirroring `packages/shared` zod schemas (camelCase JSON). |
| `tuck_scoring/signals.py` | One pure function per matrix signal (industry, model, products, customers, geography, scale, strategy, acquisition criteria). |
| `tuck_scoring/engine.py` | Weighted scoring, coverage, exclusions, confidence, grade and explanation. |
| `tuck_scoring/buckets.py` | Configurable buyer-bucket classification (rules from DB). |
| `tuck_scoring/app.py` | FastAPI: `GET /health`, `POST /v1/score`, `POST /v1/classify-buyer`. |
| `tuck_scoring/lambda_handler.py` | AWS Lambda / API Gateway proxy entry point. |
| `tuck_scoring/batch.py` | Batch-score all buyer × target pairs and write `public.fit_scores` (Supabase or Cloud SQL). |

## Run
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest              # tests
.venv/bin/uvicorn tuck_scoring.app:app --port 8000
DATABASE_URL=postgres://... .venv/bin/python -m tuck_scoring.batch --org <uuid> --model-key default-ma-matrix --dry-run
```
Set `SCORING_SERVICE_TOKEN` to require `Authorization: Bearer <token>` on `/v1/*`.

## Scoring rules
- Cell score in `[0,1]` or `null` (missing data). Missing cells contribute 0 and are listed in the explanation.
- `coverage` = scored weight / total weight. Below `minCoverage`, or a `required` criterion missing → `insufficient_data`, `score: null`.
- Any matching exclusion rule → `excluded`, `score: 0` (cells still returned).
- Otherwise `score = Σ weight/scoredWeight × cellScore × 100`; graded by `thresholds`.
- `confidence = coverage × mean(1.0 if cell has evidence else 0.6)`.
- Revenue is used only when `revenueVerified` is true for both companies.
