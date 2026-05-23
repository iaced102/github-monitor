"""
Groups router — manage user groups (collections of GitHub Copilot seat-holders).
Write operations require super_admin role.
"""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Request, UploadFile, File
from pydantic import BaseModel

from ..services import database as db_module

router = APIRouter(prefix="/groups", tags=["groups"])


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


# ---------------------------------------------------------------------------
# Group CRUD
# ---------------------------------------------------------------------------

class GroupCreate(BaseModel):
    name: str
    description: str = ""


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


@router.get("")
async def list_groups(request: Request):
    user = getattr(request.state, "current_user", None)
    if not user:
        return {"error": "Not authenticated"}
    db = _get_db()
    if user["role"] == "super_admin":
        groups = db.list_groups()
    else:
        groups = db.get_manager_groups(user["username"])
    return {"groups": groups}


@router.post("")
async def create_group(body: GroupCreate, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    if db.get_group_by_name(body.name.strip()):
        return {"error": f"Group '{body.name}' already exists"}
    gid = db.create_group(body.name.strip(), body.description.strip())
    return {"ok": True, "group": db.get_group(gid)}


@router.put("/{group_id}")
async def update_group(group_id: int, body: GroupUpdate, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    if not db.get_group(group_id):
        return {"error": "Group not found"}
    db.update_group(group_id, name=body.name, description=body.description)
    return {"ok": True, "group": db.get_group(group_id)}


@router.delete("/{group_id}")
async def delete_group(group_id: int, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    if not db.get_group(group_id):
        return {"error": "Group not found"}
    db.delete_group(group_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Group members
# ---------------------------------------------------------------------------

class MembersAdd(BaseModel):
    usernames: list[str]


@router.get("/{group_id}/members")
async def get_members(group_id: int, request: Request):
    user = getattr(request.state, "current_user", None)
    if not user:
        return {"error": "Not authenticated"}
    db = _get_db()
    if not db.get_group(group_id):
        return {"error": "Group not found"}
    # Managers can only query groups they are assigned to
    if user["role"] != "super_admin":
        manager_gids = db.get_manager_group_ids(user["username"])
        if group_id not in manager_gids:
            return {"error": "Access denied"}
    members = db.get_group_members(group_id)
    return {"group_id": group_id, "members": members}


@router.post("/{group_id}/members")
async def add_members(group_id: int, body: MembersAdd, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    if not db.get_group(group_id):
        return {"error": "Group not found"}
    usernames = [u.strip().lower() for u in body.usernames if u.strip()]
    db.add_group_members(group_id, usernames)
    return {"ok": True, "added": len(usernames)}


@router.delete("/{group_id}/members/{username}")
async def remove_member(group_id: int, username: str, request: Request):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}
    db = _get_db()
    db.remove_group_member(group_id, username)
    return {"ok": True}


# ---------------------------------------------------------------------------
# CSV import: username,group
# ---------------------------------------------------------------------------

@router.post("/import-csv")
async def import_csv(request: Request, file: UploadFile = File(...)):
    try:
        _require_super_admin(request)
    except PermissionError as e:
        return {"error": str(e)}

    db = _get_db()
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    # Normalise header names to lowercase stripped
    rows = []
    errors = []
    for i, row in enumerate(reader, start=2):
        normalised = {k.strip().lower(): v.strip() for k, v in row.items() if k}
        username = normalised.get("username") or normalised.get("login") or normalised.get("user")
        group_name = normalised.get("group") or normalised.get("group_name") or normalised.get("team")
        if not username or not group_name:
            errors.append(f"Row {i}: missing username or group column")
            continue
        rows.append((username.lower(), group_name.strip()))

    if not rows and errors:
        return {"error": "No valid rows found", "row_errors": errors}

    # Group rows by group name
    by_group: dict[str, list[str]] = {}
    for username, group_name in rows:
        by_group.setdefault(group_name, []).append(username)

    groups_created = 0
    members_added = 0
    for group_name, usernames in by_group.items():
        grp = db.get_group_by_name(group_name)
        if grp is None:
            gid = db.create_group(group_name)
            groups_created += 1
        else:
            gid = grp["id"]
        db.add_group_members(gid, usernames)
        members_added += len(usernames)

    return {
        "ok": True,
        "groups_created": groups_created,
        "members_added": members_added,
        "row_errors": errors,
        "preview": [
            {"group": g, "count": len(us)} for g, us in by_group.items()
        ],
    }
