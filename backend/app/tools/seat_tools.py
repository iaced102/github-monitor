"""
Copilot seat management tools for the AI engine.
These tools are registered with CopilotSession so the AI can analyze seat data.
Read-only: no GitHub write operations.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from copilot import define_tool

from ..services.data_collector import DataCollector


class GetAllSeatsParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty to get seats for all discovered orgs.")


class FindInactiveUsersParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")
    days: int = Field(default=30, description="Number of days of inactivity to consider a user inactive.")


def create_seat_tools(collector: DataCollector) -> list:
    """Create seat tools bound to a specific DataCollector (read-only)."""

    @define_tool(description="Get Copilot seat summary across organizations: total seats, active/inactive counts, per-org breakdown. Does not return full user list (use find_inactive_users for user details).")
    def get_all_seats(params: GetAllSeatsParams) -> str:
        from datetime import datetime, timezone as tz
        now = datetime.now(tz.utc)

        def _summarize(org: str, data: dict) -> dict:
            seats = data.get("seats", [])
            total = data.get("total_seats", len(seats))
            active = 0
            for s in seats:
                last = s.get("last_activity_at")
                if last:
                    try:
                        if (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).days < 30:
                            active += 1
                    except (ValueError, TypeError):
                        pass
            return {
                "org": org,
                "total_seats": total,
                "active_seats_30d": active,
                "inactive_seats_30d": total - active,
            }

        if params.org:
            data = collector.load_latest("seats", params.org)
            if not data:
                return json.dumps({"error": f"No seat data found for org '{params.org}'. Try syncing first."})
            return json.dumps(_summarize(params.org, data))
        else:
            all_data = collector.load_all_latest("seats")
            if not all_data:
                return json.dumps({"error": "No seat data found. Try syncing first."})
            orgs = [_summarize(org, data) for org, data in all_data.items()]
            return json.dumps({
                "grand_total_seats": sum(o["total_seats"] for o in orgs),
                "grand_active_seats_30d": sum(o["active_seats_30d"] for o in orgs),
                "grand_inactive_seats_30d": sum(o["inactive_seats_30d"] for o in orgs),
                "organizations": orgs,
            })

    @define_tool(description="Find Copilot users who have been inactive for N days. Returns list of inactive users with their last activity date and cost impact.")
    def find_inactive_users(params: FindInactiveUsersParams) -> str:
        orgs_to_check = [params.org] if params.org else list(collector.load_all_latest("seats").keys())
        now = datetime.now(timezone.utc)
        inactive_users = []

        for org in orgs_to_check:
            seats_data = collector.load_latest("seats", org)
            billing_data = collector.load_latest("billing", org)
            price_per_seat = 19.0  # default
            if billing_data:
                price_per_seat = billing_data.get("_detected_price_per_seat", 19.0)

            if not seats_data:
                continue

            for seat in seats_data.get("seats", []):
                last_activity = seat.get("last_activity_at")
                if last_activity:
                    try:
                        last_dt = datetime.fromisoformat(last_activity.replace("Z", "+00:00"))
                        days_inactive = (now - last_dt).days
                    except (ValueError, TypeError):
                        days_inactive = 999
                else:
                    days_inactive = 999  # never used

                if days_inactive >= params.days:
                    assignee = seat.get("assignee", {})
                    inactive_users.append({
                        "org": org,
                        "login": assignee.get("login", "unknown"),
                        "last_activity_at": last_activity,
                        "days_inactive": days_inactive,
                        "last_activity_editor": seat.get("last_activity_editor"),
                        "monthly_cost": price_per_seat,
                        "team": (seat.get("assigning_team") or {}).get("name"),
                    })

        inactive_users.sort(key=lambda x: x["days_inactive"], reverse=True)
        total_waste = sum(u["monthly_cost"] for u in inactive_users)
        # Limit to top 50 to avoid hitting tool result size limits
        truncated = len(inactive_users) > 50
        return json.dumps({
            "inactive_users": inactive_users[:50],
            "total_count": len(inactive_users),
            "shown_count": min(len(inactive_users), 50),
            "truncated": truncated,
            "total_monthly_waste": total_waste,
            "threshold_days": params.days,
        })

    return [get_all_seats, find_inactive_users]
