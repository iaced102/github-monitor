"""
Alerts API router — threshold configuration and active alert evaluation.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..services.alert_service import evaluate_alerts, load_config, save_config
from ..services.data_collector import data_collector

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/config")
async def get_alert_config():
    """Return current alert threshold configuration."""
    return load_config()


@router.post("/config")
async def update_alert_config(body: dict):
    """Save alert threshold configuration.

    Accepts partial or full config dict. Merges with existing config.
    Example body:
      { "enabled": true, "thresholds": { "inactive_rate": { "warn": 20, "critical": 35 } } }
    """
    cfg = load_config()
    # top-level enabled flag
    if "enabled" in body:
        cfg["enabled"] = bool(body["enabled"])
    # merge thresholds
    if "thresholds" in body and isinstance(body["thresholds"], dict):
        for key, updates in body["thresholds"].items():
            if key in cfg["thresholds"] and isinstance(updates, dict):
                cfg["thresholds"][key].update(updates)
    save_config(cfg)
    return {"ok": True, "config": cfg}


@router.get("/active")
async def get_active_alerts():
    """Evaluate all thresholds against latest data and return active alerts."""
    try:
        alerts = evaluate_alerts(data_collector)
        return {
            "alerts": alerts,
            "count": len(alerts),
            "critical": sum(1 for a in alerts if a["level"] == "critical"),
            "warning": sum(1 for a in alerts if a["level"] == "warning"),
        }
    except Exception as e:
        return {"alerts": [], "count": 0, "critical": 0, "warning": 0, "error": str(e)}
