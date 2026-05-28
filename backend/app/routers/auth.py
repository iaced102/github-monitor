"""
Multi-user authentication for OctoFinance.
Supports two roles:
  - super_admin: full access, manages groups and managers
  - manager: read-only access scoped to their assigned user groups

Credentials are stored in the SQLite database (app_users table).
"""

from __future__ import annotations

import hashlib
import os
import secrets

from fastapi import APIRouter, Cookie, Request, Response
from pydantic import BaseModel

from ..services import database as db_module

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# In-memory session tokens → user info (cleared on server restart)
_active_sessions: dict[str, dict] = {}

# Usernames blocked from logging in (seed user when SEED_USER_ENABLED=false)
_blocked_users: set[str] = {}

# Paths that do NOT require authentication
AUTH_PUBLIC_PATHS = {"/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/me", "/api/health"}


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000).hex()


def _verify_password(password: str, stored_hash: str, salt_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    return _hash_password(password, salt) == stored_hash


def is_authenticated(session_token: str | None) -> bool:
    """Check if a session token is valid."""
    return session_token is not None and session_token in _active_sessions


def get_current_user(session_token: str | None) -> dict | None:
    """Return user info dict for a valid session token, or None."""
    if session_token is None:
        return None
    return _active_sessions.get(session_token)


def _setup_required() -> bool:
    """Return True if no users exist yet."""
    db = db_module.db
    if db is None:
        return True
    return not db.app_user_exists()


def seed_user_setup():
    """Auto-create or update the seed admin user from environment variables.

    Reads SEED_USER_ENABLED, SEED_USER_USERNAME, SEED_USER_PASSWORD.
    If enabled, upserts the user with super_admin role on every startup so
    that container deployments never need to go through the setup UI.
    If disabled, the user account is kept in the database but blocked from
    logging in (SEED_USER_USERNAME is added to _blocked_users).
    """
    enabled = os.environ.get("SEED_USER_ENABLED", "false").lower() == "true"
    username = os.environ.get("SEED_USER_USERNAME", "").strip()

    if not enabled:
        if username:
            _blocked_users.add(username)
            print(f"[Auth] Seed user '{username}' login blocked (SEED_USER_ENABLED=false)")
        return

    # Remove from blocked list in case it was previously disabled
    _blocked_users.discard(username)

    password = os.environ.get("SEED_USER_PASSWORD", "").strip()

    if not username or not password:
        print("[Auth] SEED_USER_ENABLED=true but USERNAME or PASSWORD is empty — skipping")
        return

    db = db_module.db
    if db is None:
        print("[Auth] Seed user setup skipped — database not ready")
        return

    salt = os.urandom(32)
    password_hash = _hash_password(password, salt)

    existing = db.get_app_user(username)
    if existing:
        db.update_app_user_password(username, password_hash, salt.hex())
        db.update_app_user_role(username, "super_admin")
        print(f"[Auth] Seed user '{username}' updated (super_admin)")
    else:
        db.create_app_user(username, password_hash, salt.hex(), role="super_admin")
        print(f"[Auth] Seed user '{username}' created (super_admin)")


# ---------------------------------------------------------------------------
# Param models
# ---------------------------------------------------------------------------

class SetupParams(BaseModel):
    username: str
    password: str


class LoginParams(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def auth_status(octofinance_session: str | None = Cookie(default=None)):
    """Check if auth is set up and if current request is authenticated."""
    return {
        "setup_required": _setup_required(),
        "authenticated": is_authenticated(octofinance_session),
    }


@router.post("/setup")
async def auth_setup(params: SetupParams, response: Response):
    """Create initial super_admin credentials. Only works if no users exist yet."""
    if not _setup_required():
        return {"error": "Credentials already configured. Use login instead."}

    if not params.username.strip() or not params.password.strip():
        return {"error": "Username and password are required."}

    db = db_module.db
    if db is None:
        return {"error": "Database not ready."}

    salt = os.urandom(32)
    password_hash = _hash_password(params.password, salt)
    db.create_app_user(params.username.strip(), password_hash, salt.hex(), role="super_admin")

    user_info = {"username": params.username.strip(), "role": "super_admin"}
    token = secrets.token_hex(32)
    _active_sessions[token] = user_info
    response.set_cookie(
        key="octofinance_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
    )
    return {"ok": True}


@router.post("/login")
async def auth_login(params: LoginParams, response: Response):
    """Verify credentials and create a session."""
    if _setup_required():
        return {"error": "No credentials configured. Please set up first."}

    db = db_module.db
    if db is None:
        return {"error": "Database not ready."}

    user = db.get_app_user(params.username.strip())
    if user is None:
        return {"error": "Invalid username or password."}

    if params.username.strip() in _blocked_users:
        return {"error": "Invalid username or password."}

    if not _verify_password(params.password, user["password_hash"], user["salt"]):
        return {"error": "Invalid username or password."}

    user_info = {"username": user["username"], "role": user["role"]}
    token = secrets.token_hex(32)
    _active_sessions[token] = user_info
    response.set_cookie(
        key="octofinance_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
    )
    return {"ok": True}


@router.post("/logout")
async def auth_logout(response: Response, octofinance_session: str | None = Cookie(default=None)):
    """Clear session."""
    if octofinance_session:
        _active_sessions.pop(octofinance_session, None)
    response.delete_cookie("octofinance_session")
    return {"ok": True}


@router.get("/me")
async def auth_me(request: Request):
    """Return current user info including role and assigned groups."""
    user = getattr(request.state, "current_user", None)
    if not user:
        return {"error": "Not authenticated"}

    db = db_module.db
    groups = []
    if db:
        if user["role"] == "super_admin":
            groups = db.list_groups()
        else:
            groups = db.get_manager_groups(user["username"])

    return {
        "username": user["username"],
        "role": user["role"],
        "groups": groups,
    }

