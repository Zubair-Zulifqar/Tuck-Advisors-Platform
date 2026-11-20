# Fit Score service on AWS Lambda

`services/ai-research/tuck_scoring/lambda_handler.py` exposes `handler(event, context)` for API Gateway
(HTTP API v2 or REST proxy). It serves `GET /health`, `POST /v1/score` and `POST /v1/classify-buyer`, and
enforces `Authorization: Bearer $SCORING_SERVICE_TOKEN` (constant-time compare) when the variable is set.

```bash
cd infrastructure/aws/lambda
sam build --use-container          # installs services/ai-research/requirements.txt (pydantic) for Linux
sam deploy --guided --parameter-overrides ScoringServiceToken=<random-token>
```

Then set `SCORING_SERVICE_URL` (stack output) and `SCORING_SERVICE_TOKEN` in the web app/worker environment.

> **Not deployed.** These are templates only; deploying creates billable AWS resources and requires explicit approval.
The batch scorer (`python -m tuck_scoring.batch`) needs database access and is better run as a scheduled
container (ECS/Cloud Run) than as Lambda.
