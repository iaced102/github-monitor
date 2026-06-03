"""
GitHub App authentication — generates short-lived installation tokens.

Flow:
1. Sign a JWT with the app's private key (exp: 10 min)
2. Exchange JWT for an installation access token (exp: 1 hour)
3. Cache token, refresh automatically when expired
"""

import asyncio
import base64
import os
import time
from datetime import datetime, timezone

import httpx
import jwt


class GitHubAppAuth:
    """Handles GitHub App JWT signing and installation token generation."""

    def __init__(self):
        self._token: str | None = None
        self._token_expires_at: float = 0
        self._lock = asyncio.Lock()

    @staticmethod
    def is_configured() -> bool:
        return bool(
            os.environ.get("GITHUB_APP_ID", "").strip()
            and os.environ.get("GITHUB_INSTALLATION_ID", "").strip()
            and _get_private_key()
        )

    def _create_jwt(self) -> str:
        app_id = os.environ["GITHUB_APP_ID"].strip()
        private_key = _get_private_key()
        now = int(time.time())
        payload = {
            "iat": now - 60,
            "exp": now + (10 * 60),
            "iss": app_id,
        }
        return jwt.encode(payload, private_key, algorithm="RS256")

    async def get_token(self) -> str:
        """Return a valid installation token, refreshing if expired."""
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token

        async with self._lock:
            # Double-check after acquiring lock
            if self._token and time.time() < self._token_expires_at - 60:
                return self._token

            installation_id = os.environ["GITHUB_INSTALLATION_ID"].strip()
            token_jwt = self._create_jwt()

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"https://api.github.com/app/installations/{installation_id}/access_tokens",
                    headers={
                        "Accept": "application/vnd.github+json",
                        "Authorization": f"Bearer {token_jwt}",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            self._token = data["token"]
            expires_at = data.get("expires_at", "")
            if expires_at:
                try:
                    exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    self._token_expires_at = exp_dt.timestamp()
                except (ValueError, TypeError):
                    self._token_expires_at = time.time() + 3500
            else:
                self._token_expires_at = time.time() + 3500
            print("[GitHubAppAuth] Installation token refreshed successfully")
            return self._token

    def invalidate(self):
        """Force token refresh on next call."""
        self._token = None
        self._token_expires_at = 0


def _get_private_key() -> str | None:
    """Read private key from file path or base64 env var."""
    key_path = os.environ.get("GITHUB_PRIVATE_KEY_PATH", "").strip()
    if key_path and os.path.isfile(key_path):
        with open(key_path) as f:
            return f.read()

    key_b64 = os.environ.get("GITHUB_PRIVATE_KEY_BASE64", "").strip()
    if key_b64:
        return base64.b64decode(key_b64).decode("utf-8")

    return None


github_app_auth = GitHubAppAuth()
