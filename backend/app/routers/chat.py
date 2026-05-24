"""
Chat router - SSE endpoint for AI-powered FinOps conversations.
"""

import json
import time

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..services.copilot_engine import copilot_engine
from ..services.session_manager import session_manager, SESSIONS_DIR
from ..services import database as db_module

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    group_id: int | None = None


def _build_scope_prefix(request: Request, group_id: int | None) -> str:
    """Build a scope context prefix for the AI message when a group filter is active."""
    user = getattr(request.state, "current_user", None)
    if not user:
        return ""

    db = db_module.db
    if db is None:
        return ""

    scope_members: list[str] | None = None
    group_name: str | None = None

    if user["role"] == "super_admin" and group_id:
        members = db.get_group_members(group_id)
        if members:
            scope_members = list(members)
            group_obj = db.get_group(group_id)
            group_name = group_obj.get("name") if group_obj else None
    elif user["role"] == "manager":
        gids = db.get_manager_group_ids(user["username"])
        if gids:
            scope_members = list(db.get_all_group_usernames(gids))
            groups = db.get_manager_groups(user["username"])
            group_name = ", ".join(g["name"] for g in groups) if groups else None

    if not scope_members:
        return ""

    members_str = ", ".join(scope_members[:20])
    if len(scope_members) > 20:
        members_str += f" ... (+{len(scope_members) - 20} more)"
    scope_label = f'group "{group_name}"' if group_name else "selected group"
    return (
        f"[SCOPE CONTEXT] The user is currently viewing data scoped to {scope_label} "
        f"({len(scope_members)} members: {members_str}). "
        f"When answering questions about users, seats, costs, or usage, "
        f"focus only on these members unless the user explicitly asks for all users.\n\n"
    )


@router.post("/chat")
async def chat(request: Request, req: ChatRequest):
    """Send a message to the AI FinOps engine and receive streaming response via SSE."""

    sid = req.session_id

    # Auto-create session if it doesn't exist
    if not session_manager.session_exists(sid):
        title = req.message[:50].strip()
        if len(req.message) > 50:
            title += "..."
        session_manager.create_session(session_id=sid, title=title)

    # Persist user message
    user_msg = {
        "id": str(int(time.time() * 1000)),
        "role": "user",
        "content": req.message,
        "timestamp": int(time.time() * 1000),
    }
    session_manager.append_message(sid, user_msg)

    # Build scoped message (prepend group context if a scope is active)
    scope_prefix = _build_scope_prefix(request, req.group_id)
    scoped_message = scope_prefix + req.message

    session_dir = str(SESSIONS_DIR / sid)

    async def event_generator():
        full_content = ""
        try:
            async for event in copilot_engine.chat(scoped_message, sid, working_directory=session_dir):
                # Track assistant text
                if event["type"] == "delta":
                    full_content += event.get("content", "")
                elif event["type"] == "message":
                    if event.get("content"):
                        full_content = event["content"]

                # Persist tool call data
                if event["type"] == "tool_start":
                    session_manager.append_tool_call(sid, {
                        "event": "tool_start",
                        "tool_name": event.get("content"),
                        "tool_call_id": event.get("tool_call_id"),
                        "arguments": event.get("detail"),
                        "timestamp": int(time.time() * 1000),
                    })
                elif event["type"] == "tool_complete":
                    session_manager.append_tool_call(sid, {
                        "event": "tool_complete",
                        "tool_name": event.get("content"),
                        "tool_call_id": event.get("tool_call_id"),
                        "result": event.get("detail"),
                        "timestamp": int(time.time() * 1000),
                    })

                yield {
                    "event": event["type"],
                    "data": json.dumps(event),
                }
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"type": "error", "content": str(e)}),
            }
        finally:
            # Persist assistant message
            if full_content:
                assistant_msg = {
                    "id": str(int(time.time() * 1000) + 1),
                    "role": "assistant",
                    "content": full_content,
                    "timestamp": int(time.time() * 1000),
                }
                session_manager.append_message(sid, assistant_msg)

    return EventSourceResponse(event_generator())


@router.post("/chat/simple")
async def chat_simple(request: ChatRequest):
    """Send a message and get a simple text response (non-streaming)."""
    sid = request.session_id

    # Auto-create session if it doesn't exist
    if not session_manager.session_exists(sid):
        title = request.message[:50].strip()
        if len(request.message) > 50:
            title += "..."
        session_manager.create_session(session_id=sid, title=title)

    # Persist user message
    user_msg = {
        "id": str(int(time.time() * 1000)),
        "role": "user",
        "content": request.message,
        "timestamp": int(time.time() * 1000),
    }
    session_manager.append_message(sid, user_msg)

    session_dir = str(SESSIONS_DIR / sid)
    response = await copilot_engine.chat_simple(request.message, sid, working_directory=session_dir)

    # Persist assistant message
    if response:
        assistant_msg = {
            "id": str(int(time.time() * 1000) + 1),
            "role": "assistant",
            "content": response,
            "timestamp": int(time.time() * 1000),
        }
        session_manager.append_message(sid, assistant_msg)

    return {"response": response, "session_id": sid}
