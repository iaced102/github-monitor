"""
Managers router — manage manager accounts and their group assignments.
Also provides /users endpoints for full user management (super_admin only).
All endpoints require super_admin role.
"""

from __future__ import annotations

import hashlib
import os

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..services import database as db_module

router = APIRouter(prefix="/managers", tags=["managers"])
users_router = APIRouter(prefix="/users", tags=["users"])


def _require_super_admin(request: Request) -> dict:
    user = getattr(request.state, "current_user", None)
    if not user or user.get("role") != "super_admin":
        raise PermissionError("super_admin role required")
    return user


def _get_db():
    db = db_module.db
    if db is None:
        raise RuntimeError("Database not initialised")
    return db


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000).hex()


# ---------------------------------------------------------------------------
# Param models
# ---------------------------------------------------------------------------

class ManagerCreate(BaseModel):
    username: str
    password: str
    group_ids: list[int] = []


class ManagerGroupsUpdate(BaseModel):
    group_ids: list[int]


class ManagerPasswordUpdate(BaseModel):
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "manager"  # "super_admin" or "manager"
    group_ids: list[int] = []


class UserPasswordUpdate(BaseModel):
    password: str


class UserRoleUpdate(BaseModel):
    role: str


# ---------------------------------------------------------------------------
# /managers endpoints (backward compat)
# ---------------------------------------------------------------------------

@router.get("")
async def list_managers(request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    users = [u for u in db.list_app_users() if u["role"] == "manager"]
    # Attach group info to each manager
    result = []
    for u in users:
        groups = db.get_manager_groups(u["username"])
        result.append({**u, "groups": groups})
    return {"managers": result}


@router.post("")
async def create_manager(body: ManagerCreate, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}

    if not body.username.strip() or not body.password.strip():
        return {"error": "Username and password are required"}

    db = _get_db()
    if db.get_app_user(body.username.strip()):
        return {"error": f"User '{body.username}' already exists"}

    salt = os.urandom(32)
    password_hash = _hash_password(body.password, salt)
    db.create_app_user(body.username.strip(), password_hash, salt.hex(), role="manager")

    if body.group_ids:
        db.set_manager_groups(body.username.strip(), body.group_ids)

    groups = db.get_manager_groups(body.username.strip())
    return {
        "ok": True,
        "manager": {
            "username": body.username.strip(),
            "role": "manager",
            "groups": groups,
        },
    }


@router.delete("/{username}")
async def delete_manager(username: str, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    user = db.get_app_user(username)
    if not user:
        return {"error": "User not found"}
    if user["role"] == "super_admin":
        return {"error": "Cannot delete a super_admin account"}
    db.delete_app_user(username)
    return {"ok": True}


@router.put("/{username}/groups")
async def update_manager_groups(username: str, body: ManagerGroupsUpdate, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    if not db.get_app_user(username):
        return {"error": "User not found"}
    db.set_manager_groups(username, body.group_ids)
    groups = db.get_manager_groups(username)
    return {"ok": True, "groups": groups}


@router.put("/{username}/password")
async def update_manager_password(username: str, body: ManagerPasswordUpdate, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    if not body.password.strip():
        return {"error": "Password is required"}
    db = _get_db()
    if not db.get_app_user(username):
        return {"error": "User not found"}
    salt = os.urandom(32)
    password_hash = _hash_password(body.password, salt)
    db.update_app_user_password(username, password_hash, salt.hex())
    return {"ok": True}


# ---------------------------------------------------------------------------
# /users endpoints — full user management for super_admin
# ---------------------------------------------------------------------------

@users_router.get("")
async def list_users(request: Request):
    """List all app users (super_admin + manager)."""
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    all_users = db.list_app_users()
    result = []
    for u in all_users:
        groups = db.get_manager_groups(u["username"]) if u["role"] == "manager" else []
        result.append({**u, "groups": groups})
    return {"users": result}


@users_router.post("")
async def create_user(body: UserCreate, request: Request):
    """Create a new user with any role."""
    try:
        current = _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}

    username = body.username.strip()
    if not username or not body.password.strip():
        return {"error": "Username and password are required"}
    if body.role not in ("super_admin", "manager"):
        return {"error": "Role must be 'super_admin' or 'manager'"}

    db = _get_db()
    if db.get_app_user(username):
        return {"error": f"User '{username}' already exists"}

    salt = os.urandom(32)
    password_hash = _hash_password(body.password, salt)
    db.create_app_user(username, password_hash, salt.hex(), role=body.role)

    if body.role == "manager" and body.group_ids:
        db.set_manager_groups(username, body.group_ids)

    groups = db.get_manager_groups(username) if body.role == "manager" else []
    return {"ok": True, "user": {"username": username, "role": body.role, "groups": groups}}


@users_router.delete("/{username}")
async def delete_user(username: str, request: Request):
    """Delete a user. Cannot delete yourself or the last super_admin."""
    try:
        current = _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}

    if current.get("username") == username:
        return {"error": "Cannot delete your own account"}

    db = _get_db()
    user = db.get_app_user(username)
    if not user:
        return {"error": "User not found"}

    # Prevent deleting last super_admin
    if user["role"] == "super_admin":
        admins = [u for u in db.list_app_users() if u["role"] == "super_admin"]
        if len(admins) <= 1:
            return {"error": "Cannot delete the last super_admin account"}

    db.delete_app_user(username)
    return {"ok": True}


@users_router.put("/{username}/password")
async def update_user_password(username: str, body: UserPasswordUpdate, request: Request):
    """Reset any user's password."""
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    if not body.password.strip():
        return {"error": "Password is required"}
    db = _get_db()
    if not db.get_app_user(username):
        return {"error": "User not found"}
    salt = os.urandom(32)
    password_hash = _hash_password(body.password, salt)
    db.update_app_user_password(username, password_hash, salt.hex())
    return {"ok": True}


@users_router.put("/{username}/role")
async def update_user_role(username: str, body: UserRoleUpdate, request: Request):
    """Change a user's role."""
    try:
        current = _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    if body.role not in ("super_admin", "manager"):
        return {"error": "Role must be 'super_admin' or 'manager'"}
    if current.get("username") == username:
        return {"error": "Cannot change your own role"}
    db = _get_db()
    user = db.get_app_user(username)
    if not user:
        return {"error": "User not found"}
    db.update_app_user_role(username, body.role)
    return {"ok": True}


@users_router.put("/{username}/groups")
async def update_user_groups(username: str, body: ManagerGroupsUpdate, request: Request):
    """Update group assignments for a manager user."""
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    user = db.get_app_user(username)
    if not user:
        return {"error": "User not found"}
    db.set_manager_groups(username, body.group_ids)
    groups = db.get_manager_groups(username)
    return {"ok": True, "groups": groups}

