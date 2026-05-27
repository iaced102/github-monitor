"""
Operations executor - handles management of AI-recommended actions.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from ..config import config

if TYPE_CHECKING:
    from .database import Database


def _get_db() -> "Database | None":
    """Lazy-import the global DB to avoid circular imports."""
    from . import database
    return database.db


class OpsExecutor:
    """Manages AI-recommended operational actions."""

    def __init__(self):
        pass

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    def _load_recommendations(self) -> list[dict]:
        db = _get_db()
        if db is not None:
            return db.get_recommendations("all")
        # JSON fallback
        rec_file = config.data_dir / "recommendations.json"
        if not rec_file.exists():
            return []
        return json.loads(rec_file.read_text(encoding="utf-8"))

    def _save_recommendations(self, recs: list[dict]):
        """Used only for JSON fallback mode."""
        rec_file = config.data_dir / "recommendations.json"
        rec_file.write_text(json.dumps(recs, indent=2, default=str), encoding="utf-8")

    def _find_recommendation(self, recommendation_id: str) -> dict | None:
        db = _get_db()
        if db is not None:
            return db.get_recommendation(recommendation_id)
        for r in self._load_recommendations():
            if r.get("id") == recommendation_id:
                return r
        return None

    def _update_recommendation(self, recommendation_id: str, updates: dict):
        db = _get_db()
        if db is not None:
            db.update_recommendation(recommendation_id, updates)
            return
        # JSON fallback
        recs = self._load_recommendations()
        for r in recs:
            if r.get("id") == recommendation_id:
                r.update(updates)
                break
        self._save_recommendations(recs)

    def _append_to_audit_log(self, entry: dict):
        db = _get_db()
        if db is not None:
            db.append_audit_log(entry)
            return
        # JSON fallback
        log_file = config.data_dir / "audit_log.json"
        existing = []
        if log_file.exists():
            existing = json.loads(log_file.read_text(encoding="utf-8"))
        existing.append(entry)
        log_file.write_text(json.dumps(existing, indent=2, default=str), encoding="utf-8")

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    async def reject_recommendation(self, recommendation_id: str) -> dict:
        """Reject a pending recommendation."""
        target = self._find_recommendation(recommendation_id)
        if not target:
            return {"error": f"Recommendation {recommendation_id} not found"}

        self._update_recommendation(recommendation_id, {
            "status": "rejected",
            "rejected_at": datetime.now(timezone.utc).isoformat(),
        })
        return {"recommendation_id": recommendation_id, "status": "rejected"}

    def get_pending_recommendations(self) -> list:
        """Get all pending recommendations."""
        db = _get_db()
        if db is not None:
            return db.get_recommendations("pending")
        # JSON fallback
        return [r for r in self._load_recommendations() if r.get("status") == "pending"]


ops_executor = OpsExecutor()

