"""
PAT Manager - handles persistence and CRUD for GitHub Personal Access Tokens.
PATs and app settings are stored in data/pats.json.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..config import DATA_DIR


PATS_FILE = DATA_DIR / "pats.json"

DEFAULT_SETTINGS = {
    "auto_sync_on_startup": True,
    "sync_cron": "",
}


def _settings_from_env() -> dict:
    """Read sync settings from environment variables (override file-based settings)."""
    result = {}
    env_auto_sync = os.environ.get("AUTO_SYNC_ON_STARTUP", "").strip().lower()
    if env_auto_sync in ("true", "false", "1", "0"):
        result["auto_sync_on_startup"] = env_auto_sync in ("true", "1")
    env_cron = os.environ.get("SYNC_CRON", "").strip()
    if env_cron or env_cron == "":
        # Only override if explicitly set (non-empty or explicitly empty string via "off"/"none")
        if "SYNC_CRON" in os.environ:
            result["sync_cron"] = "" if env_cron.lower() in ("off", "none") else env_cron
    return result


class PATManager:
    """Manages GitHub PAT persistence and app settings in data/pats.json."""

    def __init__(self):
        self._pats: list[dict] = []
        self._settings: dict = {**DEFAULT_SETTINGS}

    def load(self) -> list[dict]:
        """Load PATs and settings from file.

        Supports two formats:
        - Legacy: a plain JSON array of PATs
        - Current: ``{"pats": [...], "settings": {...}}``

        Auto-migrates legacy format on first load.
        """
        if PATS_FILE.exists():
            try:
                raw = json.loads(PATS_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                raw = []
        else:
            raw = []

        # Detect format and normalise
        if isinstance(raw, list):
            # Legacy format – plain array of PATs
            self._pats = raw
            self._settings = {**DEFAULT_SETTINGS}
            if raw:
                # Migrate to new format on disk
                self._save()
                print("[PATManager] Migrated pats.json from legacy array to {pats, settings} format")
        elif isinstance(raw, dict):
            self._pats = raw.get("pats", [])
            saved_settings = raw.get("settings", {})
            self._settings = {**DEFAULT_SETTINGS, **saved_settings}
        else:
            self._pats = []
            self._settings = {**DEFAULT_SETTINGS}

        # If GITHUB_PAT env var is set, it is the sole source of truth.
        # Ignore any PATs persisted in the file.
        if os.environ.get("GITHUB_PAT", "").strip():
            self._pats = []
            print("[PATManager] GITHUB_PAT env var is set — using env as source of truth, ignoring pats.json PATs")

        return self._pats

    def _save(self):
        """Write settings (and any non-env PATs) to file."""
        PATS_FILE.parent.mkdir(parents=True, exist_ok=True)
        # When env PAT is active, don't persist PATs to file (env is source of truth)
        pats_to_save = [] if os.environ.get("GITHUB_PAT", "").strip() else self._pats
        data = {
            "pats": pats_to_save,
            "settings": self._settings,
        }
        PATS_FILE.write_text(
            json.dumps(data, indent=2, default=str),
            encoding="utf-8",
        )

    def _get_env_pat(self) -> dict | None:
        """Build a synthetic PAT dict from GITHUB_PAT env var, or None if not set."""
        token = os.environ.get("GITHUB_PAT", "").strip()
        if not token:
            return None
        # Return cached env_pat (with any in-memory metadata updates)
        if not hasattr(self, "_env_pat_meta"):
            # Read optional enterprise slugs from env
            env_slug = os.environ.get("ENTERPRISE_SLUG", "").strip()
            enterprise_slugs = [s.strip() for s in env_slug.split(",") if s.strip()] if env_slug else []
            self._env_pat_meta: dict = {
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

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def get_settings(self) -> dict:
        """Return settings, with env vars taking priority over file-based settings."""
        merged = {**self._settings, **_settings_from_env()}
        return merged

    def update_settings(self, **kwargs) -> dict:
        """Update settings and persist. Returns the updated settings."""
        for key in DEFAULT_SETTINGS:
            if key in kwargs:
                self._settings[key] = kwargs[key]
        self._save()
        return {**self._settings}

    def get_all(self) -> list[dict]:
        """Return all PATs. If GITHUB_PAT env is set, returns only the env PAT."""
        env_pat = self._get_env_pat()
        if env_pat:
            return [env_pat]
        return list(self._pats)

    def get_all_masked(self) -> list[dict]:
        """Return all PATs with tokens masked for API responses."""
        result = []
        for p in self.get_all():
            masked = {**p}
            token = masked.get("token", "")
            if len(token) > 8:
                masked["token_masked"] = token[:4] + "***" + token[-4:]
            else:
                masked["token_masked"] = "***"
            del masked["token"]
            result.append(masked)
        return result

    def get_token(self, pat_id: str) -> str | None:
        """Get the raw token for a PAT ID. If GITHUB_PAT env is set, always returns it."""
        env_pat = self._get_env_pat()
        if env_pat:
            return env_pat["token"]
        for p in self._pats:
            if p["id"] == pat_id:
                return p["token"]
        return None

    def add(self, label: str, token: str, enterprise_slugs: list[str] | None = None) -> dict:
        """Add a new PAT entry. Returns the new PAT dict (with token)."""
        # Check for duplicate tokens
        for p in self._pats:
            if p["token"] == token:
                raise ValueError(f"This token is already configured as '{p['label']}'")

        pat = {
            "id": f"pat_{uuid.uuid4().hex[:8]}",
            "label": label or "Untitled",
            "token": token,
            "user_login": "",
            "user_avatar": "",
            "orgs": [],
            "enterprise_slugs": enterprise_slugs or [],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_synced_at": "",
        }
        self._pats.append(pat)
        self._save()
        return pat

    def update(self, pat_id: str, **kwargs) -> dict | None:
        """Update a PAT's metadata (label, user_login, orgs, etc.)."""
        env_pat = self._get_env_pat()
        if env_pat:
            # Update in-memory metadata for the env PAT (never persisted)
            for key, value in kwargs.items():
                if key not in ("id", "token"):
                    self._env_pat_meta[key] = value
            return self._get_env_pat()
        for p in self._pats:
            if p["id"] == pat_id:
                for key, value in kwargs.items():
                    if key != "id" and key != "token":
                        p[key] = value
                self._save()
                return p
        return None

    def remove(self, pat_id: str) -> bool:
        """Remove a PAT by ID. Returns True if found and removed."""
        before = len(self._pats)
        self._pats = [p for p in self._pats if p["id"] != pat_id]
        if len(self._pats) < before:
            self._save()
            return True
        return False

    def find_by_id(self, pat_id: str) -> dict | None:
        """Find a PAT by ID. If GITHUB_PAT env is set, returns it for any ID."""
        env_pat = self._get_env_pat()
        if env_pat:
            return env_pat
        for p in self._pats:
            if p["id"] == pat_id:
                return p
        return None


# Global instance
pat_manager = PATManager()
