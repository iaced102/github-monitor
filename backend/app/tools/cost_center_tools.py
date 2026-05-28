"""
GitHub Enterprise Cost Center management tools for the AI engine.
Uses the GitHub Billing Cost Centers REST API (version 2026-03-10).
All endpoints operate at the enterprise level.
Read-only: lists and reads cost centers only (no write operations).

Enterprise and cost center data is pre-synced during Sync Data and stored as JSON
files in the data directory. Tools read from this local cache for lookups.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from copilot import define_tool

if TYPE_CHECKING:
    from ..services.api_manager import APIManager
    from ..services.data_collector import DataCollector

# Cost Centers API requires a specific API version
_VERSION_HEADER = {"X-GitHub-Api-Version": "2026-03-10"}


# ---------------------------------------------------------------------------
# Pydantic param models
# ---------------------------------------------------------------------------

class ListCostCentersParams(BaseModel):
    enterprise: str = Field(
        default="",
        description=(
            "Enterprise slug (e.g. 'my-enterprise'). "
            "Leave empty to auto-detect from synced data."
        ),
    )
    state: str = Field(
        default="active",
        description="Filter by state: 'active' (default), 'archived', or 'all'",
    )


class GetCostCenterParams(BaseModel):
    enterprise: str = Field(
        default="",
        description="Enterprise slug. Leave empty to auto-detect from synced data.",
    )
    cost_center_id: str = Field(description="The unique ID of the cost center")


class GetSyncedEnterpriseDataParams(BaseModel):
    pass


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_cost_center_tools(
    api_manager: APIManager | None = None,
    collector: DataCollector | None = None,
) -> list:
    """Create cost center management tools bound to the given APIManager and DataCollector."""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_enterprises() -> list[dict]:
        """Load synced enterprise list from disk."""
        if collector is None:
            return []
        data = collector.load_latest("enterprise", "all")
        if isinstance(data, list):
            return data
        return []

    def _resolve_enterprise(requested: str) -> str | None:
        """
        Return the enterprise slug to use.
        - If `requested` is non-empty, return it as-is.
        - If empty, try to auto-detect:
            1. Check in-memory api_manager enterprises.
            2. Fall back to synced enterprise data from disk.
        Returns None if enterprise cannot be determined.
        """
        if requested:
            return requested

        # Try in-memory api_manager first
        if api_manager:
            enterprises = api_manager.get_all_enterprises()
            if len(enterprises) == 1:
                return enterprises[0]["slug"]
            if len(enterprises) > 1:
                return None  # ambiguous — caller must specify

        # Fall back to synced data
        enterprises = _load_enterprises()
        if len(enterprises) == 1:
            return enterprises[0]["slug"]
        return None

    def _enterprise_error(requested: str) -> str:
        """Build a helpful error message when enterprise can't be resolved."""
        enterprises = _load_enterprises()
        if api_manager:
            enterprises = api_manager.get_all_enterprises() or enterprises
        if enterprises:
            slugs = [e["slug"] for e in enterprises]
            return json.dumps({
                "error": (
                    "Multiple enterprises available. Please specify the enterprise slug. "
                    f"Available: {slugs}"
                )
            })
        return json.dumps({
            "error": (
                "No enterprise data found. "
                "Please run Sync Data first so enterprise information can be discovered, "
                "or provide the enterprise slug explicitly."
            )
        })

    def _get_api(enterprise: str):
        """Get an API client for the given enterprise slug."""
        if not api_manager:
            return None
        return api_manager.get_api_for_enterprise(enterprise)

    # ------------------------------------------------------------------
    # Tools
    # ------------------------------------------------------------------

    @define_tool(
        description=(
            "List all synced enterprises and their cost centers from local data. "
            "Use this to discover available enterprise slugs and existing cost centers "
            "without making a live API call. Run Sync Data first to populate this data."
        )
    )
    def get_synced_enterprise_data(_: GetSyncedEnterpriseDataParams) -> str:
        enterprises = _load_enterprises()
        if not enterprises and api_manager:
            enterprises = api_manager.get_all_enterprises()

        if not enterprises:
            return json.dumps({
                "message": "No enterprise data found. Please run Sync Data first.",
                "enterprises": [],
            })

        result = []
        for ent in enterprises:
            slug = ent["slug"]
            cc_data = None
            if collector:
                cc_data = collector.load_latest("cost_centers", slug)
            result.append({
                "slug": slug,
                "name": ent.get("name", ""),
                "role": ent.get("role", ""),
                "cost_centers": cc_data.get("cost_centers", []) if cc_data else [],
                "cost_centers_total": cc_data.get("total", 0) if cc_data else 0,
            })

        return json.dumps({"enterprises": result, "total": len(result)})

    @define_tool(
        description=(
            "List all cost centers for a GitHub Enterprise from live API. "
            "Returns cost center IDs, names, state, and resource assignments. "
            "Use state='active' (default), 'archived', or 'all'. "
            "Leave enterprise empty to auto-detect from synced data."
        )
    )
    async def list_cost_centers(params: ListCostCentersParams) -> str:
        enterprise = _resolve_enterprise(params.enterprise)
        if not enterprise:
            return _enterprise_error(params.enterprise)

        if not api_manager:
            return json.dumps({"error": "No API manager available."})
        api = _get_api(enterprise)
        if not api:
            return json.dumps({"error": f"No API client found for enterprise '{enterprise}'."})

        url = f"/enterprises/{enterprise}/settings/billing/cost-centers"
        query: dict = {}
        if params.state and params.state != "all":
            query["state"] = params.state

        results = []
        page = 1
        while True:
            query["per_page"] = 100
            query["page"] = page
            resp = await api.client.get(url, params=query, headers=_VERSION_HEADER)
            if resp.status_code == 404:
                return json.dumps({"error": "Enterprise not found or Cost Centers API not available."})
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list):
                batch = data
            else:
                batch = data.get("costCenters") or data.get("cost_centers") or []
            if not batch:
                break
            results.extend(batch)
            if len(batch) < 100:
                break
            page += 1

        return json.dumps({"enterprise": enterprise, "cost_centers": results, "total": len(results)})

    @define_tool(
        description=(
            "Get details for a specific cost center by its ID. "
            "Returns the cost center name, state, and all assigned resources (users, orgs, repos). "
            "Leave enterprise empty to auto-detect from synced data."
        )
    )
    async def get_cost_center(params: GetCostCenterParams) -> str:
        enterprise = _resolve_enterprise(params.enterprise)
        if not enterprise:
            return _enterprise_error(params.enterprise)

        if not api_manager:
            return json.dumps({"error": "No API manager available."})
        api = _get_api(enterprise)
        if not api:
            return json.dumps({"error": f"No API client found for enterprise '{enterprise}'."})

        url = f"/enterprises/{enterprise}/settings/billing/cost-centers/{params.cost_center_id}"
        resp = await api.client.get(url, headers=_VERSION_HEADER)
        if resp.status_code == 404:
            return json.dumps({"error": f"Cost center '{params.cost_center_id}' not found."})
        resp.raise_for_status()
        return json.dumps(resp.json())

    return [
        get_synced_enterprise_data,
        list_cost_centers,
        get_cost_center,
    ]
