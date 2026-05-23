"""
Multi-user authentication for OctoFinance.
Supports two roles:
  - super_admin: full access, manages groups and managers
  - manager: read-only access scoped to their assigned user groups

Credentials are stored in the SQLite database (app_users table).
Existing single-user auth.json is migrated automatically on first startup.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from pathlib import Path

from fastapi import APIRouter, Cookie, Request, Response
from pydantic import BaseModel

from ..config import DATA_DIR
from ..services import database as db_module

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_AUTH_FILE = DATA_DIR / "auth.json"

# In-memory session tokens → user info (cleared on server restart)
_active_sessions: dict[str, dict] = {}

# Paths that do NOT require authentication
AUTH_PUBLIC_PATHS = {"/api/auth/status", "/api/auth/setup", "/api/auth/login"}


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000).hex()


def _verify_password(password: str, stored_hash: str, salt_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    return _hash_password(password, salt) == stored_hash


def _migrate_auth_json():
    """One-time migration: import auth.json admin into app_users table."""
    db = db_module.db
    if db is None or not _AUTH_FILE.exists():
        return
    if db.app_user_exists():
        return  # already migrated
    try:
        data = json.loads(_AUTH_FILE.read_text(encoding="utf-8"))
        username = data.get("username", "admin")
        password_hash = data.get("password_hash", "")
        salt = data.get("salt", "")
        db.create_app_user(username, password_hash, salt, role="super_admin")
        print(f"[Auth] Migrated admin '{username}' from auth.json to database")
    except Exception as e:
        print(f"[Auth] Migration warning: {e}")


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
        # DB not ready yet — fall back to file check
        return not _AUTH_FILE.exists()
    _migrate_auth_json()
    return not db.app_user_exists()


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

    salt = os.urandom(32)
    password_hash = _hash_password(params.password, salt)

    db = db_module.db
    if db:
        db.create_app_user(params.username.strip(), password_hash, salt.hex(), role="super_admin")
    else:
        # DB not ready — fall back to file (edge case during very early startup)
        import json as _json
        _AUTH_FILE.write_text(_json.dumps({
            "username": params.username.strip(),
            "password_hash": password_hash,
            "salt": salt.hex(),
        }, indent=2))

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

