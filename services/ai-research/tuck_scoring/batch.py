"""Batch scorer: score every buyer × target pair of an organisation and persist to public.fit_scores.

Usage:
    DATABASE_URL=postgres://... python -m tuck_scoring.batch --org <uuid> --model-key default-ma-matrix [--dry-run]

Facts are built only from stored CRM columns (industry, tags, headquarters, employee_range,
custom_fields). AI-generated assumptions are never used as scoring inputs. Works against
Supabase Postgres or Google Cloud SQL for PostgreSQL.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from typing import Any, Optional

from .engine import score
from .models import MatrixModel, ScoringFacts


def parse_employee_range(r: Optional[str]) -> Optional[float]:
    """'51-200' → 125.5 (midpoint), '5000+' → 5000, '120' → 120. Unknown → None."""
    if not r:
        return None
    nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*", r)]
    if not nums:
        return None
    if len(nums) >= 2:
        return (nums[0] + nums[1]) / 2
    return nums[0]


def _list(v: Any) -> list[str]:
    if isinstance(v, list):
        return [str(x) for x in v if x]
    if isinstance(v, str) and v.strip():
        return [s.strip() for s in v.split(",") if s.strip()]
    return []


def facts_from_company(row: dict[str, Any]) -> ScoringFacts:
    cf: dict[str, Any] = row.get("custom_fields") or {}
    if isinstance(cf, str):
        cf = json.loads(cf)
    revenue = cf.get("revenue_usd")
    return ScoringFacts(
        name=row["name"],
        industry=row.get("industry"),
        industry_keywords=_list(cf.get("industry_keywords")),
        business_model=cf.get("business_model") if isinstance(cf.get("business_model"), str) else None,
        products=_list(cf.get("products")),
        customer_segments=_list(cf.get("customer_segments")),
        geographies=[row["headquarters"]] + _list(cf.get("geographies")) if row.get("headquarters") else _list(cf.get("geographies")),
        employee_count=parse_employee_range(row.get("employee_range")),
        revenue_usd=float(revenue) if isinstance(revenue, (int, float)) else None,
        # Revenue counts only when a human explicitly marked it verified in the CRM.
        revenue_verified=cf.get("revenue_verified") is True,
        strategic_themes=_list(cf.get("strategic_themes")),
        tags=list(row.get("tags") or []),
    )


def run(org: str, model_key: str, dry_run: bool, dsn: str) -> dict[str, int]:
    import psycopg
    from psycopg.rows import dict_row

    uuid.UUID(org)  # validate
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, key, version, name, definition from public.matrix_models "
                "where organization_id = %s and key = %s and is_active limit 1",
                (org, model_key),
            )
            m = cur.fetchone()
            if not m:
                raise SystemExit(f"No active matrix model '{model_key}' for organisation {org}")
            definition = m["definition"] if isinstance(m["definition"], dict) else json.loads(m["definition"])
            model = MatrixModel.model_validate({**definition, "key": m["key"], "version": m["version"], "name": m["name"]})

            cols = "id, name, industry, tags, headquarters, employee_range, custom_fields, kind"
            cur.execute(
                f"select {cols} from public.companies where organization_id = %s and deleted_at is null and kind in ('buyer','target')",
                (org,),
            )
            rows = cur.fetchall()
            buyers = [r for r in rows if r["kind"] == "buyer"]
            targets = [r for r in rows if r["kind"] == "target"]
            written = 0
            for b in buyers:
                for t in targets:
                    result = score(model, facts_from_company(b), facts_from_company(t))
                    if dry_run:
                        print(f"{b['name']} × {t['name']}: {result.grade} {result.score}")
                        continue
                    cur.execute(
                        "insert into public.fit_scores (organization_id, matrix_model_id, buyer_company_id, target_company_id,"
                        " score, grade, confidence, result) values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
                        (org, m["id"], b["id"], t["id"], result.score, result.grade, result.confidence, json.dumps(result.dump())),
                    )
                    written += 1
        if not dry_run:
            conn.commit()
    return {"buyers": len(buyers), "targets": len(targets), "written": written}


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Score all buyer × target pairs for an organisation.")
    ap.add_argument("--org", required=True, help="organization uuid")
    ap.add_argument("--model-key", default="default-ma-matrix")
    ap.add_argument("--dry-run", action="store_true", help="print scores without writing")
    args = ap.parse_args(argv)
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    print(json.dumps(run(args.org, args.model_key, args.dry_run, dsn)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
