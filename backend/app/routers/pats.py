"""
Settings router - sync configuration.
PAT management is done via GITHUB_PAT environment variable in .env.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from ..services.pat_manager import pat_manager
from ..services.sync_manager import sync_manager
from ..services.data_collector import data_collector

router = APIRouter(tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    auto_sync_on_startup: bool | None = None
    sync_cron: str | None = None


# ------------------------------------------------------------------
# App settings
# ------------------------------------------------------------------

@router.get("/settings")
async def get_settings():
    """Get app settings (sync config, etc.)."""
    return pat_manager.get_settings()


@router.put("/settings")
async def update_settings(request: UpdateSettingsRequest):
    """Update app settings. Re-schedules cron sync if sync_cron changed."""
    kwargs = {}
    if request.auto_sync_on_startup is not None:
        kwargs["auto_sync_on_startup"] = request.auto_sync_on_startup
    if request.sync_cron is not None:
        kwargs["sync_cron"] = request.sync_cron

    settings = pat_manager.update_settings(**kwargs)

    # Re-schedule cron if sync_cron was updated
    if request.sync_cron is not None:
        sync_manager.stop_cron_scheduler()
        if request.sync_cron.strip():
            sync_manager.start_cron_scheduler(
                request.sync_cron.strip(),
                lambda log_fn: data_collector.sync_all(log_fn=log_fn),
            )

    return settings
