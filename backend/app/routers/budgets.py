"""
Budget management API — set monthly budgets per org and track utilization.
Budgets stored in data/budgets.json.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

from ..config import DATA_DIR
from ..services.api_manager import api_manager
from ..services.data_collector import data_collector

router = APIRouter(prefix="/budgets", tags=["budgets"])

_BUDGETS_FILE = DATA_DIR / "budgets.json"


def _load() -> dict:
    if _BUDGETS_FILE.exists():
        try:
            with open(_BUDGETS_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save(data: dict) -> None:
    _BUDGETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_BUDGETS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@router.get("")
async def list_budgets():
    """Return all budget configs with current utilization."""
    budgets = _load()
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

    budgets = _load()
    budgets[org] = {
        "monthly_budget_usd": float(budget_usd),
        "note": str(body.get("note", "")),
    }
    _save(budgets)
    return {"ok": True, "org": org, "monthly_budget_usd": budget_usd}


@router.delete("/{org}")
async def delete_budget(org: str):
    """Remove budget configuration for an org."""
    budgets = _load()
    if org not in budgets:
        return {"error": f"No budget configured for org '{org}'"}
    del budgets[org]
    _save(budgets)
    return {"ok": True}
