"""
Operational action tools for the AI engine.
Read-only: records and retrieves recommendations only (no GitHub write operations).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from copilot import define_tool

from ..config import config
from ..services.data_collector import DataCollector


def _get_db():
    """Lazy-import the global DB to avoid circular imports at module load time."""
    from ..services import database
    return database.db


class RecordRecommendationParams(BaseModel):
    org: str = Field(description="Organization name")
    recommendation_type: str = Field(description="Type: 'remove_seats', 'send_reminder', 'upgrade_plan', 'downgrade_plan'")
    affected_users: list[str] = Field(default_factory=list, description="Users affected by recommendation")
    description: str = Field(description="Human-readable description of the recommendation")
    estimated_monthly_savings: float = Field(default=0, description="Estimated monthly cost savings in USD")


class GetRecommendationsParams(BaseModel):
    status: str = Field(default="pending", description="Filter by status: 'pending', 'approved', 'rejected', 'executed', or 'all'")


def create_action_tools(api_manager=None, collector: DataCollector | None = None) -> list:
    """Create action tools (read-only: no GitHub write operations)."""

    @define_tool(description="Record an AI-generated recommendation for admin review. Recommendations are stored and shown in the Action Panel for confirmation.")
    def record_recommendation(params: RecordRecommendationParams) -> str:
        rec = {
            "id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "org": params.org,
            "type": params.recommendation_type,
            "affected_users": params.affected_users,
            "description": params.description,
            "estimated_monthly_savings": params.estimated_monthly_savings,
            "status": "pending",
        }

        db = _get_db()
        if db is not None:
            db.save_recommendation(rec)
        else:
            # JSON fallback
            rec_file = config.data_dir / "recommendations.json"
            existing = []
            if rec_file.exists():
                existing = json.loads(rec_file.read_text(encoding="utf-8"))
            existing.append(rec)
            rec_file.write_text(json.dumps(existing, indent=2, default=str), encoding="utf-8")

        return json.dumps({"recorded": True, "recommendation": rec})

    @define_tool(description="Get recorded recommendations. Can filter by status (pending/approved/rejected/executed/all).")
    def get_recommendations(params: GetRecommendationsParams) -> str:
        db = _get_db()
        if db is not None:
            recs = db.get_recommendations(params.status)
            return json.dumps({"recommendations": recs, "count": len(recs)})

        # JSON fallback
        rec_file = config.data_dir / "recommendations.json"
        if not rec_file.exists():
            return json.dumps({"recommendations": [], "count": 0})

        recs = json.loads(rec_file.read_text(encoding="utf-8"))
        if params.status != "all":
            recs = [r for r in recs if r.get("status") == params.status]

        return json.dumps({"recommendations": recs, "count": len(recs)})

    return [record_recommendation, get_recommendations]
