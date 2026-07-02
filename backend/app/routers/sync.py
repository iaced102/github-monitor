"""
Data sync router - triggers data collection from GitHub API.
Supports background sync with real-time SSE log streaming.
"""

import asyncio
import json
import os

from fastapi import APIRouter, Query
from pydantic import BaseModel
from starlette.responses import StreamingResponse

from ..services.api_manager import api_manager
from ..services.data_collector import DataCollector, data_collector, create_session_collector
from ..services.github_app_auth import github_app_auth
from ..services.pat_manager import pat_manager
from ..services.session_manager import SESSIONS_DIR
from ..services.sync_manager import sync_manager

router = APIRouter(tags=["sync"])


class ReloadPatRequest(BaseModel):
    token: str = ""  # If provided, update GITHUB_PAT in os.environ before rebuild


def _get_collectors(session_id: str | None) -> list[DataCollector]:
    """Return the list of collectors to sync into.
    Always includes the global collector; adds a session collector when session_id is given."""
    collectors = [data_collector]
    if session_id:
        session_dir = SESSIONS_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        collectors.append(create_session_collector(session_dir, api_manager=api_manager))
    return collectors


@router.get("/sync-stream")
async def sync_stream():
    """SSE endpoint for real-time sync log streaming.
    Stays open and pushes events as syncs occur.
    Note: Uses /sync-stream (not /sync/stream) to avoid route conflict with POST /sync/{org}."""

    async def event_generator():
        queue = sync_manager.subscribe()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Keepalive ping to prevent connection timeout
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            sync_manager.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sync")
async def sync_all(session_id: str | None = Query(default=None), month: str = Query(default="")):
    """Trigger a full data sync for all discovered organizations.
    Optional month param (e.g. '2026-06') syncs AI credits for that specific month.
    Returns immediately; sync runs in background with logs streamed via /sync/stream."""
    if sync_manager.is_syncing:
        return {"status": "already_syncing"}

    collectors = _get_collectors(session_id)

    async def _do_sync(log_fn):
        for collector in collectors:
            await collector.sync_all(log_fn=log_fn, credits_month=month.strip() or None)

    sync_manager.run_in_background(_do_sync)
    return {"status": "started"}


@router.post("/sync/{org}")
async def sync_org(org: str, session_id: str | None = Query(default=None)):
    """Trigger data sync for a specific organization.
    Returns immediately; sync runs in background."""
    if sync_manager.is_syncing:
        return {"status": "already_syncing"}

    collectors = _get_collectors(session_id)

    async def _do_sync(log_fn):
        for collector in collectors:
            await collector.sync_org(org, log_fn=log_fn)

    sync_manager.run_in_background(_do_sync)
    return {"status": "started"}


@router.get("/sync/status")
async def sync_status():
    """Get current discovery and sync status."""
    from datetime import date, timedelta

    all_orgs = api_manager.get_all_orgs()
    orgs_with_data = []
    for org_info in all_orgs:
        org_name = org_info["login"]
        has_seats = data_collector.load_latest("seats", org_name) is not None
        has_billing = data_collector.load_latest("billing", org_name) is not None
        has_usage = data_collector.load_latest("usage", org_name) is not None
        has_usage_users = data_collector.load_latest("usage_users", org_name) is not None
        has_metrics = data_collector.load_latest("metrics", org_name) is not None
        has_premium_requests = data_collector.load_latest("premium_requests", org_name) is not None
        orgs_with_data.append({
            "org": org_name,
            "has_seats": has_seats,
            "has_billing": has_billing,
            "has_usage": has_usage,
            "has_usage_users": has_usage_users,
            "has_metrics": has_metrics,
            "has_premium_requests": has_premium_requests,
        })

    # Data freshness: check latest day in DB
    latest_usage_day = None
    all_scope_names = [o["login"] for o in all_orgs]
    for ent in api_manager.get_all_enterprises():
        slug = ent.get("slug", "")
        if slug and slug not in all_scope_names:
            all_scope_names.append(slug)
    for scope in all_scope_names:
        usage = data_collector.load_latest("usage", scope)
        if usage and usage.get("report_end_day"):
            day = usage["report_end_day"]
            if not latest_usage_day or day > latest_usage_day:
                latest_usage_day = day

    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    users = api_manager.get_discovered_users()
    user_logins = [u.get("login", "") for u in users.values()]

    return {
        "users": user_logins,
        "total_orgs": len(all_orgs),
        "orgs": orgs_with_data,
        "is_syncing": sync_manager.is_syncing,
        "data_freshness": {
            "latest_data_day": latest_usage_day,
            "today": today,
            "delay_note": "GitHub reports are generated ~24h after activity. Data for yesterday/today may not be available yet.",
            "data_current": latest_usage_day == yesterday or latest_usage_day == today if latest_usage_day else False,
        },
    }


@router.post("/settings/reload-pat")
async def reload_pat(body: ReloadPatRequest):
    """Reload the GitHub authentication without restarting the server.

    For GitHub App mode: invalidates the cached installation token and rebuilds.
    For PAT mode: if a token is provided, updates GITHUB_PAT in the runtime environment.
    """
    if pat_manager.auth_mode == "github_app":
        github_app_auth.invalidate()
        pat_manager._app_pat_meta = None
    elif body.token.strip():
        os.environ["GITHUB_PAT"] = body.token.strip()
        pat_manager._pat_meta = None

    try:
        await api_manager.rebuild()
    except Exception as e:
        return {"ok": False, "error": str(e)}

    orgs = [o["login"] for o in api_manager.get_all_orgs()]
    enterprises = [e["slug"] for e in api_manager.get_all_enterprises()]
    users = api_manager.get_discovered_users()
    user_logins = [u.get("login", "") for u in users.values()]

    return {
        "ok": True,
        "auth_mode": pat_manager.auth_mode,
        "message": "Auth reloaded successfully. Run Sync Data to refresh seat/usage data.",
        "authenticated_as": user_logins,
        "orgs_discovered": orgs,
        "enterprises_discovered": enterprises,
    }
