"""
PAT Manager — GitHub authentication management.
Priority: GitHub App (if configured) > GITHUB_PAT env var.
Sync settings (AUTO_SYNC_ON_STARTUP, SYNC_CRON) are read from environment variables.
"""

import os

from .github_app_auth import GitHubAppAuth, github_app_auth


def _settings_from_env() -> dict:
    """Read sync settings from environment variables."""
    result: dict = {
        "auto_sync_on_startup": True,
        "sync_cron": "",
    }
    env_auto_sync = os.environ.get("AUTO_SYNC_ON_STARTUP", "").strip().lower()
    if env_auto_sync in ("true", "false", "1", "0"):
        result["auto_sync_on_startup"] = env_auto_sync in ("true", "1")
    if "SYNC_CRON" in os.environ:
        env_cron = os.environ.get("SYNC_CRON", "").strip()
        result["sync_cron"] = "" if env_cron.lower() in ("off", "none") else env_cron
    return result


class PATManager:
    """Manages the active GitHub auth, preferring GitHub App over PAT."""

    def __init__(self):
        self._app_pat_meta: dict | None = None
        self._pat_meta: dict | None = None

    @property
    def auth_mode(self) -> str:
        """Return current auth mode: 'github_app' or 'pat'."""
        if github_app_auth.is_configured():
            return "github_app"
        return "pat"

    def load(self) -> list[dict]:
        """Initialize auth from environment. Returns list of active PATs."""
        if github_app_auth.is_configured():
            print("[PATManager] GitHub App configured — using app installation tokens")
        elif os.environ.get("GITHUB_PAT", "").strip():
            print("[PATManager] GITHUB_PAT env var is set — using env as source of truth")
        else:
            print("[PATManager] No authentication configured")
        return self.get_all()

    def _get_app_pat(self) -> dict | None:
        """Build a synthetic PAT dict for GitHub App auth."""
        if not github_app_auth.is_configured():
            return None
        if self._app_pat_meta is None:
            env_slug = os.environ.get("ENTERPRISE_SLUG", "").strip()
            enterprise_slugs = [s.strip() for s in env_slug.split(",") if s.strip()] if env_slug else []
            self._app_pat_meta = {
                "id": "github_app",
                "label": "GitHub App",
                "user_login": "",
                "user_avatar": "",
                "orgs": [],
                "enterprise_slugs": enterprise_slugs,
                "created_at": "",
                "last_synced_at": "",
                "auth_mode": "github_app",
            }
        return {**self._app_pat_meta, "token": "__github_app__"}

    def _get_env_pat(self) -> dict | None:
        """Build a synthetic PAT dict from GITHUB_PAT env var, or None if not set."""
        token = os.environ.get("GITHUB_PAT", "").strip()
        if not token:
            return None
        if self._pat_meta is None:
            env_slug = os.environ.get("ENTERPRISE_SLUG", "").strip()
            enterprise_slugs = [s.strip() for s in env_slug.split(",") if s.strip()] if env_slug else []
            self._pat_meta = {
                "id": "env_pat",
                "label": "GITHUB_PAT (.env)",
                "user_login": "",
                "user_avatar": "",
                "orgs": [],
                "enterprise_slugs": enterprise_slugs,
                "created_at": "",
                "last_synced_at": "",
                "auth_mode": "pat",
            }
        return {**self._pat_meta, "token": token}

    def get_settings(self) -> dict:
        """Return sync settings from environment variables."""
        return _settings_from_env()

    def get_all(self) -> list[dict]:
        """Return all PATs. GitHub App takes priority over PAT env var."""
        app_pat = self._get_app_pat()
        if app_pat:
            return [app_pat]
        env_pat = self._get_env_pat()
        return [env_pat] if env_pat else []

    def get_token(self, pat_id: str) -> str | None:
        """Get the raw token for a PAT ID."""
        if pat_id == "github_app":
            return "__github_app__"
        env_pat = self._get_env_pat()
        return env_pat["token"] if env_pat else None

    def update(self, pat_id: str, **kwargs) -> dict | None:
        """Update in-memory metadata (never persisted)."""
        meta = self._app_pat_meta if pat_id == "github_app" else self._pat_meta
        if meta is not None:
            for key, value in kwargs.items():
                if key not in ("id", "token", "auth_mode"):
                    meta[key] = value
            if pat_id == "github_app":
                return self._get_app_pat()
            return self._get_env_pat()
        return None

    def find_by_id(self, pat_id: str) -> dict | None:
        """Find a PAT by ID."""
        if pat_id == "github_app":
            return self._get_app_pat()
        return self._get_env_pat()


# Global instance
pat_manager = PATManager()

