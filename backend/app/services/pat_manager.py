"""
PAT Manager — GitHub Personal Access Token management.
When GITHUB_PAT env var is set, it is the sole source of truth.
Sync settings (AUTO_SYNC_ON_STARTUP, SYNC_CRON) are read from environment variables.
"""

import os


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
    """Manages the active GitHub PAT, sourced entirely from environment variables."""

    def __init__(self):
        self._env_pat_meta: dict | None = None

    def load(self) -> list[dict]:
        """Initialize PAT from environment. Returns list of active PATs."""
        if os.environ.get("GITHUB_PAT", "").strip():
            print("[PATManager] GITHUB_PAT env var is set — using env as source of truth")
        return self.get_all()

    def _get_env_pat(self) -> dict | None:
        """Build a synthetic PAT dict from GITHUB_PAT env var, or None if not set."""
        token = os.environ.get("GITHUB_PAT", "").strip()
        if not token:
            return None
        if self._env_pat_meta is None:
            env_slug = os.environ.get("ENTERPRISE_SLUG", "").strip()
            enterprise_slugs = [s.strip() for s in env_slug.split(",") if s.strip()] if env_slug else []
            self._env_pat_meta = {
                "id": "env_pat",
                "label": "GITHUB_PAT (.env)",
                "user_login": "",
                "user_avatar": "",
                "orgs": [],
                "enterprise_slugs": enterprise_slugs,
                "created_at": "",
                "last_synced_at": "",
            }
        return {**self._env_pat_meta, "token": token}

    def get_settings(self) -> dict:
        """Return sync settings from environment variables."""
        return _settings_from_env()

    def get_all(self) -> list[dict]:
        """Return all PATs. When GITHUB_PAT env is set, returns only the env PAT."""
        env_pat = self._get_env_pat()
        return [env_pat] if env_pat else []

    def get_token(self, pat_id: str) -> str | None:
        """Get the raw token for a PAT ID."""
        env_pat = self._get_env_pat()
        return env_pat["token"] if env_pat else None

    def update(self, pat_id: str, **kwargs) -> dict | None:
        """Update in-memory metadata for the env PAT (never persisted)."""
        env_pat = self._get_env_pat()
        if env_pat and self._env_pat_meta is not None:
            for key, value in kwargs.items():
                if key not in ("id", "token"):
                    self._env_pat_meta[key] = value
            return self._get_env_pat()
        return None

    def find_by_id(self, pat_id: str) -> dict | None:
        """Find a PAT by ID."""
        return self._get_env_pat()


# Global instance
pat_manager = PATManager()

