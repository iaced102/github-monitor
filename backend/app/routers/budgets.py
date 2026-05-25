"""
Budget management API — set monthly budgets per org and track utilization.
Budgets are stored in the SQLite database (budgets table).
"""

from __future__ import annotations

from fastapi import APIRouter

from ..services import database as db_module
from ..services.api_manager import api_manager
from ..services.data_collector import data_collector

router = APIRouter(prefix="/budgets", tags=["budgets"])


@router.get("")
async def list_budgets():
    """Return all budget configs with current utilization."""
    db = db_module.db
    budgets = db.get_all_budgets() if db else {}
    all_billing = data_collector.load_all_latest("billing")

    results = []
    for org, cfg in budgets.items():
        billing = all_billing.get(org, {}) if isinstance(all_billing.get(org), dict) else {}
        monthly_cost = billing.get("monthly_cost", 0) or 0
        budget_usd = cfg.get("monthly_budget_usd", 0)
        utilization_pct = round(monthly_cost / budget_usd * 100, 1) if budget_usd > 0 else None
        results.append({
            "org": org,
            "monthly_budget_usd": budget_usd,
            "current_cost_usd": monthly_cost,
            "utilization_pct": utilization_pct,
            "status": (
                "critical" if utilization_pct is not None and utilization_pct >= 90
                else "warning" if utilization_pct is not None and utilization_pct >= 75
                else "ok"
            ),
            "note": cfg.get("note", ""),
        })

    # Add orgs that have cost data but no budget configured
    for org, data in all_billing.items():
        if org not in budgets and isinstance(data, dict) and data.get("monthly_cost"):
            results.append({
                "org": org,
                "monthly_budget_usd": None,
                "current_cost_usd": data.get("monthly_cost", 0) or 0,
                "utilization_pct": None,
                "status": "unset",
                "note": "",
            })

    results.sort(key=lambda r: (r["monthly_budget_usd"] is None, r["org"]))
    return {"budgets": results}


@router.post("/{org}")
async def set_budget(org: str, body: dict):
    """Set or update budget for an org.

    Body: { "monthly_budget_usd": 5000, "note": "optional note" }
    """
    budget_usd = body.get("monthly_budget_usd")
    if budget_usd is None or not isinstance(budget_usd, (int, float)) or budget_usd <= 0:
        return {"error": "monthly_budget_usd must be a positive number"}

    db = db_module.db
    if db:
        db.set_budget(org, float(budget_usd), str(body.get("note", "")))
    return {"ok": True, "org": org, "monthly_budget_usd": budget_usd}


@router.delete("/{org}")
async def delete_budget(org: str):
    """Remove budget configuration for an org."""
    db = db_module.db
    if db and db.delete_budget(org):
        return {"ok": True}
    return {"error": f"No budget configured for org '{org}'"}
