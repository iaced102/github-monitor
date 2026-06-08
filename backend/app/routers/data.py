"""
Data query router - provides read access to collected data.
Supports enterprise grouping for org display.
"""

import csv
import io
import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone, date
from pathlib import Path

from fastapi import APIRouter, Query, Request, UploadFile, File
from fastapi.responses import StreamingResponse

from ..services.api_manager import api_manager
from ..services.data_collector import data_collector
from ..services.report_generator import generate_report_zip
from ..services.periodic_report_generator import generate_periodic_report_zip, generate_periodic_report
from ..services import database as db_module
from ..config import COPILOT_PRICING

router = APIRouter(tags=["data"])


def _is_active_in_billing_cycle(last_activity_at: str | None) -> bool:
    """Check if user was active in the current billing cycle (1st of month to today)."""
    if not last_activity_at:
        return False
    try:
        last_dt = datetime.fromisoformat(last_activity_at.replace("Z", "+00:00"))
        cycle_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return last_dt >= cycle_start
    except (ValueError, TypeError):
        return False


def _get_scope_usernames(request: Request, group_id: int | None = None) -> set[str] | None:
    """Return a set of GitHub usernames the current user may see, or None for unrestricted.

    - super_admin + no group_id param → None (no filter, see everything)
    - super_admin + group_id param    → filter to that group's members
    - manager                         → filter to union of all their assigned groups
    """
    user = getattr(request.state, "current_user", None)
    if not user:
        return None

    db = db_module.db
    if db is None:
        return None

    def _clean_username(u: str) -> str:
        """Normalise a stored GitHub username: strip @ prefix, trim whitespace and
        any trailing non-alphanumeric/underscore/hyphen characters (e.g. typos like
        'longa]' or 'user.'). Returns lower-case result."""
        import re
        u = u.strip().lstrip("@")
        u = re.sub(r"[^a-zA-Z0-9_\-]+$", "", u)  # strip trailing garbage chars
        return u.lower()

    if user["role"] == "super_admin":
        if group_id:
            members = db.get_group_members(group_id)
            cleaned = {_clean_username(u) for u in members if _clean_username(u)}
            return cleaned if cleaned else set()  # empty group → see nothing
        return None  # super_admin, no group filter

    # manager: always restricted to their assigned groups
    gids = db.get_manager_group_ids(user["username"])
    if not gids:
        return set()  # manager with no groups sees nothing
    usernames = db.get_all_group_usernames(gids)
    return {_clean_username(u) for u in usernames if _clean_username(u)}


@router.get("/data/orgs")
async def get_orgs():
    """Get all discovered organizations with their Copilot status, grouped by enterprise."""
    all_orgs = api_manager.get_all_orgs()
    orgs_list = []

    for org_info in all_orgs:
        org_name = org_info["login"]
        billing = data_collector.load_latest("billing", org_name)

        org_data = {
            "login": org_name,
            "avatar_url": org_info.get("avatar_url"),
            "description": org_info.get("description"),
            "has_copilot": billing is not None,
            "enterprise": org_info.get("enterprise", "Independent"),
            "pat_user": org_info.get("pat_user", ""),
        }

        if billing:
            org_data["plan_type"] = billing.get("_detected_plan_type", "unknown")
            org_data["price_per_seat"] = billing.get("_detected_price_per_seat", 0)
            seat_breakdown = billing.get("seat_breakdown", {})
            org_data["total_seats"] = seat_breakdown.get("total", 0)
            org_data["active_seats"] = seat_breakdown.get("active_this_cycle", 0)

        orgs_list.append(org_data)

    # Also include enterprise slugs that have synced data but no matching org
    existing_logins = {o["login"] for o in all_orgs}
    for ent in api_manager.get_all_enterprises():
        slug = ent.get("slug", "")
        if not slug or slug in existing_logins:
            continue
        billing = data_collector.load_latest("billing", slug)
        seats_data = data_collector.load_latest("seats", slug)
        total_seats = 0
        active_seats = 0
        if billing:
            sb = billing.get("seat_breakdown", {})
            total_seats = sb.get("total", 0)
            active_seats = sb.get("active_this_cycle", 0)
        elif seats_data:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            total_seats = seats_data.get("total_seats", 0)
            active_seats = 0
            for s in seats_data.get("seats", []):
                last = s.get("last_activity_at")
                if _is_active_in_billing_cycle(last):
                    active_seats += 1
        org_data = {
            "login": slug,
            "avatar_url": None,
            "description": ent.get("name", slug),
            "has_copilot": billing is not None or seats_data is not None,
            "enterprise": ent.get("name", slug),
            "pat_user": ent.get("pat_user", ""),
            "plan_type": billing.get("_detected_plan_type", "enterprise") if billing else "enterprise",
            "price_per_seat": billing.get("_detected_price_per_seat", 39.0) if billing else 39.0,
            "total_seats": total_seats,
            "active_seats": active_seats,
        }
        orgs_list.append(org_data)

    # Group by enterprise
    groups: dict[str, list] = defaultdict(list)
    for org in orgs_list:
        groups[org.get("enterprise", "Independent")].append(org)

    enterprises = [
        {"name": name, "orgs": orgs}
        for name, orgs in sorted(groups.items(), key=lambda x: (x[0] == "Independent", x[0]))
    ]

    return {"enterprises": enterprises, "orgs": orgs_list, "total": len(orgs_list)}


@router.get("/data/overview")
async def get_overview(request: Request, group_id: int = Query(default=0)):
    """Get a quick overview across all organizations, scoped to the current user's group if a manager."""
    scope_users = _get_scope_usernames(request, group_id or None)
    all_scope_names = _get_all_scope_names()
    total_seats = 0
    total_active = 0
    total_cost = 0.0
    total_waste = 0.0
    orgs_with_copilot = 0

    plan_seats: dict[str, int] = {}   # plan_type → seat count
    plan_active: dict[str, int] = {}  # plan_type → active count
    total_pending_cancellation = 0

    for org_name in all_scope_names:
        billing = data_collector.load_latest("billing", org_name)
        seats_data = data_collector.load_latest("seats", org_name)
        if not billing and not seats_data:
            continue

        orgs_with_copilot += 1

        # Derive active/inactive counts from the full seat list so the numbers
        # are consistent with the Lifecycle scan (last_activity_at rolling window).
        # seats_list includes pending-cancellation entries; counting directly from
        # it avoids the mismatch where total_seats < len(seats_list).
        if seats_data:
            seats_list = seats_data.get("seats", [])
            # Apply group scope filter for managers
            if scope_users is not None:
                seats_list = [
                    s for s in seats_list
                    if (s.get("assignee") or {}).get("login", "").lower() in scope_users
                ]

            # Deduplicate by login: group seat records per unique user
            # (some users have 2 records while upgrading Business → Enterprise)
            now = datetime.now(timezone.utc)
            by_login: dict = defaultdict(list)
            for s in seats_list:
                login = (s.get("assignee") or {}).get("login", "").lower()
                by_login[login].append(s)

            seats = 0  # unique user count
            active = 0
            inactive = 0
            org_plan_seats: dict[str, int] = {}    # plan → seat count for this org
            org_plan_inactive: dict[str, int] = {} # plan → inactive count for this org
            for login, user_seats in by_login.items():
                if not login:
                    continue
                seats += 1
                # Primary plan: prefer non-pending seat, prefer enterprise over business
                non_pending = [s for s in user_seats if not s.get("pending_cancellation_date")]
                primary = non_pending[0] if non_pending else user_seats[0]
                plan = (primary.get("plan_type") or "unknown").lower()

                # Active if ANY seat record has recent activity
                is_active = False
                for s in user_seats:
                    last = s.get("last_activity_at")
                    if last:
                        try:
                            if _is_active_in_billing_cycle(last):
                                is_active = True
                                break
                        except (ValueError, TypeError):
                            pass

                org_plan_seats[plan] = org_plan_seats.get(plan, 0) + 1
                plan_seats[plan] = plan_seats.get(plan, 0) + 1
                if is_active:
                    active += 1
                    plan_active[plan] = plan_active.get(plan, 0) + 1
                else:
                    inactive += 1
                    org_plan_inactive[plan] = org_plan_inactive.get(plan, 0) + 1

                # Count users who have at least one pending-cancellation seat
                if any(s.get("pending_cancellation_date") for s in user_seats):
                    total_pending_cancellation += 1

            # Calculate cost and waste per plan using correct per-plan pricing
            for plan, count in org_plan_seats.items():
                plan_price = COPILOT_PRICING.get(plan, COPILOT_PRICING["enterprise"])
                total_cost += count * plan_price
                total_waste += org_plan_inactive.get(plan, 0) * plan_price
        elif billing:
            sb = billing.get("seat_breakdown", {})
            seats = sb.get("total", 0)
            active = sb.get("active_this_cycle", 0)
            inactive = seats - active
            price = float(billing.get("_detected_price_per_seat", COPILOT_PRICING["enterprise"]) or COPILOT_PRICING["enterprise"])
            total_cost += seats * price
            total_waste += inactive * price
        else:
            seats = active = inactive = 0

        total_seats += seats
        total_active += active

    plan_breakdown = [
        {
            "plan": plan,
            "seats": plan_seats[plan],
            "active": plan_active.get(plan, 0),
            "inactive": plan_seats[plan] - plan_active.get(plan, 0),
            "price_per_seat": COPILOT_PRICING.get(plan, COPILOT_PRICING["enterprise"]),
            "monthly_cost": plan_seats[plan] * COPILOT_PRICING.get(plan, COPILOT_PRICING["enterprise"]),
        }
        for plan in sorted(plan_seats)
    ]

    today = date.today()
    billing_cycle_start = today.replace(day=1).isoformat()

    return {
        "total_organizations": len(all_scope_names),
        "orgs_with_copilot": orgs_with_copilot,
        "total_seats": total_seats,
        "total_active_seats": total_active,
        "total_inactive_seats": total_seats - total_active,
        "utilization_pct": round(total_active / total_seats * 100, 1) if total_seats > 0 else 0,
        "monthly_cost": total_cost,
        "monthly_waste": total_waste,
        "annual_waste": total_waste * 12,
        "plan_breakdown": plan_breakdown,
        "pending_cancellation": total_pending_cancellation,
        "active_window": "billing_cycle",
        "billing_cycle_start": billing_cycle_start,
        "billing_cycle_end": today.isoformat(),
    }


def _get_all_scope_names() -> list[str]:
    """Return all org logins + enterprise slugs that may have synced data."""
    names = [o["login"] for o in api_manager.get_all_orgs()]
    for ent in api_manager.get_all_enterprises():
        slug = ent.get("slug", "")
        if slug and slug not in names:
            names.append(slug)
    return names


@router.get("/data/seats/{org}")
async def get_seats(org: str):
    """Get seat data for a specific organization."""
    data = data_collector.load_latest("seats", org)
    if not data:
        return {"error": f"No seat data for {org}"}
    return data


@router.get("/data/billing/{org}")
async def get_billing(org: str):
    """Get billing data for a specific organization."""
    data = data_collector.load_latest("billing", org)
    if not data:
        return {"error": f"No billing data for {org}"}
    return data


@router.get("/data/dashboard")
async def get_dashboard(
    request: Request,
    orgs: str = Query(default=""),
    group_id: int = Query(default=0),
    month: str = Query(default="", description="Billing cycle month, e.g. '2026-05'. Empty = current month."),
    start_date: str = Query(default="", description="Start date override, e.g. '2026-06-01'. Overrides month."),
    end_date: str = Query(default="", description="End date override, e.g. '2026-06-08'. Overrides month."),
):
    """Aggregated dashboard data for visualization.

    Query param ``orgs`` is a comma-separated list of org logins to include.
    Empty means all orgs with Copilot billing data.
    ``group_id`` (super_admin only) optionally restricts the user-level views
    to members of a specific group.
    """
    scope_users = _get_scope_usernames(request, group_id or None)

    # Parse date range: start_date/end_date override month, which overrides default (current billing cycle)
    import calendar
    if start_date.strip() and end_date.strip():
        cycle_start_day = date.fromisoformat(start_date.strip())
        cycle_end_day = date.fromisoformat(end_date.strip())
    elif month.strip():
        try:
            parts = month.strip().split("-")
            m_year, m_month = int(parts[0]), int(parts[1])
            cycle_start_day = date(m_year, m_month, 1)
            last_day = calendar.monthrange(m_year, m_month)[1]
            cycle_end_day = date(m_year, m_month, last_day)
        except (ValueError, IndexError):
            cycle_start_day = date.today().replace(day=1)
            cycle_end_day = date.today()
    else:
        cycle_start_day = date.today().replace(day=1)
        cycle_end_day = date.today()
    # Validate: clamp end to today, swap if inverted
    today = date.today()
    if cycle_end_day > today:
        cycle_end_day = today
    if cycle_start_day > cycle_end_day:
        cycle_start_day, cycle_end_day = cycle_end_day, cycle_start_day
    cycle_start_str = cycle_start_day.isoformat()
    cycle_end_str = cycle_end_day.isoformat()

    all_org_names = _get_all_scope_names()
    selected = [o.strip() for o in orgs.split(",") if o.strip()] if orgs.strip() else all_org_names

    # --- KPI from billing (with fallback to seats data when billing unavailable) ---
    total_seats = 0
    active_seats = 0
    monthly_cost = 0.0
    monthly_waste = 0.0
    available_orgs: list[str] = []

    from datetime import datetime, timezone
    _now = datetime.now(timezone.utc)
    has_billing_error = False

    # Determine active users from usage data in the selected date range
    active_logins_in_range: set[str] = set()
    for org_name in ([o.strip() for o in orgs.split(",") if o.strip()] if orgs.strip() else _get_all_scope_names()):
        uu = data_collector.load_daily_usage_users(org_name, start_day=cycle_start_str, end_day=cycle_end_str)
        if not uu:
            continue
        for rec in uu.get("records", []):
            login = rec.get("user_login", "")
            if login and (rec.get("user_initiated_interaction_count", 0) > 0 or rec.get("code_generation_activity_count", 0) > 0):
                active_logins_in_range.add(login.lower())

    for org_name in selected:
        billing = data_collector.load_latest("billing", org_name)
        seats_data = data_collector.load_latest("seats", org_name)
        if not billing and not seats_data:
            continue
        available_orgs.append(org_name)

        seats_list = (seats_data or {}).get("seats", [])

        if scope_users is not None:
            # Group scope: filter to group members, deduplicate by login, use per-plan pricing
            has_billing_error = True
            # Deduplicate: group all seat records per login, then count unique users
            by_login_g: dict = defaultdict(list)
            for seat in seats_list:
                login = (seat.get("assignee") or {}).get("login", "").lower()
                if login and login in scope_users:
                    by_login_g[login].append(seat)
            s = 0
            a = 0
            grp_plan_seats: dict[str, int] = {}
            grp_plan_inactive: dict[str, int] = {}
            for login, user_seats in by_login_g.items():
                s += 1
                # Primary plan: prefer non-pending seat
                non_pending = [seat for seat in user_seats if not seat.get("pending_cancellation_date")]
                primary = non_pending[0] if non_pending else user_seats[0]
                plan = (primary.get("plan_type") or "unknown").lower()
                is_active = login in active_logins_in_range
                grp_plan_seats[plan] = grp_plan_seats.get(plan, 0) + 1
                if is_active:
                    a += 1
                else:
                    grp_plan_inactive[plan] = grp_plan_inactive.get(plan, 0) + 1
            total_seats += s
            active_seats += a
            for plan, count in grp_plan_seats.items():
                plan_price = COPILOT_PRICING.get(plan, COPILOT_PRICING["enterprise"])
                monthly_cost += count * plan_price
                monthly_waste += grp_plan_inactive.get(plan, 0) * plan_price
        elif seats_list:
            # Main path: deduplicate by login, calculate cost/waste per-plan
            if not (billing and not billing.get("_billing_scope_error")):
                has_billing_error = True
            by_login_d: dict = defaultdict(list)
            for seat in seats_list:
                login = (seat.get("assignee") or {}).get("login", "").lower()
                by_login_d[login].append(seat)
            s = 0
            a = 0
            org_plan_seats: dict[str, int] = {}
            org_plan_inactive: dict[str, int] = {}
            for login, user_seats in by_login_d.items():
                if not login:
                    continue
                s += 1
                # Primary plan: prefer non-pending seat
                non_pending = [seat for seat in user_seats if not seat.get("pending_cancellation_date")]
                primary = non_pending[0] if non_pending else user_seats[0]
                plan = (primary.get("plan_type") or "unknown").lower()
                is_active = login in active_logins_in_range
                org_plan_seats[plan] = org_plan_seats.get(plan, 0) + 1
                if is_active:
                    a += 1
                else:
                    org_plan_inactive[plan] = org_plan_inactive.get(plan, 0) + 1
            total_seats += s
            active_seats += a
            for plan, count in org_plan_seats.items():
                plan_price = COPILOT_PRICING.get(plan, COPILOT_PRICING["enterprise"])
                monthly_cost += count * plan_price
                monthly_waste += org_plan_inactive.get(plan, 0) * plan_price
        elif billing:
            # Fallback: billing data only, no seats list
            price = float(billing.get("_detected_price_per_seat", COPILOT_PRICING["enterprise"]) or COPILOT_PRICING["enterprise"])
            sb = billing.get("seat_breakdown", {})
            s = sb.get("total", 0)
            a = sb.get("active_this_cycle", 0)
            total_seats += s
            active_seats += a
            monthly_cost += s * price
            monthly_waste += (s - a) * price

    inactive_seats = total_seats - active_seats
    utilization_pct = round(active_seats / total_seats * 100, 1) if total_seats > 0 else 0
    billing_scope_error = has_billing_error

    kpi = {
        "total_seats": total_seats,
        "active_seats": active_seats,
        "inactive_seats": inactive_seats,
        "utilization_pct": utilization_pct,
        "monthly_cost": monthly_cost,
        "monthly_waste": monthly_waste,
        "billing_scope_error": billing_scope_error,
    }

    # --- Seat info from billing + seats ---
    seat_info = {
        "breakdown": {"pending_invitation": 0, "pending_cancellation": 0, "added_this_cycle": 0},
        "plans": {},   # plan_type -> count
        "features": {},  # feature -> enabled/disabled
        "seats": [],  # individual seat records
    }
    seat_seen_logins: set[str] = set()
    for org_name in selected:
        billing = data_collector.load_latest("billing", org_name)
        if billing:
            sb = billing.get("seat_breakdown", {})
            seat_info["breakdown"]["pending_invitation"] += sb.get("pending_invitation", 0)
            seat_info["breakdown"]["pending_cancellation"] += sb.get("pending_cancellation", 0)
            seat_info["breakdown"]["added_this_cycle"] += sb.get("added_this_cycle", 0)
            # Plan counts from _plan_counts if available (real billing data)
            plan_counts = billing.get("_plan_counts")
            if plan_counts:
                for plan, count in plan_counts.items():
                    seat_info["plans"][plan] = seat_info["plans"].get(plan, 0) + count
            for feat in ("ide_chat", "cli", "platform_chat", "public_code_suggestions"):
                val = billing.get(feat, "")
                if val:
                    seat_info["features"][feat] = val

        seats_data = data_collector.load_latest("seats", org_name)
        if seats_data:
            # When billing data is unavailable, derive breakdown counts from seat records
            if not billing:
                for s in seats_data.get("seats", []):
                    if scope_users is not None:
                        login = (s.get("assignee") or {}).get("login", "")
                        if login.lower() not in scope_users:
                            continue
                    if s.get("pending_cancellation_date"):
                        seat_info["breakdown"]["pending_cancellation"] += 1
            for s in seats_data.get("seats", []):
                assignee = s.get("assignee", {})
                login = assignee.get("login", "")
                # Dedup by login (user may appear with both enterprise + business seats)
                if not login or login.lower() in seat_seen_logins:
                    continue
                seat_seen_logins.add(login.lower())
                # Apply group scope filter
                if scope_users is not None and login.lower() not in scope_users:
                    continue
                team = s.get("assigning_team")
                seat_info["seats"].append({
                    "user": login,
                    "avatar": assignee.get("avatar_url", ""),
                    "org": org_name,
                    "plan_type": s.get("plan_type", ""),
                    "created_at": s.get("created_at", ""),
                    "last_activity_at": s.get("last_activity_at"),
                    "last_activity_editor": s.get("last_activity_editor"),
                    "pending_cancellation_date": s.get("pending_cancellation_date"),
                    "team": team.get("name", "") if team else "",
                })

    # --- Aggregate usage data ---
    daily_map: dict[str, dict] = {}
    feature_map: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_accepted": 0,
    })
    model_map: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_accepted": 0,
    })
    ide_map: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_accepted": 0,
    })
    lang_map: dict[str, dict] = defaultdict(lambda: {
        "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_accepted": 0,
    })
    date_start = ""
    date_end = ""

    for org_name in selected:
        usage = data_collector.load_daily_usage(org_name, start_day=cycle_start_str, end_day=cycle_end_str)
        if not usage:
            continue

        for rec in usage.get("records", []):
            rs = rec.get("report_start_day", "")
            re_ = rec.get("report_end_day", "")
            if rs and (not date_start or rs < date_start):
                date_start = rs
            if re_ and (not date_end or re_ > date_end):
                date_end = re_

            for dt in rec.get("day_totals", []):
                day = dt.get("day", "")
                if not day:
                    continue
                if day not in daily_map:
                    daily_map[day] = {
                        "day": day, "dau": 0, "wau": 0, "mau": 0,
                        "chat_users": 0, "agent_users": 0,
                        "interactions": 0, "code_gen": 0, "code_accept": 0,
                        "loc_suggested": 0, "loc_accepted": 0,
                    }
                dm = daily_map[day]
                dm["dau"] += dt.get("daily_active_users", 0)
                dm["wau"] += dt.get("weekly_active_users", 0)
                dm["mau"] += dt.get("monthly_active_users", 0)
                dm["chat_users"] += dt.get("monthly_active_chat_users", 0)
                dm["agent_users"] += dt.get("monthly_active_agent_users", 0)
                dm["interactions"] += dt.get("user_initiated_interaction_count", 0)
                dm["code_gen"] += dt.get("code_generation_activity_count", 0)
                dm["code_accept"] += dt.get("code_acceptance_activity_count", 0)
                dm["loc_suggested"] += dt.get("loc_suggested_to_add_sum", 0) + dt.get("loc_suggested_to_delete_sum", 0)
                dm["loc_accepted"] += dt.get("loc_added_sum", 0) + dt.get("loc_deleted_sum", 0)

                for fb in dt.get("totals_by_feature", []):
                    f = fb.get("feature", "unknown")
                    feature_map[f]["interactions"] += fb.get("user_initiated_interaction_count", 0)
                    feature_map[f]["code_gen"] += fb.get("code_generation_activity_count", 0)
                    feature_map[f]["code_accept"] += fb.get("code_acceptance_activity_count", 0)
                    feature_map[f]["loc_suggested"] += fb.get("loc_suggested_to_add_sum", 0) + fb.get("loc_suggested_to_delete_sum", 0)
                    feature_map[f]["loc_accepted"] += fb.get("loc_added_sum", 0) + fb.get("loc_deleted_sum", 0)

                for mb in dt.get("totals_by_model_feature", []):
                    m = mb.get("model", "unknown")
                    model_map[m]["interactions"] += mb.get("user_initiated_interaction_count", 0)
                    model_map[m]["code_gen"] += mb.get("code_generation_activity_count", 0)
                    model_map[m]["code_accept"] += mb.get("code_acceptance_activity_count", 0)
                    model_map[m]["loc_suggested"] += mb.get("loc_suggested_to_add_sum", 0) + mb.get("loc_suggested_to_delete_sum", 0)
                    model_map[m]["loc_accepted"] += mb.get("loc_added_sum", 0) + mb.get("loc_deleted_sum", 0)

                for ib in dt.get("totals_by_ide", []):
                    ide = ib.get("ide", "unknown")
                    ide_map[ide]["interactions"] += ib.get("user_initiated_interaction_count", 0)
                    ide_map[ide]["code_gen"] += ib.get("code_generation_activity_count", 0)
                    ide_map[ide]["code_accept"] += ib.get("code_acceptance_activity_count", 0)
                    ide_map[ide]["loc_suggested"] += ib.get("loc_suggested_to_add_sum", 0) + ib.get("loc_suggested_to_delete_sum", 0)
                    ide_map[ide]["loc_accepted"] += ib.get("loc_added_sum", 0) + ib.get("loc_deleted_sum", 0)

                for lb in dt.get("totals_by_language_feature", []):
                    lang = lb.get("language", "unknown")
                    lang_map[lang]["code_gen"] += lb.get("code_generation_activity_count", 0)
                    lang_map[lang]["code_accept"] += lb.get("code_acceptance_activity_count", 0)
                    lang_map[lang]["loc_suggested"] += lb.get("loc_suggested_to_add_sum", 0) + lb.get("loc_suggested_to_delete_sum", 0)
                    lang_map[lang]["loc_accepted"] += lb.get("loc_added_sum", 0) + lb.get("loc_deleted_sum", 0)

    # When group scope is active, rebuild usage aggregates from per-user (usage_users) data
    # so all charts reflect only the filtered users' activity.
    if scope_users is not None:
        daily_map = {}
        feature_map = defaultdict(lambda: {"interactions": 0, "code_gen": 0, "code_accept": 0, "loc_suggested": 0, "loc_accepted": 0})
        model_map = defaultdict(lambda: {"interactions": 0, "code_gen": 0, "code_accept": 0, "loc_suggested": 0, "loc_accepted": 0})
        ide_map = defaultdict(lambda: {"interactions": 0, "code_gen": 0, "code_accept": 0, "loc_suggested": 0, "loc_accepted": 0})
        lang_map = defaultdict(lambda: {"code_gen": 0, "code_accept": 0, "loc_suggested": 0, "loc_accepted": 0})
        # Preserve org-level date range as fallback in case no per-user records match
        org_date_start = date_start
        org_date_end = date_end
        date_start = ""
        date_end = ""
        for org_name in selected:
            uu = data_collector.load_daily_usage_users(org_name, start_day=cycle_start_str, end_day=cycle_end_str)
            if not uu:
                continue
            for rec in (uu if isinstance(uu, list) else uu.get("records", [uu])):
                login = rec.get("user_login", "")
                if not login or login.lower() not in scope_users:
                    continue
                rs = rec.get("report_start_day", "")
                re_ = rec.get("report_end_day", "")
                if rs and (not date_start or rs < date_start):
                    date_start = rs
                if re_ and (not date_end or re_ > date_end):
                    date_end = re_
                day = rec.get("day", "")
                if day:
                    if day not in daily_map:
                        daily_map[day] = {
                            "day": day, "dau": 0, "wau": 0, "mau": 0,
                            "chat_users": 0, "agent_users": 0,
                            "interactions": 0, "code_gen": 0, "code_accept": 0,
                            "loc_suggested": 0, "loc_accepted": 0,
                        }
                    dm = daily_map[day]
                    dm["dau"] += 1
                    dm["interactions"] += rec.get("user_initiated_interaction_count", 0)
                    dm["code_gen"] += rec.get("code_generation_activity_count", 0)
                    dm["code_accept"] += rec.get("code_acceptance_activity_count", 0)
                    dm["loc_suggested"] += rec.get("loc_suggested_to_add_sum", 0) + rec.get("loc_suggested_to_delete_sum", 0)
                    dm["loc_accepted"] += rec.get("loc_added_sum", 0) + rec.get("loc_deleted_sum", 0)
                    if rec.get("used_chat"):
                        dm["chat_users"] += 1
                    if rec.get("used_agent") or rec.get("used_copilot_coding_agent"):
                        dm["agent_users"] += 1
                for fb in rec.get("totals_by_feature", []):
                    f = fb.get("feature", "unknown")
                    feature_map[f]["interactions"] += fb.get("user_initiated_interaction_count", 0)
                    feature_map[f]["code_gen"] += fb.get("code_generation_activity_count", 0)
                    feature_map[f]["code_accept"] += fb.get("code_acceptance_activity_count", 0)
                    feature_map[f]["loc_suggested"] += fb.get("loc_suggested_to_add_sum", 0) + fb.get("loc_suggested_to_delete_sum", 0)
                    feature_map[f]["loc_accepted"] += fb.get("loc_added_sum", 0) + fb.get("loc_deleted_sum", 0)
                for mb in rec.get("totals_by_model_feature", []):
                    m = mb.get("model", "unknown")
                    model_map[m]["interactions"] += mb.get("user_initiated_interaction_count", 0)
                    model_map[m]["code_gen"] += mb.get("code_generation_activity_count", 0)
                    model_map[m]["code_accept"] += mb.get("code_acceptance_activity_count", 0)
                    model_map[m]["loc_suggested"] += mb.get("loc_suggested_to_add_sum", 0) + mb.get("loc_suggested_to_delete_sum", 0)
                    model_map[m]["loc_accepted"] += mb.get("loc_added_sum", 0) + mb.get("loc_deleted_sum", 0)
                for ib in rec.get("totals_by_ide", []):
                    ide = ib.get("ide", "unknown")
                    ide_map[ide]["interactions"] += ib.get("user_initiated_interaction_count", 0)
                    ide_map[ide]["code_gen"] += ib.get("code_generation_activity_count", 0)
                    ide_map[ide]["code_accept"] += ib.get("code_acceptance_activity_count", 0)
                    ide_map[ide]["loc_suggested"] += ib.get("loc_suggested_to_add_sum", 0) + ib.get("loc_suggested_to_delete_sum", 0)
                    ide_map[ide]["loc_accepted"] += ib.get("loc_added_sum", 0) + ib.get("loc_deleted_sum", 0)
                for lb in rec.get("totals_by_language_feature", []):
                    lang = lb.get("language", "unknown")
                    lang_map[lang]["code_gen"] += lb.get("code_generation_activity_count", 0)
                    lang_map[lang]["code_accept"] += lb.get("code_acceptance_activity_count", 0)
                    lang_map[lang]["loc_suggested"] += lb.get("loc_suggested_to_add_sum", 0) + lb.get("loc_suggested_to_delete_sum", 0)
                    lang_map[lang]["loc_accepted"] += lb.get("loc_added_sum", 0) + lb.get("loc_deleted_sum", 0)

        # Fall back to org-level date range when no per-user data matched
        if not date_start:
            date_start = org_date_start
        if not date_end:
            date_end = org_date_end

    daily_trend = sorted(daily_map.values(), key=lambda x: x["day"])

    feature_usage = [{"feature": k, **v} for k, v in sorted(feature_map.items(), key=lambda x: -x[1]["interactions"])]
    model_usage = [{"model": k, **v} for k, v in sorted(model_map.items(), key=lambda x: -x[1]["interactions"]) if v["interactions"] + v["code_gen"] > 0]
    ide_usage = [{"ide": k, **v} for k, v in sorted(ide_map.items(), key=lambda x: -x[1]["interactions"])]
    language_usage = [{"language": k, **v} for k, v in sorted(lang_map.items(), key=lambda x: -x[1]["code_gen"])]

    # --- Premium request detail ---
    pr_detail_map: dict[str, dict] = defaultdict(lambda: {
        "gross_qty": 0, "discount_qty": 0, "net_qty": 0,
        "gross_amount": 0.0, "net_amount": 0.0,
    })
    for org_name in selected:
        pr = data_collector.load_latest("premium_requests", org_name)
        if not pr:
            continue
        for item in pr.get("usageItems", []):
            m = item.get("model", "unknown")
            pr_detail_map[m]["gross_qty"] += item.get("grossQuantity", 0)
            pr_detail_map[m]["discount_qty"] += item.get("discountQuantity", 0)
            pr_detail_map[m]["net_qty"] += item.get("netQuantity", 0)
            pr_detail_map[m]["gross_amount"] += item.get("grossAmount", 0.0)
            pr_detail_map[m]["net_amount"] += item.get("netAmount", 0.0)

    premium_detail = [{"model": k, **v} for k, v in sorted(pr_detail_map.items(), key=lambda x: -x[1]["gross_qty"])]

    # Merge premium totals into model_usage
    for entry in model_usage:
        pd = pr_detail_map.pop(entry["model"], None)
        entry["premium_requests"] = pd["gross_qty"] if pd else 0
    for m, pd in pr_detail_map.items():
        if pd["gross_qty"] > 0:
            model_usage.append({"model": m, "interactions": 0, "code_gen": 0, "code_accept": 0,
                                "loc_suggested": 0, "loc_accepted": 0, "premium_requests": pd["gross_qty"]})

    # --- Top users from usage_users (enhanced) ---
    user_agg: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_accepted": 0,
        "days_active": 0, "used_agent": False, "used_chat": False,
    })
    for org_name in selected:
        uu = data_collector.load_daily_usage_users(org_name, start_day=cycle_start_str, end_day=cycle_end_str)
        if not uu:
            continue
        for rec in uu.get("records", []):
            login = rec.get("user_login", "")
            if not login:
                continue
            # Apply group scope filter
            if scope_users is not None and login.lower() not in scope_users:
                continue
            u = user_agg[login]
            u["interactions"] += rec.get("user_initiated_interaction_count", 0)
            u["code_gen"] += rec.get("code_generation_activity_count", 0)
            u["code_accept"] += rec.get("code_acceptance_activity_count", 0)
            u["loc_suggested"] += rec.get("loc_suggested_to_add_sum", 0) + rec.get("loc_suggested_to_delete_sum", 0)
            u["loc_accepted"] += rec.get("loc_added_sum", 0) + rec.get("loc_deleted_sum", 0)
            u["days_active"] += 1
            if rec.get("used_agent"):
                u["used_agent"] = True
            if rec.get("used_chat"):
                u["used_chat"] = True

    # Merge with seats to include all licensed users (not just active)
    for org_name in selected:
        seats_data = data_collector.load_latest("seats", org_name)
        if not seats_data:
            continue
        seen_logins: set[str] = set()
        for s in seats_data.get("seats", []):
            login = (s.get("assignee") or {}).get("login", "")
            if not login or login.lower() in seen_logins:
                continue
            seen_logins.add(login.lower())
            if scope_users is not None and login.lower() not in scope_users:
                continue
            if login not in user_agg:
                user_agg[login] = {
                    "interactions": 0, "code_gen": 0, "code_accept": 0,
                    "loc_suggested": 0, "loc_accepted": 0,
                    "days_active": 0, "used_agent": False, "used_chat": False,
                }

    top_users = sorted(
        [{"user": k, **v} for k, v in user_agg.items()],
        key=lambda x: -x["interactions"],
    )[:30]

    # --- Metrics data (code completions by language, chat stats) ---
    metrics_lang_map: dict[str, dict] = defaultdict(lambda: {
        "suggestions": 0, "acceptances": 0,
        "lines_suggested": 0, "lines_accepted": 0, "engaged_users": 0,
    })
    chat_stats = {"ide_chats": 0, "ide_copy_events": 0, "ide_insertion_events": 0,
                  "dotcom_chats": 0, "pr_summaries": 0}

    for org_name in selected:
        metrics = data_collector.load_latest("metrics", org_name)
        if not metrics:
            continue
        entries = metrics if isinstance(metrics, list) else [metrics]
        for entry in entries:
            # Code completions
            cc = entry.get("copilot_ide_code_completions", {})
            for editor in cc.get("editors", []):
                for model in editor.get("models", []):
                    for lang in model.get("languages", []):
                        ln = lang.get("name", "unknown")
                        metrics_lang_map[ln]["suggestions"] += lang.get("total_code_suggestions", 0)
                        metrics_lang_map[ln]["acceptances"] += lang.get("total_code_acceptances", 0)
                        metrics_lang_map[ln]["lines_suggested"] += lang.get("total_code_lines_suggested", 0)
                        metrics_lang_map[ln]["lines_accepted"] += lang.get("total_code_lines_accepted", 0)
                        metrics_lang_map[ln]["engaged_users"] += lang.get("total_engaged_users", 0)
            # IDE chat
            ic = entry.get("copilot_ide_chat", {})
            for editor in ic.get("editors", []):
                for model in editor.get("models", []):
                    chat_stats["ide_chats"] += model.get("total_chats", 0)
                    chat_stats["ide_copy_events"] += model.get("total_chat_copy_events", 0)
                    chat_stats["ide_insertion_events"] += model.get("total_chat_insertion_events", 0)
            # Dotcom chat
            dc = entry.get("copilot_dotcom_chat", {})
            for model in dc.get("models", []):
                chat_stats["dotcom_chats"] += model.get("total_chats", 0)
            # PR summaries
            dpr = entry.get("copilot_dotcom_pull_requests", {})
            for repo in dpr.get("repositories", []):
                for model in repo.get("models", []):
                    chat_stats["pr_summaries"] += model.get("total_pr_summaries_created", 0)

    code_completions = [{"language": k, **v} for k, v in sorted(
        metrics_lang_map.items(), key=lambda x: -x[1]["suggestions"]
    )]

    # --- Per-user feature usage (for drilldown in feature table) ---
    user_feature_map: dict[str, dict[str, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"interactions": 0, "code_gen": 0, "code_accept": 0, "loc_suggested": 0, "loc_accepted": 0})
    )
    for org_name in selected:
        uu = data_collector.load_daily_usage_users(org_name, start_day=cycle_start_str, end_day=cycle_end_str)
        if not uu:
            continue
        for rec in (uu if isinstance(uu, list) else uu.get("records", [uu])):
            login = rec.get("user_login", "")
            if not login:
                continue
            if scope_users is not None and login.lower() not in scope_users:
                continue
            for fb in rec.get("totals_by_feature", []):
                f = fb.get("feature", "unknown")
                user_feature_map[login][f]["interactions"] += fb.get("user_initiated_interaction_count", 0)
                user_feature_map[login][f]["code_gen"] += fb.get("code_generation_activity_count", 0)
                user_feature_map[login][f]["code_accept"] += fb.get("code_acceptance_activity_count", 0)
                user_feature_map[login][f]["loc_suggested"] += fb.get("loc_suggested_to_add_sum", 0) + fb.get("loc_suggested_to_delete_sum", 0)
                user_feature_map[login][f]["loc_accepted"] += fb.get("loc_added_sum", 0) + fb.get("loc_deleted_sum", 0)

    user_feature_usage: list[dict] = []
    for login, feats in user_feature_map.items():
        for feat, vals in feats.items():
            user_feature_usage.append({
                "user": login, "feature": feat,
                "interactions": vals["interactions"],
                "code_gen": vals["code_gen"],
                "code_accept": vals["code_accept"],
                "loc_suggested": vals["loc_suggested"],
                "loc_accepted": vals["loc_accepted"],
                "total": vals["interactions"] + vals["code_gen"],
            })
    user_feature_usage.sort(key=lambda x: (-x["total"], x["user"]))

    return {
        "kpi": kpi,
        "seat_info": seat_info,
        "daily_trend": daily_trend,
        "feature_usage": feature_usage,
        "model_usage": model_usage,
        "ide_usage": ide_usage,
        "language_usage": language_usage,
        "code_completions": code_completions,
        "premium_detail": premium_detail,
        "chat_stats": chat_stats,
        "top_users": top_users,
        "orgs": all_org_names,
        "date_range": {"start": date_start, "end": date_end},
        "user_premium_usage": _aggregate_user_premium_csv(selected),
        "user_feature_usage": user_feature_usage,
    }


# ---------------------------------------------------------------------------
# API-sourced activity/premium helpers (fallback when no CSV uploaded)
# ---------------------------------------------------------------------------

def _build_api_usage_section(scope_users: set[str] | None = None) -> dict:
    """Build per-user activity report from API-synced usage_users data (billing cycle)."""
    all_scope_names = _get_all_scope_names()
    cycle_start_str = date.today().replace(day=1).isoformat()
    cycle_end_str = date.today().isoformat()
    user_agg: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_accepted": 0, "days_active": 0,
        "org": "", "ides": defaultdict(int),
    })
    date_start = ""
    date_end = ""

    for scope in all_scope_names:
        uu = data_collector.load_daily_usage_users(scope, start_day=cycle_start_str, end_day=cycle_end_str)
        if not uu:
            continue
        for rec in uu.get("records", []):
            login = rec.get("user_login", "")
            if not login:
                continue
            if scope_users is not None and login.lower() not in scope_users:
                continue
            day = rec.get("day", "")
            if day:
                if not date_start or day < date_start:
                    date_start = day
                if not date_end or day > date_end:
                    date_end = day
            u = user_agg[login]
            u["interactions"] += rec.get("user_initiated_interaction_count", 0)
            u["code_gen"] += rec.get("code_generation_activity_count", 0)
            u["code_accept"] += rec.get("code_acceptance_activity_count", 0)
            u["loc_suggested"] += (
                rec.get("loc_suggested_to_add_sum", 0) + rec.get("loc_suggested_to_delete_sum", 0)
            )
            u["loc_accepted"] += (
                rec.get("loc_added_sum", 0) + rec.get("loc_deleted_sum", 0)
            )
            u["days_active"] += 1
            if not u["org"]:
                u["org"] = scope
            for ide_data in rec.get("totals_by_ide", []):
                ide = ide_data.get("ide", "unknown")
                u["ides"][ide] += ide_data.get("code_generation_activity_count", 0)

    if not user_agg:
        # Even with no usage, show licensed users if seats available
        pass

    # Merge with seats data to include all licensed users (not just active)
    all_scope_names_for_seats = _get_all_scope_names()
    for scope in all_scope_names_for_seats:
        seats_data = data_collector.load_latest("seats", scope)
        if not seats_data:
            continue
        seen_logins: set[str] = set()
        for s in seats_data.get("seats", []):
            login = (s.get("assignee") or {}).get("login", "")
            if not login or login.lower() in seen_logins:
                continue
            seen_logins.add(login.lower())
            if scope_users is not None and login.lower() not in scope_users:
                continue
            if login not in user_agg:
                user_agg[login] = {
                    "interactions": 0, "code_gen": 0, "code_accept": 0,
                    "loc_suggested": 0, "loc_accepted": 0, "days_active": 0,
                    "org": scope, "ides": defaultdict(int),
                }

    if not user_agg:
        return {"has_data": False, "scope_filtered": scope_users is not None, "users": [], "date_range": {}, "total_users": 0}

    users = sorted(
        [
            {
                "user": k,
                "org": v["org"],
                "interactions": v["interactions"],
                "code_gen": v["code_gen"],
                "code_accept": v["code_accept"],
                "loc_suggested": v["loc_suggested"],
                "loc_accepted": v["loc_accepted"],
                "days_active": v["days_active"],
                "acceptance_rate": (
                    round(v["code_accept"] / v["code_gen"] * 100, 1)
                    if v["code_gen"] > 0 else 0.0
                ),
                "ides": [
                    {"ide": ide, "count": cnt}
                    for ide, cnt in sorted(v["ides"].items(), key=lambda x: -x[1])
                ],
            }
            for k, v in user_agg.items()
        ],
        key=lambda x: -(x["interactions"] + x["code_gen"]),
    )

    return {
        "has_data": True,
        "date_range": {"start": date_start, "end": date_end},
        "total_users": len(users),
        "users": users,
    }


def _build_org_billing_models(all_scope_names: list[str]) -> dict:
    """Load org-level billing model data from premium_requests snapshots."""
    model_map: dict[str, dict] = defaultdict(lambda: {
        "gross_qty": 0, "net_qty": 0, "gross_amount": 0.0, "net_amount": 0.0,
    })
    total_gross_qty = 0
    total_net_qty = 0
    total_gross_amount = 0.0
    for scope in all_scope_names:
        pr = data_collector.load_latest("premium_requests", scope)
        if not pr:
            continue
        for item in pr.get("usageItems", []):
            m = item.get("model", "unknown")
            model_map[m]["gross_qty"] += item.get("grossQuantity", 0)
            model_map[m]["net_qty"] += item.get("netQuantity", 0)
            model_map[m]["gross_amount"] += item.get("grossAmount", 0.0)
            model_map[m]["net_amount"] += item.get("netAmount", 0.0)
            total_gross_qty += item.get("grossQuantity", 0)
            total_net_qty += item.get("netQuantity", 0)
            total_gross_amount += item.get("grossAmount", 0.0)
    if not model_map:
        return {}
    return {
        "models": sorted([{"model": k, **v} for k, v in model_map.items()], key=lambda x: -x["gross_qty"]),
        "total_requests": total_gross_qty,
        "net_requests": total_net_qty,
        "total_cost": round(total_gross_amount, 4),
    }


def _build_api_premium_section(scope_users: set[str] | None = None) -> dict:
    """Build model usage stats from API-synced data (billing cycle).

    Priority: AI Credits (real billing) > legacy premium_requests > activity fallback.
    All paths support scope_users filtering.
    """
    all_scope_names = _get_all_scope_names()
    cycle_start_str = date.today().replace(day=1).isoformat()
    cycle_end_str = date.today().isoformat()

    # --- Try AI Credits data first (new billing model, June 2026+) ---
    ai_credits_data = None
    for scope in all_scope_names:
        ai_credits_data = data_collector.load_latest("ai_credits", scope)
        if ai_credits_data and ai_credits_data.get("usageItems"):
            break

    if ai_credits_data and ai_credits_data.get("usageItems"):
        items = ai_credits_data["usageItems"]
        model_map: dict[str, dict] = defaultdict(lambda: {
            "gross_qty": 0.0, "net_qty": 0.0, "gross_amount": 0.0, "net_amount": 0.0,
        })
        total_gross = 0.0
        total_net = 0.0
        total_gross_amount = 0.0
        total_net_amount = 0.0
        for item in items:
            m = item.get("model", "unknown")
            gross_qty = item.get("grossQuantity", 0)
            net_qty = item.get("netQuantity", 0)
            gross_amt = item.get("grossAmount", 0)
            net_amt = item.get("netAmount", 0)
            model_map[m]["gross_qty"] += gross_qty
            model_map[m]["net_qty"] += net_qty
            model_map[m]["gross_amount"] += gross_amt
            model_map[m]["net_amount"] += net_amt
            total_gross += gross_qty
            total_net += net_qty
            total_gross_amount += gross_amt
            total_net_amount += net_amt

        models = sorted(
            [{"model": k, **v} for k, v in model_map.items()],
            key=lambda x: -x["gross_qty"],
        )

        # Pool info
        from ..config import AIC_INCLUDED_PER_USER, AIC_PROMO_PER_USER, AIC_PROMO_START, AIC_PROMO_END
        billing = data_collector.load_latest("billing", all_scope_names[0]) if all_scope_names else None
        seats_data = data_collector.load_latest("seats", all_scope_names[0]) if all_scope_names else None
        total_seats = (seats_data or {}).get("total_seats", 0)
        today_str = date.today().isoformat()
        is_promo = AIC_PROMO_START <= today_str < AIC_PROMO_END
        plan_counts = (billing or {}).get("_plan_counts", {"enterprise": total_seats})
        pool_total = 0
        for plan, count in plan_counts.items():
            if is_promo:
                credits_per = AIC_PROMO_PER_USER.get(plan, AIC_PROMO_PER_USER["enterprise"])
            else:
                credits_per = AIC_INCLUDED_PER_USER.get(plan, AIC_INCLUDED_PER_USER["enterprise"])
            pool_total += count * credits_per
        pool_used_pct = round(total_gross / pool_total * 100, 1) if pool_total > 0 else 0.0

        # Per-user credits breakdown (with group scope filter)
        users_list: list[dict] = []
        for scope in all_scope_names:
            ai_credits_users = data_collector.load_latest("ai_credits_users", scope)
            if not ai_credits_users:
                continue
            for login, udata in ai_credits_users.items():
                if scope_users is not None and login.lower() not in scope_users:
                    continue
                gross = udata.get("gross_credits", 0)
                users_list.append({
                    "user": login,
                    "gross_credits": round(gross, 1),
                    "net_credits": round(udata.get("net_credits", 0), 1),
                    "gross_amount": round(udata.get("gross_amount", 0), 4),
                    "net_amount": round(udata.get("net_amount", 0), 4),
                    "models": udata.get("models", []),
                    "top_model": udata["models"][0]["model"] if udata.get("models") else "",
                    "pct": 0.0,
                })
        for u in users_list:
            u["pct"] = round(u["gross_credits"] / total_gross * 100, 1) if total_gross > 0 else 0.0
        users_list.sort(key=lambda x: -x["gross_credits"])

        # If scope filtered, recalculate model totals from per-user data
        if scope_users is not None:
            model_map = defaultdict(lambda: {"gross_qty": 0.0, "net_qty": 0.0, "gross_amount": 0.0, "net_amount": 0.0})
            total_gross = 0.0
            total_net = 0.0
            total_gross_amount = 0.0
            total_net_amount = 0.0
            for u in users_list:
                for m_info in u.get("models", []):
                    m = m_info.get("model", "unknown")
                    credits = m_info.get("credits", 0)
                    model_map[m]["gross_qty"] += credits
                    total_gross += credits
            models = sorted(
                [{"model": k, **v} for k, v in model_map.items() if v["gross_qty"] > 0],
                key=lambda x: -x["gross_qty"],
            )
            pool_used_pct = round(total_gross / pool_total * 100, 1) if pool_total > 0 else 0.0

        return {
            "has_data": True,
            "source": "ai_credits",
            "billing_model": "usage_based",
            "models": models,
            "total_requests": round(total_gross, 1),
            "net_requests": round(total_net, 1),
            "total_cost": round(total_net_amount, 4),
            "gross_cost": round(total_gross_amount, 4),
            "users": users_list,
            "pool": {
                "total_credits": pool_total,
                "plan_breakdown": {plan: count * (AIC_PROMO_PER_USER.get(plan, 7000) if is_promo else AIC_INCLUDED_PER_USER.get(plan, 3900)) for plan, count in plan_counts.items()},
                "total_seats": total_seats,
                "used_credits": round(total_gross, 1),
                "used_pct": pool_used_pct,
                "overage_credits": round(total_net, 1),
                "overage_cost": round(total_net_amount, 4),
                "is_promo": is_promo,
            },
            "time_period": ai_credits_data.get("timePeriod", {}),
        }

    # --- When group scope is active and no AI credits, use activity data ---
    if scope_users is not None:
        activity_model_map: dict[str, dict] = defaultdict(lambda: {
            "interactions": 0, "code_gen": 0, "code_accept": 0,
        })
        for scope in all_scope_names:
            uu = data_collector.load_daily_usage_users(scope, start_day=cycle_start_str, end_day=cycle_end_str)
            if not uu:
                continue
            records = uu if isinstance(uu, list) else uu.get("records", [uu])
            for rec in records:
                if (rec.get("user_login", "") or "").lower() not in scope_users:
                    continue
                for mf in rec.get("totals_by_model_feature", []):
                    m = mf.get("model", "unknown")
                    activity_model_map[m]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                    activity_model_map[m]["code_gen"] += mf.get("code_generation_activity_count", 0)
                    activity_model_map[m]["code_accept"] += mf.get("code_acceptance_activity_count", 0)
        total_interactions = sum(v["interactions"] for v in activity_model_map.values())
        total_code_gen = sum(v["code_gen"] for v in activity_model_map.values())
        activity_models = sorted(
            [{"model": k, "gross_qty": v["interactions"] + v["code_gen"],
              "net_qty": v["code_accept"], "gross_amount": 0.0, "net_amount": 0.0,
              "interactions": v["interactions"], "code_gen": v["code_gen"], "code_accept": v["code_accept"]}
             for k, v in activity_model_map.items() if v["interactions"] + v["code_gen"] > 0],
            key=lambda x: -x["gross_qty"],
        )
        # Also load org-level billing data for context
        org_billing = _build_org_billing_models(all_scope_names)
        result: dict = {
            "has_data": bool(activity_model_map) or bool(org_billing),
            "source": "activity",
            "scope_filtered": True,
            "models": activity_models,
            "total_requests": total_interactions + total_code_gen,
            "net_requests": total_interactions,
            "total_cost": 0.0,
        }
        if org_billing:
            result["billing_models"] = org_billing["models"]
            result["billing_total_requests"] = org_billing["total_requests"]
            result["billing_net_requests"] = org_billing["net_requests"]
            result["billing_total_cost"] = org_billing["total_cost"]
        if not result["has_data"]:
            result["has_data"] = False
            result["models"] = []
        return result

    # --- Fallback: Try legacy premium_requests data ---
    model_map: dict[str, dict] = defaultdict(lambda: {
        "gross_qty": 0, "net_qty": 0, "gross_amount": 0.0, "net_amount": 0.0,
    })
    total_gross_qty = 0
    total_net_qty = 0
    total_gross_amount = 0.0

    for scope in all_scope_names:
        pr = data_collector.load_latest("premium_requests", scope)
        if not pr:
            continue
        for item in pr.get("usageItems", []):
            m = item.get("model", "unknown")
            model_map[m]["gross_qty"] += item.get("grossQuantity", 0)
            model_map[m]["net_qty"] += item.get("netQuantity", 0)
            model_map[m]["gross_amount"] += item.get("grossAmount", 0.0)
            model_map[m]["net_amount"] += item.get("netAmount", 0.0)
            total_gross_qty += item.get("grossQuantity", 0)
            total_net_qty += item.get("netQuantity", 0)
            total_gross_amount += item.get("grossAmount", 0.0)

    if model_map:
        models = sorted(
            [{"model": k, **v} for k, v in model_map.items()],
            key=lambda x: -x["gross_qty"],
        )
        # Build per-user breakdown: prefer cached premium_requests_users (actual billing data),
        # fall back to usage_users totals_by_model_feature (interaction-based estimate)
        users: list[dict] = []

        # Try actual billing data first
        pru_users_data: dict | None = None
        for scope in all_scope_names:
            pru = data_collector.load_latest("premium_requests_users", scope)
            if pru and pru.get("users"):
                pru_users_data = pru
                break

        if pru_users_data:
            # Determine quota per user — use HIGHEST quota when user appears with multiple plans
            from ..config import PREMIUM_REQUEST_QUOTA_PER_USER
            seats_quota: dict[str, int] = {}
            for scope in all_scope_names:
                sd = data_collector.load_latest("seats", scope)
                if sd:
                    for s in sd.get("seats", []):
                        login = s.get("assignee", {}).get("login", "")
                        plan = s.get("plan_type", "enterprise")
                        if login:
                            quota_for_plan = PREMIUM_REQUEST_QUOTA_PER_USER.get(plan, 1000)
                            seats_quota[login] = max(seats_quota.get(login, 0), quota_for_plan)
            user_entries = pru_users_data.get("users", {})
            for login, ud in user_entries.items():
                qty = ud.get("gross_qty", 0)
                quota = seats_quota.get(login, 1000)
                users.append({
                    "user": login,
                    "activity": qty,
                    "top_model": ud.get("top_model", ""),
                    "quota": quota,
                    "quota_pct": round(qty / quota * 100, 1) if quota else 0,
                    "pct": 0,  # filled after
                    "source": "billing",
                })
            total_qty = sum(u["activity"] for u in users) or 1
            for u in users:
                u["pct"] = round(u["activity"] / total_qty * 100, 1)
            users.sort(key=lambda x: -x["activity"])
        else:
            # Fallback: estimate from usage_users totals_by_model_feature
            user_model_activity: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
            for scope in all_scope_names:
                uu = data_collector.load_daily_usage_users(scope, start_day=cycle_start_str, end_day=cycle_end_str)
                if not uu:
                    continue
                records = uu if isinstance(uu, list) else uu.get("records", [uu])
                for rec in records:
                    login = rec.get("user_login", "")
                    if not login:
                        continue
                    for mf in rec.get("totals_by_model_feature", []):
                        m = mf.get("model", "unknown")
                        count = (
                            mf.get("user_initiated_interaction_count", 0)
                            + mf.get("code_generation_activity_count", 0)
                        )
                        user_model_activity[login][m] += count
            user_summary: list[dict] = []
            for login, model_counts in user_model_activity.items():
                total = sum(model_counts.values())
                if total == 0:
                    continue
                top_model = max(model_counts, key=lambda k: model_counts[k])
                user_summary.append({"user": login, "activity": total, "top_model": top_model})
            total_user_activity = sum(u["activity"] for u in user_summary) or 1
            users = sorted(
                [{"user": u["user"], "activity": u["activity"],
                  "top_model": u["top_model"], "quota": None, "quota_pct": None,
                  "pct": round(u["activity"] / total_user_activity * 100, 1),
                  "source": "activity"}
                 for u in user_summary],
                key=lambda x: -x["activity"],
            )
        return {
            "has_data": True,
            "source": "billing",
            "models": models,
            "total_requests": total_gross_qty,
            "net_requests": total_net_qty,
            "total_cost": round(total_gross_amount, 4),
            "users": users,
        }

    # --- Fallback: derive model usage from usage totals_by_model_feature ---
    activity_model_map: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
    })
    for scope in all_scope_names:
        usage = data_collector.load_daily_usage(scope, start_day=cycle_start_str, end_day=cycle_end_str)
        if not usage:
            continue
        for rec in usage.get("records", []):
            for dt in rec.get("day_totals", []):
                for mf in dt.get("totals_by_model_feature", []):
                    m = mf.get("model", "unknown")
                    activity_model_map[m]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                    activity_model_map[m]["code_gen"] += mf.get("code_generation_activity_count", 0)
                    activity_model_map[m]["code_accept"] += mf.get("code_acceptance_activity_count", 0)

    if not activity_model_map:
        return {"has_data": False, "models": [], "total_requests": 0, "net_requests": 0, "total_cost": 0.0}

    total_interactions = sum(v["interactions"] for v in activity_model_map.values())
    total_code_gen = sum(v["code_gen"] for v in activity_model_map.values())
    activity_models = sorted(
        [{"model": k, "gross_qty": v["interactions"] + v["code_gen"],
          "net_qty": v["code_accept"], "gross_amount": 0.0, "net_amount": 0.0,
          "interactions": v["interactions"], "code_gen": v["code_gen"], "code_accept": v["code_accept"]}
         for k, v in activity_model_map.items()],
        key=lambda x: -x["gross_qty"],
    )
    return {
        "has_data": True,
        "source": "activity",
        "models": activity_models,
        "total_requests": total_interactions + total_code_gen,
        "net_requests": total_interactions,
        "total_cost": 0.0,
    }


# ---------------------------------------------------------------------------
# CSV dashboard endpoint (dedicated, separate from main dashboard)
# ---------------------------------------------------------------------------

@router.get("/data/csv-dashboard")
async def get_csv_dashboard(
    request: Request,
    orgs: str = Query(default=""),
    cost_centers: str = Query(default=""),
    products: str = Query(default=""),
    skus: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    group_id: int = Query(default=0),
):
    """Aggregated dashboard data derived entirely from uploaded CSVs."""
    scope_users = _get_scope_usernames(request, group_id or None)

    selected_orgs = [o.strip() for o in orgs.split(",") if o.strip()]
    selected_ccs = [c.strip() for c in cost_centers.split(",") if c.strip()]
    selected_products = [p.strip() for p in products.split(",") if p.strip()]
    selected_skus = [s.strip() for s in skus.split(",") if s.strip()]

    premium = _build_premium_csv_section(selected_orgs, selected_ccs, date_from, date_to, scope_users=scope_users)
    usage = _build_usage_report_section(selected_orgs, selected_ccs, selected_products, selected_skus, date_from, date_to, scope_users=scope_users)

    # Gather all filter options from raw data
    all_premium = _load_all_csv_records(CSV_TYPE_PREMIUM)
    all_usage = _load_all_csv_records(CSV_TYPE_USAGE)
    all_orgs: set[str] = set()
    all_ccs: set[str] = set()
    all_products: set[str] = set()
    all_skus: set[str] = set()
    for r in all_premium:
        if r.get("organization"):
            all_orgs.add(r["organization"])
        if r.get("cost_center_name"):
            all_ccs.add(r["cost_center_name"])
    for r in all_usage:
        if r.get("organization"):
            all_orgs.add(r["organization"])
        if r.get("cost_center_name"):
            all_ccs.add(r["cost_center_name"])
        if r.get("product"):
            all_products.add(r["product"])
        if r.get("sku"):
            all_skus.add(r["sku"])

    return {
        "premium_csv": premium,
        "usage_report": usage,
        "api_usage": _build_api_usage_section(scope_users=scope_users),
        "api_premium": _build_api_premium_section(scope_users=scope_users),
        "filters": {
            "orgs": sorted(all_orgs),
            "cost_centers": sorted(all_ccs),
            "products": sorted(all_products),
            "skus": sorted(all_skus),
        },
    }


def _apply_common_filters(records: list[dict], selected_orgs: list[str], selected_ccs: list[str],
                           date_from: str, date_to: str) -> list[dict]:
    result = records
    if selected_orgs:
        result = [r for r in result if r.get("organization", "") in selected_orgs]
    if selected_ccs:
        result = [r for r in result if (r.get("cost_center_name") or "") in selected_ccs]
    if date_from:
        result = [r for r in result if r.get("date", "") >= date_from]
    if date_to:
        result = [r for r in result if r.get("date", "") <= date_to]
    return result


def _build_premium_csv_section(selected_orgs: list[str], selected_ccs: list[str],
                                date_from: str, date_to: str,
                                scope_users: set[str] | None = None) -> dict:
    """Build aggregated premium request CSV section for CSV dashboard."""
    all_records = _load_all_csv_records(CSV_TYPE_PREMIUM)
    if not all_records:
        return {"has_data": False, "date_range": {}, "kpi": {}, "daily_trend": [],
                "model_breakdown": [], "org_breakdown": [], "cost_center_breakdown": [], "users": []}

    filtered = _apply_common_filters(all_records, selected_orgs, selected_ccs, date_from, date_to)
    if scope_users is not None:
        filtered = [r for r in filtered if (r.get("username", "") or "").lower() in scope_users]
    if not filtered:
        return {"has_data": False, "date_range": {}, "kpi": {}, "daily_trend": [],
                "model_breakdown": [], "org_breakdown": [], "cost_center_breakdown": [], "users": []}

    dates = [r.get("date", "") for r in filtered if r.get("date")]
    date_range = {"start": min(dates) if dates else "", "end": max(dates) if dates else ""}

    # Per-user aggregation
    user_map: dict[str, dict] = defaultdict(lambda: {
        "requests": 0, "gross_amount": 0.0, "net_amount": 0.0,
        "models": defaultdict(float), "days_active": set(), "org": "",
        "quota": 0, "cost_center": "",
    })
    for r in filtered:
        user = r.get("username", "")
        qty = float(r.get("quantity", 0))
        gross = float(r.get("gross_amount", 0))
        net = float(r.get("net_amount", 0))
        model = r.get("model", "unknown")
        u = user_map[user]
        u["requests"] += qty
        u["gross_amount"] += gross
        u["net_amount"] += net
        u["models"][model] += qty
        u["days_active"].add(r.get("date", ""))
        u["org"] = r.get("organization", "")
        u["cost_center"] = r.get("cost_center_name", "") or ""
        try:
            u["quota"] = int(r.get("total_monthly_quota", 0))
        except (ValueError, TypeError):
            pass

    users = []
    for username, info in sorted(user_map.items(), key=lambda x: -x[1]["requests"]):
        models = [{"model": m, "requests": q} for m, q in sorted(info["models"].items(), key=lambda x: -x[1])]
        users.append({
            "user": username, "org": info["org"], "cost_center": info["cost_center"],
            "requests": round(info["requests"], 2), "gross_amount": round(info["gross_amount"], 4),
            "net_amount": round(info["net_amount"], 4), "days_active": len(info["days_active"]),
            "quota": info["quota"],
            "usage_pct": round(info["requests"] / info["quota"] * 100, 1) if info["quota"] > 0 else 0,
            "models": models,
        })

    # Daily trend
    day_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        dm = day_map[r.get("date", "")]
        dm["requests"] += float(r.get("quantity", 0))
        dm["amount"] += float(r.get("gross_amount", 0))
        dm["users"].add(r.get("username", ""))
    daily_trend = [{"day": d, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4),
                    "active_users": len(v["users"])} for d, v in sorted(day_map.items())]

    # Model breakdown
    model_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        mm = model_map[r.get("model", "unknown")]
        mm["requests"] += float(r.get("quantity", 0))
        mm["amount"] += float(r.get("gross_amount", 0))
        mm["users"].add(r.get("username", ""))
    model_breakdown = [{"model": m, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4),
                        "user_count": len(v["users"])} for m, v in sorted(model_map.items(), key=lambda x: -x[1]["requests"])]

    # Org breakdown
    org_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        om = org_map[r.get("organization", "")]
        om["requests"] += float(r.get("quantity", 0))
        om["amount"] += float(r.get("gross_amount", 0))
        om["users"].add(r.get("username", ""))
    org_breakdown = [{"org": o, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4),
                      "user_count": len(v["users"])} for o, v in sorted(org_map.items(), key=lambda x: -x[1]["requests"])]

    # Cost center breakdown
    cc_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        cc = r.get("cost_center_name", "") or "Unknown"
        cm = cc_map[cc]
        cm["requests"] += float(r.get("quantity", 0))
        cm["amount"] += float(r.get("gross_amount", 0))
        cm["users"].add(r.get("username", ""))
    cost_center_breakdown = [{"cost_center": cc, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4),
                               "user_count": len(v["users"])} for cc, v in sorted(cc_map.items(), key=lambda x: -x[1]["requests"])]

    total_requests = sum(u["requests"] for u in users)
    total_cost = sum(u["gross_amount"] for u in users)

    return {
        "has_data": True,
        "date_range": date_range,
        "kpi": {
            "total_requests": round(total_requests, 2),
            "total_cost": round(total_cost, 4),
            "unique_users": len(users),
            "unique_orgs": len(org_breakdown),
        },
        "daily_trend": daily_trend,
        "model_breakdown": model_breakdown,
        "org_breakdown": org_breakdown,
        "cost_center_breakdown": cost_center_breakdown,
        "users": users,
    }


def _build_usage_report_section(selected_orgs: list[str], selected_ccs: list[str],
                                 selected_products: list[str], selected_skus: list[str],
                                 date_from: str, date_to: str,
                                 scope_users: set[str] | None = None) -> dict:
    """Build aggregated usage report CSV section for CSV dashboard."""
    all_records = _load_all_csv_records(CSV_TYPE_USAGE)
    if not all_records:
        return {"has_data": False, "date_range": {}, "kpi": {}, "daily_trend": [],
                "product_breakdown": [], "sku_breakdown": [], "org_breakdown": [],
                "cost_center_breakdown": [], "users": []}

    filtered = _apply_common_filters(all_records, selected_orgs, selected_ccs, date_from, date_to)
    if selected_products:
        filtered = [r for r in filtered if r.get("product", "") in selected_products]
    if selected_skus:
        filtered = [r for r in filtered if r.get("sku", "") in selected_skus]
    if scope_users is not None:
        filtered = [r for r in filtered if (r.get("username", "") or "").lower() in scope_users]

    if not filtered:
        return {"has_data": False, "date_range": {}, "kpi": {}, "daily_trend": [],
                "product_breakdown": [], "sku_breakdown": [], "org_breakdown": [],
                "cost_center_breakdown": [], "users": []}

    dates = [r.get("date", "") for r in filtered if r.get("date")]
    date_range = {"start": min(dates) if dates else "", "end": max(dates) if dates else ""}

    # Daily trend
    day_map: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "net": 0.0, "users": set()})
    for r in filtered:
        dm = day_map[r.get("date", "")]
        dm["gross"] += float(r.get("gross_amount", 0))
        dm["net"] += float(r.get("net_amount", 0))
        dm["users"].add(r.get("username", ""))
    daily_trend = [{"day": d, "gross_amount": round(v["gross"], 4), "net_amount": round(v["net"], 4),
                    "active_users": len(v["users"])} for d, v in sorted(day_map.items())]

    # Product breakdown
    prod_map: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "net": 0.0, "users": set(), "quantity": 0.0})
    for r in filtered:
        pm = prod_map[r.get("product", "unknown")]
        pm["gross"] += float(r.get("gross_amount", 0))
        pm["net"] += float(r.get("net_amount", 0))
        pm["quantity"] += float(r.get("quantity", 0))
        pm["users"].add(r.get("username", ""))
    product_breakdown = [{"product": p, "gross_amount": round(v["gross"], 4), "net_amount": round(v["net"], 4),
                           "quantity": round(v["quantity"], 4), "user_count": len(v["users"])}
                         for p, v in sorted(prod_map.items(), key=lambda x: -x[1]["gross"])]

    # SKU breakdown
    sku_map: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "net": 0.0, "users": set(), "quantity": 0.0})
    for r in filtered:
        sm = sku_map[r.get("sku", "unknown")]
        sm["gross"] += float(r.get("gross_amount", 0))
        sm["net"] += float(r.get("net_amount", 0))
        sm["quantity"] += float(r.get("quantity", 0))
        sm["users"].add(r.get("username", ""))
    sku_breakdown = [{"sku": s, "gross_amount": round(v["gross"], 4), "net_amount": round(v["net"], 4),
                      "quantity": round(v["quantity"], 4), "user_count": len(v["users"])}
                     for s, v in sorted(sku_map.items(), key=lambda x: -x[1]["gross"])]

    # Org breakdown
    org_map: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "net": 0.0, "users": set()})
    for r in filtered:
        om = org_map[r.get("organization", "")]
        om["gross"] += float(r.get("gross_amount", 0))
        om["net"] += float(r.get("net_amount", 0))
        om["users"].add(r.get("username", ""))
    org_breakdown = [{"org": o, "gross_amount": round(v["gross"], 4), "net_amount": round(v["net"], 4),
                      "user_count": len(v["users"])} for o, v in sorted(org_map.items(), key=lambda x: -x[1]["gross"])]

    # Cost center breakdown
    cc_map: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "net": 0.0, "users": set()})
    for r in filtered:
        cc = r.get("cost_center_name", "") or "Unknown"
        cm = cc_map[cc]
        cm["gross"] += float(r.get("gross_amount", 0))
        cm["net"] += float(r.get("net_amount", 0))
        cm["users"].add(r.get("username", ""))
    cost_center_breakdown = [{"cost_center": cc, "gross_amount": round(v["gross"], 4), "net_amount": round(v["net"], 4),
                               "user_count": len(v["users"])} for cc, v in sorted(cc_map.items(), key=lambda x: -x[1]["gross"])]

    # Per-user aggregation
    user_map: dict[str, dict] = defaultdict(lambda: {
        "gross": 0.0, "net": 0.0, "quantity": 0.0, "org": "", "cost_center": "",
        "skus": defaultdict(float), "days_active": set(),
    })
    for r in filtered:
        user = r.get("username", "")
        um = user_map[user]
        um["gross"] += float(r.get("gross_amount", 0))
        um["net"] += float(r.get("net_amount", 0))
        um["quantity"] += float(r.get("quantity", 0))
        um["org"] = r.get("organization", "")
        um["cost_center"] = r.get("cost_center_name", "") or ""
        um["skus"][r.get("sku", "unknown")] += float(r.get("gross_amount", 0))
        um["days_active"].add(r.get("date", ""))
    users = []
    for username, info in sorted(user_map.items(), key=lambda x: -x[1]["gross"]):
        skus = [{"sku": s, "amount": round(a, 4)} for s, a in sorted(info["skus"].items(), key=lambda x: -x[1])]
        users.append({
            "user": username, "org": info["org"], "cost_center": info["cost_center"],
            "gross_amount": round(info["gross"], 4), "net_amount": round(info["net"], 4),
            "quantity": round(info["quantity"], 4), "days_active": len(info["days_active"]),
            "skus": skus,
        })

    total_gross = sum(float(r.get("gross_amount", 0)) for r in filtered)
    total_net = sum(float(r.get("net_amount", 0)) for r in filtered)
    total_discount = sum(float(r.get("discount_amount", 0)) for r in filtered)

    return {
        "has_data": True,
        "date_range": date_range,
        "kpi": {
            "total_gross": round(total_gross, 4),
            "total_net": round(total_net, 4),
            "total_discount": round(total_discount, 4),
            "unique_users": len(users),
            "unique_orgs": len(org_breakdown),
        },
        "daily_trend": daily_trend,
        "product_breakdown": product_breakdown,
        "sku_breakdown": sku_breakdown,
        "org_breakdown": org_breakdown,
        "cost_center_breakdown": cost_center_breakdown,
        "users": users,
    }


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

CSV_TYPE_PREMIUM = "premium_request"
CSV_TYPE_USAGE = "usage_report"


def _get_csv_dir(csv_type: str = CSV_TYPE_PREMIUM) -> Path:
    if csv_type == CSV_TYPE_USAGE:
        return data_collector.data_dir / "usage_report_csv"
    return data_collector.data_dir / "premium_usage_csv"


def _detect_csv_type(fieldnames: list[str]) -> str | None:
    """Detect whether a CSV is a premium_request or usage_report based on columns."""
    cols = set(fieldnames)
    if "model" in cols and "username" in cols and "organization" in cols:
        return CSV_TYPE_PREMIUM
    if "product" in cols and "sku" in cols and "unit_type" in cols:
        return CSV_TYPE_USAGE
    return None


def _load_all_csv_records(csv_type: str = CSV_TYPE_PREMIUM) -> list[dict]:
    """Load all CSV records from the given type's directory."""
    csv_dir = _get_csv_dir(csv_type)
    if not csv_dir.exists():
        return []
    records: list[dict] = []
    for f in sorted(csv_dir.glob("*.csv")):
        with open(f, encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                records.append(row)
    return records


def _aggregate_user_premium_csv(selected_orgs: list[str]) -> dict:
    """Aggregate per-user premium usage from uploaded CSV files (billing cycle only).

    Returns structure with per-user breakdown, daily trend, model breakdown, etc.
    """
    records = _load_all_csv_records()
    if not records:
        return {"has_data": False, "latest_date": None, "users": [], "daily_trend": [],
                "model_breakdown": [], "org_breakdown": [], "total_requests": 0, "total_cost": 0}

    # Filter by selected orgs and billing cycle
    cycle_start_str = date.today().replace(day=1).isoformat()
    cycle_end_str = date.today().isoformat()
    filtered = [r for r in records
                if r.get("organization", "") in selected_orgs
                and cycle_start_str <= (r.get("date", "") or "") <= cycle_end_str]
    if not filtered:
        return {"has_data": False, "latest_date": None, "users": [], "daily_trend": [],
                "model_breakdown": [], "org_breakdown": [], "total_requests": 0, "total_cost": 0}

    latest_date = max(r.get("date", "") for r in filtered)

    # Per-user aggregation
    user_map: dict[str, dict] = defaultdict(lambda: {
        "requests": 0, "gross_amount": 0.0, "net_amount": 0.0,
        "models": defaultdict(float), "days_active": set(), "org": "",
        "quota": 0, "cost_center": "",
    })
    for r in filtered:
        user = r.get("username", "")
        qty = float(r.get("quantity", 0))
        gross = float(r.get("gross_amount", 0))
        net = float(r.get("net_amount", 0))
        model = r.get("model", "unknown")
        u = user_map[user]
        u["requests"] += qty
        u["gross_amount"] += gross
        u["net_amount"] += net
        u["models"][model] += qty
        u["days_active"].add(r.get("date", ""))
        u["org"] = r.get("organization", "")
        u["cost_center"] = r.get("cost_center_name", "") or ""
        try:
            u["quota"] = int(r.get("total_monthly_quota", 0))
        except (ValueError, TypeError):
            pass

    users = []
    for username, info in sorted(user_map.items(), key=lambda x: -x[1]["requests"]):
        models = [{"model": m, "requests": q} for m, q in sorted(info["models"].items(), key=lambda x: -x[1])]
        users.append({
            "user": username,
            "org": info["org"],
            "cost_center": info["cost_center"],
            "requests": round(info["requests"], 2),
            "gross_amount": round(info["gross_amount"], 4),
            "net_amount": round(info["net_amount"], 4),
            "days_active": len(info["days_active"]),
            "quota": info["quota"],
            "usage_pct": round(info["requests"] / info["quota"] * 100, 1) if info["quota"] > 0 else 0,
            "models": models,
        })

    # Daily trend
    day_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        day = r.get("date", "")
        qty = float(r.get("quantity", 0))
        gross = float(r.get("gross_amount", 0))
        dm = day_map[day]
        dm["requests"] += qty
        dm["amount"] += gross
        dm["users"].add(r.get("username", ""))

    daily_trend = [
        {"day": d, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4), "active_users": len(v["users"])}
        for d, v in sorted(day_map.items())
    ]

    # Model breakdown
    model_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        model = r.get("model", "unknown")
        mm = model_map[model]
        mm["requests"] += float(r.get("quantity", 0))
        mm["amount"] += float(r.get("gross_amount", 0))
        mm["users"].add(r.get("username", ""))

    model_breakdown = [
        {"model": m, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4), "user_count": len(v["users"])}
        for m, v in sorted(model_map.items(), key=lambda x: -x[1]["requests"])
    ]

    # Org breakdown
    org_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        org = r.get("organization", "")
        om = org_map[org]
        om["requests"] += float(r.get("quantity", 0))
        om["amount"] += float(r.get("gross_amount", 0))
        om["users"].add(r.get("username", ""))

    org_breakdown = [
        {"org": o, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4), "user_count": len(v["users"])}
        for o, v in sorted(org_map.items(), key=lambda x: -x[1]["requests"])
    ]

    # Cost center breakdown
    cc_map: dict[str, dict] = defaultdict(lambda: {"requests": 0, "amount": 0.0, "users": set()})
    for r in filtered:
        cc = r.get("cost_center_name", "") or "Unknown"
        cm = cc_map[cc]
        cm["requests"] += float(r.get("quantity", 0))
        cm["amount"] += float(r.get("gross_amount", 0))
        cm["users"].add(r.get("username", ""))

    cost_center_breakdown = [
        {"cost_center": cc, "requests": round(v["requests"], 2), "amount": round(v["amount"], 4), "user_count": len(v["users"])}
        for cc, v in sorted(cc_map.items(), key=lambda x: -x[1]["requests"])
    ]

    total_requests = sum(u["requests"] for u in users)
    total_cost = sum(u["gross_amount"] for u in users)

    return {
        "has_data": True,
        "latest_date": latest_date,
        "users": users,
        "daily_trend": daily_trend,
        "model_breakdown": model_breakdown,
        "org_breakdown": org_breakdown,
        "cost_center_breakdown": cost_center_breakdown,
        "total_requests": round(total_requests, 2),
        "total_cost": round(total_cost, 4),
    }


# ---------------------------------------------------------------------------
# CSV upload endpoints
# ---------------------------------------------------------------------------

@router.post("/data/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    """Upload a CSV file – either a premium request CSV or a usage report CSV.

    The type is auto-detected from the column headers. The file is validated,
    deduplicated against existing data, and saved.
    """
    if not file.filename or not file.filename.endswith(".csv"):
        return {"error": "Only CSV files are accepted."}

    content = await file.read()
    text = content.decode("utf-8-sig")  # handle BOM

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return {"error": "CSV file has no headers."}

    csv_type = _detect_csv_type(list(reader.fieldnames))
    if csv_type is None:
        return {"error": "Unrecognised CSV format. Expected a premium request CSV (with 'model' column) "
                         "or a usage report CSV (with 'product' and 'sku' columns)."}

    rows = list(reader)
    if not rows:
        return {"error": "CSV file is empty."}

    dates = [r.get("date", "") for r in rows if r.get("date")]
    date_min = min(dates) if dates else "unknown"
    date_max = max(dates) if dates else "unknown"

    csv_dir = _get_csv_dir(csv_type)
    csv_dir.mkdir(parents=True, exist_ok=True)

    # Build deduplication key per type
    def _key(row: dict) -> str:
        if csv_type == CSV_TYPE_PREMIUM:
            return f"{row.get('date')}|{row.get('username')}|{row.get('model')}|{row.get('organization')}"
        return f"{row.get('date')}|{row.get('username')}|{row.get('sku')}|{row.get('organization')}"

    existing_keys: set[str] = set()
    for f in csv_dir.glob("*.csv"):
        with open(f, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                existing_keys.add(_key(row))

    new_rows = [row for row in rows if _key(row) not in existing_keys]

    if not new_rows:
        return {
            "status": "no_new_data",
            "csv_type": csv_type,
            "date_range": {"start": date_min, "end": date_max},
            "total_rows": len(rows),
            "new_rows": 0,
        }

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    prefix = "premium_usage" if csv_type == CSV_TYPE_PREMIUM else "usage_report"
    out_path = csv_dir / f"{prefix}_{ts}.csv"
    fieldnames = list(reader.fieldnames)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(new_rows)

    return {
        "status": "ok",
        "csv_type": csv_type,
        "date_range": {"start": date_min, "end": date_max},
        "total_rows": len(rows),
        "new_rows": len(new_rows),
        "duplicates_skipped": len(rows) - len(new_rows),
        "file_saved": out_path.name,
    }


# Keep old endpoint as alias for backward-compatibility
@router.post("/data/upload-premium-csv")
async def upload_premium_csv(file: UploadFile = File(...)):
    """Alias for /data/upload-csv (backward compatibility)."""
    return await upload_csv(file)


@router.get("/data/csv-info")
async def get_csv_info():
    """Get info about all uploaded CSV data (both premium request and usage report)."""
    def _scan(csv_type: str) -> dict:
        csv_dir = _get_csv_dir(csv_type)
        csv_files = sorted(csv_dir.glob("*.csv")) if csv_dir.exists() else []
        total_records = 0
        all_dates: list[str] = []
        all_orgs: set[str] = set()
        all_users: set[str] = set()
        for f in csv_files:
            with open(f, encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    total_records += 1
                    d = row.get("date", "")
                    if d:
                        all_dates.append(d)
                    if row.get("organization"):
                        all_orgs.add(row["organization"])
                    if row.get("username"):
                        all_users.add(row["username"])
        return {
            "has_data": total_records > 0,
            "latest_date": max(all_dates) if all_dates else None,
            "earliest_date": min(all_dates) if all_dates else None,
            "file_count": len(csv_files),
            "total_records": total_records,
            "orgs": sorted(all_orgs),
            "user_count": len(all_users),
        }

    return {
        "premium_csv": _scan(CSV_TYPE_PREMIUM),
        "usage_report": _scan(CSV_TYPE_USAGE),
    }


@router.get("/data/premium-csv-info")
async def get_premium_csv_info():
    """Get info about uploaded premium usage CSV data (legacy endpoint)."""
    info = await get_csv_info()
    return info["premium_csv"]


@router.get("/data/cost-center-report")
async def get_cost_center_report(enterprise: str = Query(default="")):
    """Generate and return a ZIP archive with one HTML report per cost center.

    Each HTML is self-contained (no external deps), includes premium request
    and usage report analysis filtered to that cost center's members.
    """
    enterprise_list = data_collector.load_latest("enterprise", "all") or []
    if not isinstance(enterprise_list, list):
        enterprise_list = []

    available_slugs = [e["slug"] for e in enterprise_list]
    selected_slug = enterprise if enterprise in available_slugs else (available_slugs[0] if available_slugs else "")

    if not selected_slug:
        return {"error": "No enterprise data found. Run Sync Data first."}

    cc_data = data_collector.load_latest("cost_centers", selected_slug)
    if not cc_data:
        return {"error": f"No cost center data for enterprise '{selected_slug}'. Run Sync Data first."}

    cost_centers    = cc_data.get("cost_centers", [])
    enterprise_name = cc_data.get("enterprise_name", selected_slug)

    all_premium = _load_all_csv_records(CSV_TYPE_PREMIUM)
    all_usage   = _load_all_csv_records(CSV_TYPE_USAGE)

    zip_bytes = generate_report_zip(
        enterprise=selected_slug,
        enterprise_name=enterprise_name,
        cost_centers=cost_centers,
        all_premium_records=all_premium,
        all_usage_records=all_usage,
    )

    filename = f"cc-report-{selected_slug}.zip"
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/data/cost-center-dashboard")
async def get_cost_center_dashboard(
    request: Request,
    enterprise: str = Query(default=""),
    cost_centers: str = Query(default=""),
    state: str = Query(default="active"),
    search: str = Query(default=""),
    group_id: int = Query(default=0),
):
    """Return cost center dashboard data from synced JSON files.

    Supports filtering by enterprise slug, cost center names (comma-separated),
    state ('active'|'archived'|'all'), and user login search.
    """
    scope_users = _get_scope_usernames(request, group_id or None)

    # Collect available enterprises from saved data
    enterprise_list = data_collector.load_latest("enterprise", "all") or []
    if not isinstance(enterprise_list, list):
        enterprise_list = []

    if not enterprise_list:
        return {
            "enterprises": [],
            "selected_enterprise": None,
            "cost_centers": [],
            "total_cost_centers": 0,
            "total_unique_members": 0,
            "user_map": [],
            "no_data": True,
        }

    # Choose which enterprise to show
    available_slugs = [e["slug"] for e in enterprise_list]
    selected_slug = enterprise if enterprise in available_slugs else available_slugs[0]

    cc_data = data_collector.load_latest("cost_centers", selected_slug)
    if not cc_data:
        return {
            "enterprises": enterprise_list,
            "selected_enterprise": selected_slug,
            "cost_centers": [],
            "total_cost_centers": 0,
            "total_unique_members": 0,
            "user_map": [],
            "no_data": True,
        }

    all_ccs: list[dict] = cc_data.get("cost_centers", [])

    # Apply state filter
    if state != "all":
        all_ccs = [cc for cc in all_ccs if cc.get("state", "active") == state]

    # Apply cost center name filter
    cc_filter = [n.strip() for n in cost_centers.split(",") if n.strip()] if cost_centers.strip() else []
    if cc_filter:
        all_ccs = [cc for cc in all_ccs if cc.get("name") in cc_filter]

    # Apply member search filter
    search_lower = search.strip().lower()
    if search_lower:
        filtered = []
        for cc in all_ccs:
            matched_members = [
                m for m in cc.get("members", [])
                if search_lower in m.get("login", "").lower()
            ]
            if matched_members:
                filtered.append({**cc, "members": matched_members, "member_count": len(matched_members)})
        all_ccs = filtered

    # Apply group scope filter to members in each cost center
    if scope_users is not None:
        scoped = []
        for cc in all_ccs:
            kept = [m for m in cc.get("members", []) if m.get("login", "").lower() in scope_users]
            if kept:
                scoped.append({**cc, "members": kept, "member_count": len(kept)})
        all_ccs = scoped

    # Build user → cost_centers reverse map
    user_cc_map: dict[str, dict] = {}
    for cc in all_ccs:
        for member in cc.get("members", []):
            login = member["login"]
            if login not in user_cc_map:
                user_cc_map[login] = {
                    "login": login,
                    "avatar_url": member.get("avatar_url", ""),
                    "html_url": member.get("html_url", ""),
                    "cost_centers": [],
                }
            user_cc_map[login]["cost_centers"].append({
                "name": cc["name"],
                "id": cc.get("id", ""),
                "source_type": member.get("source_type", ""),
                "source_name": member.get("source_name", ""),
            })

    user_map = sorted(user_cc_map.values(), key=lambda u: u["login"].lower())

    # Build seat_fallback: seat data + activity metrics per user (shown when no cost centers)
    seat_fallback = _build_seat_fallback(selected_slug, scope_users=scope_users)

    return {
        "enterprises": enterprise_list,
        "selected_enterprise": selected_slug,
        "enterprise_name": cc_data.get("enterprise_name", selected_slug),
        "cost_centers": all_ccs,
        "total_cost_centers": len(all_ccs),
        "total_unique_members": len(user_map),
        "user_map": user_map,
        "seat_fallback": seat_fallback,
        "no_data": False,
    }


def _build_seat_fallback(scope: str, scope_users: set[str] | None = None) -> dict:
    """Build per-user seat + activity data for use when enterprise has no cost centers."""
    seats_data = data_collector.load_latest("seats", scope)
    if not seats_data:
        return {"has_data": False, "users": [], "total_seats": 0}

    # Build activity map from usage_users (billing cycle)
    cycle_start_str = date.today().replace(day=1).isoformat()
    cycle_end_str = date.today().isoformat()
    activity_map: dict[str, dict] = {}
    uu = data_collector.load_daily_usage_users(scope, start_day=cycle_start_str, end_day=cycle_end_str)
    if uu:
        for rec in uu.get("records", []):
            login = rec.get("user_login", "")
            if not login:
                continue
            login_lower = login.lower()
            if login_lower not in activity_map:
                activity_map[login_lower] = {
                    "interactions": 0, "code_gen": 0, "code_accept": 0,
                    "loc_suggested": 0, "days_active": 0,
                }
            a = activity_map[login_lower]
            a["interactions"] += rec.get("user_initiated_interaction_count", 0)
            a["code_gen"] += rec.get("code_generation_activity_count", 0)
            a["code_accept"] += rec.get("code_acceptance_activity_count", 0)
            a["loc_suggested"] += rec.get("loc_suggested_to_add_sum", 0)
            a["days_active"] += 1

    users = []
    seen_logins: set[str] = set()
    for seat in seats_data.get("seats", []):
        assignee = seat.get("assignee", {})
        login = assignee.get("login", "")
        if not login or login.lower() in seen_logins:
            continue
        seen_logins.add(login.lower())
        if scope_users is not None and login.lower() not in scope_users:
            continue
        team = seat.get("assigning_team")
        act = activity_map.get(login.lower(), {})
        users.append({
            "login": login,
            "avatar_url": assignee.get("avatar_url", ""),
            "last_activity_at": seat.get("last_activity_at"),
            "last_activity_editor": seat.get("last_activity_editor"),
            "plan_type": seat.get("plan_type", ""),
            "team": team.get("name", "") if team else "",
            "interactions": act.get("interactions", 0),
            "code_gen": act.get("code_gen", 0),
            "code_accept": act.get("code_accept", 0),
            "loc_suggested": act.get("loc_suggested", 0),
            "days_active": act.get("days_active", 0),
            "acceptance_rate": (
                round(act["code_accept"] / act["code_gen"] * 100, 1)
                if act.get("code_gen", 0) > 0 else 0.0
            ),
        })

    users.sort(key=lambda x: -(x["interactions"] + x["code_gen"]))

    return {
        "has_data": True,
        "total_seats": len(users),
        "users": users,
    }


# ── Periodic Report ──────────────────────────────────────────────────────────

@router.get("/data/periodic-report")
async def get_periodic_report(
    period_type: str = Query(default="monthly", description="'monthly' or 'quarterly'"),
    year: int = Query(default=2025, description="Calendar year, e.g. 2025"),
    period: int = Query(default=1, description="Month 1-12 (monthly) or quarter 1-4 (quarterly)"),
    orgs: str = Query(default="", description="Comma-separated org/enterprise slugs; empty = all"),
    format: str = Query(default="html", description="Output format: 'html', 'csv', or 'xlsx'"),
):
    """Generate and return a periodic (monthly or quarterly) report.

    Returns a single file in the requested format:
    - html : self-contained dark-theme HTML with SVG charts
    - csv  : multi-section CSV with all data tables (UTF-8 BOM for Excel)
    - xlsx : Excel workbook with multiple sheets
    """
    import calendar

    if period_type not in ("monthly", "quarterly"):
        return {"error": "period_type must be 'monthly' or 'quarterly'"}
    if period_type == "monthly" and not (1 <= period <= 12):
        return {"error": "For monthly reports, period must be 1-12"}
    if period_type == "quarterly" and not (1 <= period <= 4):
        return {"error": "For quarterly reports, period must be 1-4"}
    if not (2020 <= year <= 2099):
        return {"error": "year must be between 2020 and 2099"}
    if format not in ("html", "csv", "xlsx"):
        return {"error": "format must be 'html', 'csv', or 'xlsx'"}

    org_filter = [o.strip() for o in orgs.split(",") if o.strip()] if orgs else []

    try:
        file_bytes, filename, media_type = generate_periodic_report(
            data_collector=data_collector,
            period_type=period_type,
            year=year,
            period=period,
            fmt=format,
            org_filter=org_filter,
            all_scope_names=_get_all_scope_names(),
        )
    except Exception as exc:
        return {"error": f"Report generation failed: {exc}"}

    # Save to report history
    _save_report_history(file_bytes, filename, period_type, year, period, format, org_filter)

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Report History helpers ────────────────────────────────────────────────────

_REPORTS_DIR = Path(__file__).parent.parent.parent.parent / "data" / "reports"
_REPORTS_INDEX = _REPORTS_DIR / "index.json"


def _load_report_index() -> list[dict]:
    if _REPORTS_INDEX.exists():
        try:
            with open(_REPORTS_INDEX, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _save_report_history(
    file_bytes: bytes,
    filename: str,
    period_type: str,
    year: int,
    period: int,
    fmt: str,
    org_filter: list[str],
) -> None:
    try:
        _REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        entry_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{fmt}"
        report_path = _REPORTS_DIR / f"{entry_id}_{filename}"
        report_path.write_bytes(file_bytes)
        index = _load_report_index()
        index.insert(0, {
            "id": entry_id,
            "period_type": period_type,
            "year": year,
            "period": period,
            "format": fmt,
            "orgs": org_filter,
            "filename": filename,
            "stored_filename": report_path.name,
            "size": len(file_bytes),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        # Keep only last 50 reports
        index = index[:50]
        with open(_REPORTS_INDEX, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
    except Exception:
        pass  # Non-fatal: don't break the download


@router.get("/data/report-history")
async def get_report_history():
    """List all previously generated periodic reports."""
    index = _load_report_index()
    return {"reports": index, "count": len(index)}


@router.get("/data/report-history/{report_id}")
async def download_report_history(report_id: str):
    """Re-download a previously generated periodic report by ID."""
    index = _load_report_index()
    entry = next((r for r in index if r["id"] == report_id), None)
    if not entry:
        return {"error": "Report not found"}
    report_path = _REPORTS_DIR / entry["stored_filename"]
    if not report_path.exists():
        return {"error": "Report file no longer available"}

    fmt = entry.get("format", "html")
    media_map = {
        "html": "text/html; charset=utf-8",
        "csv": "text/csv; charset=utf-8",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    media_type = media_map.get(fmt, "application/octet-stream")
    file_bytes = report_path.read_bytes()
    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{entry["filename"]}"'},
    )


@router.delete("/data/report-history/{report_id}")
async def delete_report_history(report_id: str):
    """Delete a report from history."""
    index = _load_report_index()
    entry = next((r for r in index if r["id"] == report_id), None)
    if not entry:
        return {"error": "Report not found"}
    # Remove file
    report_path = _REPORTS_DIR / entry["stored_filename"]
    if report_path.exists():
        report_path.unlink()
    # Remove from index
    new_index = [r for r in index if r["id"] != report_id]
    with open(_REPORTS_INDEX, "w", encoding="utf-8") as f:
        json.dump(new_index, f, indent=2, ensure_ascii=False)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# USAGE MONITOR  —  token / model / user analytics
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/data/usage-monitor")
async def get_usage_monitor(
    request: Request,
    orgs: str = Query(default="", description="Comma-separated org slugs; empty = all"),
    group_id: int = Query(default=0),
    month: str = Query(default="", description="Billing cycle month, e.g. '2026-05'. Empty = current month."),
    start_date: str = Query(default="", description="Start date override."),
    end_date: str = Query(default="", description="End date override."),
):
    """Aggregate model/user usage analytics from cached usage data."""
    from collections import defaultdict

    scope_users = _get_scope_usernames(request, group_id or None)

    org_filter = {o.strip() for o in orgs.split(",") if o.strip()} if orgs else set()
    all_scopes = _get_all_scope_names()
    scopes = [s for s in all_scopes if not org_filter or s in org_filter] or all_scopes

    import calendar as _cal
    if start_date.strip() and end_date.strip():
        _cs = date.fromisoformat(start_date.strip())
        _ce = date.fromisoformat(end_date.strip())
    elif month.strip():
        try:
            parts = month.strip().split("-")
            m_year, m_month = int(parts[0]), int(parts[1])
            _cs = date(m_year, m_month, 1)
            _ce = date(m_year, m_month, _cal.monthrange(m_year, m_month)[1])
        except (ValueError, IndexError):
            _cs = date.today().replace(day=1)
            _ce = date.today()
    else:
        _cs = date.today().replace(day=1)
        _ce = date.today()
    if _ce > date.today():
        _ce = date.today()
    if _cs > _ce:
        _cs, _ce = _ce, _cs
    cycle_start_str = _cs.isoformat()
    cycle_end_str = _ce.isoformat()

    def _normalize_model(name: str) -> str:
        """Normalize model names that GitHub returns inconsistently.
        e.g. 'claude-4.6-sonnet' and 'claude-sonnet-4.6' are the same model.
        """
        # Canonical: claude-{version}-{variant} → claude-{variant}-{version}
        import re
        # claude-X.Y-variant  →  claude-variant-X.Y
        m = re.match(r"^(claude)-(\d+\.\d+)-(.+)$", name)
        if m:
            return f"{m.group(1)}-{m.group(3)}-{m.group(2)}"
        return name

    # ── aggregate usage (org-level) ───────────────────────────────────────────
    model_totals: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_added": 0,
    })
    model_feature: dict[tuple, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
    })
    model_lang: dict[tuple, dict] = defaultdict(lambda: {
        "code_gen": 0, "code_accept": 0, "loc_suggested": 0,
    })
    daily_model: dict[str, dict[str, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"interactions": 0, "code_gen": 0, "code_accept": 0})
    )
    # New aggregations (collected from per-user data in second loop)
    feature_totals: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_added": 0,
    })
    ide_totals: dict[str, dict] = defaultdict(lambda: {
        "interactions": 0, "code_gen": 0, "code_accept": 0,
        "loc_suggested": 0, "loc_added": 0,
    })
    lang_totals: dict[str, dict] = defaultdict(lambda: {
        "code_gen": 0, "code_accept": 0, "loc_suggested": 0,
    })
    user_flags: dict[str, dict] = {}
    user_ides: dict[str, set] = defaultdict(set)
    # Collect report period from record headers (report_start_day / report_end_day)
    report_period_starts: list[str] = []
    report_period_ends: list[str] = []
    pr_totals: dict = {k: 0 for k in [
        "total_reviewed", "total_created", "total_created_by_copilot",
        "total_reviewed_by_copilot", "total_merged", "total_suggestions",
        "total_applied_suggestions", "total_merged_created_by_copilot",
        "total_copilot_suggestions", "total_copilot_applied_suggestions",
        "total_merged_reviewed_by_copilot",
    ]}
    cli_totals: dict = {
        "session_count": 0, "request_count": 0,
        "output_tokens": 0, "prompt_tokens": 0, "prompt_count": 0,
    }

    if scope_users is not None:
        # When group scope is active, build model aggregates from per-user data
        for scope in scopes:
            uu = data_collector.load_daily_usage_users(scope, start_day=cycle_start_str, end_day=cycle_end_str)
            if not uu:
                continue
            uu_records = uu if isinstance(uu, list) else uu.get("records", [uu])
            for rec in uu_records:
                login = rec.get("user_login", "unknown")
                if login.lower() not in scope_users:
                    continue
                day = rec.get("day", "")
                # Collect report period from record headers
                rs = rec.get("report_start_day", "")
                re_ = rec.get("report_end_day", "")
                if rs: report_period_starts.append(rs)
                if re_: report_period_ends.append(re_)
                for mf in rec.get("totals_by_model_feature", []):
                    m = _normalize_model(mf.get("model", "unknown"))
                    model_totals[m]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                    model_totals[m]["code_gen"] += mf.get("code_generation_activity_count", 0)
                    model_totals[m]["code_accept"] += mf.get("code_acceptance_activity_count", 0)
                    model_totals[m]["loc_suggested"] += mf.get("loc_suggested_to_add_sum", 0)
                    model_totals[m]["loc_added"] += mf.get("loc_added_sum", 0)
                    feat = mf.get("feature", "unknown")
                    model_feature[(m, feat)]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                    model_feature[(m, feat)]["code_gen"] += mf.get("code_generation_activity_count", 0)
                    model_feature[(m, feat)]["code_accept"] += mf.get("code_acceptance_activity_count", 0)
                    if day:
                        daily_model[day][m]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                        daily_model[day][m]["code_gen"] += mf.get("code_generation_activity_count", 0)
                        daily_model[day][m]["code_accept"] += mf.get("code_acceptance_activity_count", 0)
                for lm in rec.get("totals_by_language_model", []):
                    lang = lm.get("language", "unknown")
                    m = _normalize_model(lm.get("model", "unknown"))
                    model_lang[(m, lang)]["code_gen"] += lm.get("code_generation_activity_count", 0)
                    model_lang[(m, lang)]["code_accept"] += lm.get("code_acceptance_activity_count", 0)
                    model_lang[(m, lang)]["loc_suggested"] += lm.get("loc_suggested_to_add_sum", 0)
    else:
        for scope in scopes:
            usage = data_collector.load_daily_usage(scope, start_day=cycle_start_str, end_day=cycle_end_str)
            if not usage:
                continue
            records = usage if isinstance(usage, list) else usage.get("records", [usage])
            for rec in records:
                rs = rec.get("report_start_day", "")
                re_ = rec.get("report_end_day", "")
                if rs: report_period_starts.append(rs)
                if re_: report_period_ends.append(re_)
                for day_rec in rec.get("day_totals", []):
                    day = day_rec.get("day", "")
                    for mf in day_rec.get("totals_by_model_feature", []):
                        m = _normalize_model(mf.get("model", "unknown"))
                        model_totals[m]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                        model_totals[m]["code_gen"] += mf.get("code_generation_activity_count", 0)
                        model_totals[m]["code_accept"] += mf.get("code_acceptance_activity_count", 0)
                        model_totals[m]["loc_suggested"] += mf.get("loc_suggested_to_add_sum", 0)
                        model_totals[m]["loc_added"] += mf.get("loc_added_sum", 0)
                        feat = mf.get("feature", "unknown")
                        model_feature[(m, feat)]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                        model_feature[(m, feat)]["code_gen"] += mf.get("code_generation_activity_count", 0)
                        model_feature[(m, feat)]["code_accept"] += mf.get("code_acceptance_activity_count", 0)
                        daily_model[day][m]["interactions"] += mf.get("user_initiated_interaction_count", 0)
                        daily_model[day][m]["code_gen"] += mf.get("code_generation_activity_count", 0)
                        daily_model[day][m]["code_accept"] += mf.get("code_acceptance_activity_count", 0)
                    for lm in day_rec.get("totals_by_language_model", []):
                        lang = lm.get("language", "unknown")
                        m = _normalize_model(lm.get("model", "unknown"))
                        model_lang[(m, lang)]["code_gen"] += lm.get("code_generation_activity_count", 0)
                        model_lang[(m, lang)]["code_accept"] += lm.get("code_acceptance_activity_count", 0)
                        model_lang[(m, lang)]["loc_suggested"] += lm.get("loc_suggested_to_add_sum", 0)

    # ── aggregate usage_users (per-user) ──────────────────────────────────────
    user_model: dict[str, dict[str, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"interactions": 0, "code_gen": 0, "code_accept": 0})
    )
    user_feature: dict[str, dict[str, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"interactions": 0, "code_gen": 0})
    )
    user_totals: dict[str, int] = defaultdict(int)

    for scope in scopes:
        uu = data_collector.load_daily_usage_users(scope, start_day=cycle_start_str, end_day=cycle_end_str)
        if not uu:
            continue
        records = uu if isinstance(uu, list) else uu.get("records", [uu])
        for rec in records:
            login = rec.get("user_login", "unknown")
            if scope_users is not None and login.lower() not in scope_users:
                continue
            # Collect report period dates from each record
            rs = rec.get("report_start_day", "")
            re_ = rec.get("report_end_day", "")
            if rs: report_period_starts.append(rs)
            if re_: report_period_ends.append(re_)
            for mf in rec.get("totals_by_model_feature", []):
                m = _normalize_model(mf.get("model", "unknown"))
                interactions = mf.get("user_initiated_interaction_count", 0)
                code_gen = mf.get("code_generation_activity_count", 0)
                code_accept = mf.get("code_acceptance_activity_count", 0)
                feat = mf.get("feature", "unknown")
                user_model[login][m]["interactions"] += interactions
                user_model[login][m]["code_gen"] += code_gen
                user_model[login][m]["code_accept"] += code_accept
                user_feature[login][feat]["interactions"] += interactions
                user_feature[login][feat]["code_gen"] += code_gen
                user_totals[login] += interactions + code_gen
            # ── new: feature / IDE / language totals from per-user records ──
            for f in rec.get("totals_by_feature", []):
                feat = f.get("feature", "unknown")
                feature_totals[feat]["interactions"] += int(f.get("user_initiated_interaction_count", 0) or 0)
                feature_totals[feat]["code_gen"] += int(f.get("code_generation_activity_count", 0) or 0)
                feature_totals[feat]["code_accept"] += int(f.get("code_acceptance_activity_count", 0) or 0)
                feature_totals[feat]["loc_suggested"] += int(f.get("loc_suggested_to_add_sum", 0) or 0)
                feature_totals[feat]["loc_added"] += int(f.get("loc_added_sum", 0) or 0)
            for ide_rec in rec.get("totals_by_ide", []):
                ide = ide_rec.get("ide", "unknown")
                ide_totals[ide]["interactions"] += int(ide_rec.get("user_initiated_interaction_count", 0) or 0)
                ide_totals[ide]["code_gen"] += int(ide_rec.get("code_generation_activity_count", 0) or 0)
                ide_totals[ide]["code_accept"] += int(ide_rec.get("code_acceptance_activity_count", 0) or 0)
                ide_totals[ide]["loc_suggested"] += int(ide_rec.get("loc_suggested_to_add_sum", 0) or 0)
                ide_totals[ide]["loc_added"] += int(ide_rec.get("loc_added_sum", 0) or 0)
                if int(ide_rec.get("user_initiated_interaction_count", 0) or 0) + int(ide_rec.get("code_generation_activity_count", 0) or 0) > 0:
                    user_ides[login].add(ide)
            for lf in rec.get("totals_by_language_feature", []):
                lang = lf.get("language", "unknown")
                lang_totals[lang]["code_gen"] += int(lf.get("code_generation_activity_count", 0) or 0)
                lang_totals[lang]["code_accept"] += int(lf.get("code_acceptance_activity_count", 0) or 0)
                lang_totals[lang]["loc_suggested"] += int(lf.get("loc_suggested_to_add_sum", 0) or 0)
            # ── user flags (OR across multiple days per user) ──
            if login not in user_flags:
                user_flags[login] = {
                    "used_agent": False, "used_chat": False,
                    "used_cli": False, "used_coding_agent": False, "used_cloud_agent": False,
                }
            user_flags[login]["used_agent"] = user_flags[login]["used_agent"] or bool(rec.get("used_agent"))
            user_flags[login]["used_chat"] = user_flags[login]["used_chat"] or bool(rec.get("used_chat"))
            user_flags[login]["used_cli"] = user_flags[login]["used_cli"] or bool(rec.get("used_cli"))
            user_flags[login]["used_coding_agent"] = user_flags[login]["used_coding_agent"] or bool(rec.get("used_copilot_coding_agent"))
            user_flags[login]["used_cloud_agent"] = user_flags[login]["used_cloud_agent"] or bool(rec.get("used_copilot_cloud_agent"))

    # ── collect PR + CLI from org-level data (always org-wide) ───────────────
    for scope in scopes:
        org_usage = data_collector.load_daily_usage(scope, start_day=cycle_start_str, end_day=cycle_end_str)
        if not org_usage:
            continue
        org_records = org_usage if isinstance(org_usage, list) else org_usage.get("records", [org_usage])
        for org_rec in org_records:
            for day_rec in org_rec.get("day_totals", []):
                pr = day_rec.get("pull_requests", {}) or {}
                for k in pr_totals:
                    pr_totals[k] += int(pr.get(k, 0) or 0)
                cli = day_rec.get("totals_by_cli", {}) or {}
                cli_totals["session_count"] += int(cli.get("session_count", 0) or 0)
                cli_totals["request_count"] += int(cli.get("request_count", 0) or 0)
                cli_totals["prompt_count"] += int(cli.get("prompt_count", 0) or 0)
                tok = cli.get("token_usage", {}) or {}
                cli_totals["output_tokens"] += int(tok.get("output_tokens_sum", 0) or 0)
                cli_totals["prompt_tokens"] += int(tok.get("prompt_tokens_sum", 0) or 0)

    # ── serialise ─────────────────────────────────────────────────────────────
    model_totals_list = sorted(
        [{"model": m, **v} for m, v in model_totals.items() if v["interactions"] + v["code_gen"] > 0],
        key=lambda x: -(x["interactions"] + x["code_gen"]),
    )

    model_feature_list = sorted(
        [{"model": m, "feature": f, **v} for (m, f), v in model_feature.items()],
        key=lambda x: -(x["interactions"] + x["code_gen"]),
    )

    model_lang_list = sorted(
        [{"model": m, "language": l, **v} for (m, l), v in model_lang.items()],
        key=lambda x: -x["code_gen"],
    )

    feature_totals_list = sorted(
        [{"feature": f, **v} for f, v in feature_totals.items() if v["interactions"] + v["code_gen"] > 0],
        key=lambda x: -(x["interactions"] + x["code_gen"]),
    )

    ide_totals_list = sorted(
        [{"ide": ide, **v} for ide, v in ide_totals.items() if v["interactions"] + v["code_gen"] > 0],
        key=lambda x: -(x["interactions"] + x["code_gen"]),
    )

    lang_totals_list = sorted(
        [{"language": l, **v} for l, v in lang_totals.items() if v["code_gen"] > 0],
        key=lambda x: -x["code_gen"],
    )[:20]

    user_flags_list = [
        {"user": login, **flags, "ides": sorted(user_ides.get(login, set()))}
        for login, flags in sorted(user_flags.items())
    ]

    # daily trend: [{day, models: [{model, interactions, code_gen}]}]
    daily_trend = []
    for day in sorted(daily_model.keys()):
        entry: dict = {"day": day}
        for m, vals in daily_model[day].items():
            safe_key = m.replace("-", "_").replace(".", "_")
            entry[safe_key] = vals["interactions"] + vals["code_gen"]
            entry[f"{safe_key}_interact"] = vals["interactions"]
            entry[f"{safe_key}_codegen"] = vals["code_gen"]
        daily_trend.append(entry)

    # get all unique model names (used as chart series keys) — only models with actual activity
    all_models = sorted(m for m, v in model_totals.items() if v["interactions"] + v["code_gen"] > 0)

    # date range for period label — use billing cycle dates
    report_start = cycle_start_str
    report_end = cycle_end_str

    # per-user model breakdown
    user_model_list = []
    for login in sorted(user_totals.keys(), key=lambda u: -user_totals[u]):
        row: dict = {"user": login, "total": user_totals[login]}
        for m, vals in user_model[login].items():
            row[m] = vals["interactions"] + vals["code_gen"]
        user_model_list.append(row)

    # per-user feature breakdown
    user_feature_list = []
    for login, feats in user_feature.items():
        for feat, vals in feats.items():
            user_feature_list.append({
                "user": login,
                "feature": feat,
                "interactions": vals["interactions"],
                "code_gen": vals["code_gen"],
                "total": vals["interactions"] + vals["code_gen"],
            })
    user_feature_list.sort(key=lambda x: (-x["total"], x["user"]))

    # KPIs
    total_interactions = sum(v["interactions"] for v in model_totals.values())
    total_code_gen = sum(v["code_gen"] for v in model_totals.values())
    top_model = model_totals_list[0]["model"] if model_totals_list else "—"
    unique_models = len(model_totals_list)
    active_users = len(user_model)
    total_loc_suggested = sum(v["loc_suggested"] for v in feature_totals.values())
    total_loc_added = sum(v["loc_added"] for v in feature_totals.values())
    loc_acceptance_rate = round(total_loc_added / total_loc_suggested * 100, 1) if total_loc_suggested > 0 else 0.0
    top_feature = feature_totals_list[0]["feature"] if feature_totals_list else "—"
    top_ide = ide_totals_list[0]["ide"] if ide_totals_list else "—"

    return {
        "kpi": {
            "total_interactions": total_interactions,
            "total_code_gen": total_code_gen,
            "unique_models": unique_models,
            "top_model": top_model,
            "active_users": active_users,
            "report_start": report_start,
            "report_end": report_end,
            "loc_suggested": total_loc_suggested,
            "loc_added": total_loc_added,
            "loc_acceptance_rate": loc_acceptance_rate,
            "top_feature": top_feature,
            "top_ide": top_ide,
            "users_with_agent": sum(1 for f in user_flags.values() if f["used_agent"]),
            "users_with_cli": sum(1 for f in user_flags.values() if f["used_cli"]),
            "users_with_coding_agent": sum(1 for f in user_flags.values() if f["used_coding_agent"]),
        },
        "model_totals": model_totals_list,
        "model_feature": model_feature_list,
        "model_language": model_lang_list,
        "daily_trend": daily_trend,
        "all_models": all_models,
        "user_model": user_model_list,
        "user_feature": user_feature_list,
        "feature_totals": feature_totals_list,
        "ide_totals": ide_totals_list,
        "lang_totals": lang_totals_list,
        "pr_totals": pr_totals,
        "cli_totals": cli_totals,
        "user_flags": user_flags_list,
    }


def _get_selected_scope_names(orgs: str) -> list[str]:
    """Resolve selected org/enterprise names from a comma-separated query param."""
    all_scope_names = _get_all_scope_names()
    if not orgs.strip():
        return all_scope_names
    return list(dict.fromkeys(o.strip() for o in orgs.split(",") if o.strip())) or all_scope_names


def _get_usage_user_records(org: str, start_day: str | None = None, end_day: str | None = None) -> list[dict]:
    """Return normalized usage_users records for an org, optionally filtered by date range."""
    if start_day or end_day:
        uu = data_collector.load_daily_usage_users(org, start_day=start_day, end_day=end_day)
    else:
        uu = data_collector.load_latest("usage_users", org)
    if not uu:
        return []
    if isinstance(uu, list):
        return [rec for rec in uu if isinstance(rec, dict)]
    records = uu.get("records", []) if isinstance(uu, dict) else []
    return [rec for rec in records if isinstance(rec, dict)]


def _get_usage_records(org: str) -> list[dict]:
    """Return normalized usage records for an org."""
    usage = data_collector.load_latest("usage", org)
    if not usage:
        return []
    if isinstance(usage, list):
        return [rec for rec in usage if isinstance(rec, dict)]
    records = usage.get("records", [usage]) if isinstance(usage, dict) else []
    return [rec for rec in records if isinstance(rec, dict)]


def _loc_suggested_sum(item: dict) -> int:
    return int(item.get("loc_suggested_to_add_sum", 0) or 0) + int(item.get("loc_suggested_to_delete_sum", 0) or 0)


def _loc_accepted_sum(item: dict) -> int:
    return int(item.get("loc_added_sum", 0) or 0) + int(item.get("loc_deleted_sum", 0) or 0)


def _parse_utc_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError):
        return None


@router.get("/data/user-timeline")
async def get_user_timeline(
    request: Request,
    username: str = Query(default="", description="GitHub username"),
    orgs: str = Query(default="", description="Comma-separated org/enterprise slugs; empty = all"),
    group_id: int = Query(default=0),
):
    """Return per-day user activity drilldown across selected orgs."""
    empty_response = {
        "username": username,
        "has_data": False,
        "kpi": {
            "total_interactions": 0,
            "total_code_gen": 0,
            "total_code_accept": 0,
            "acceptance_rate": 0.0,
            "active_days": 0,
        },
        "timeline": [],
        "features": [],
        "models": [],
        "ides": [],
    }
    try:
        username_lower = username.strip().lower()
        if not username_lower:
            return {**empty_response, "error": "Username is required"}

        scope_users = _get_scope_usernames(request, group_id or None)
        if scope_users is not None and username_lower not in scope_users:
            return {**empty_response, "error": "User not in scope"}

        days: dict[str, dict] = {}
        features: dict[str, dict] = defaultdict(lambda: {"interactions": 0, "code_gen": 0, "code_accept": 0})
        models: dict[str, dict] = defaultdict(lambda: {"interactions": 0, "code_gen": 0})
        ides: dict[str, dict] = defaultdict(lambda: {"interactions": 0, "code_gen": 0})
        total_interactions = 0
        total_code_gen = 0
        total_code_accept = 0
        found = False

        for org_name in _get_selected_scope_names(orgs):
            for rec in _get_usage_user_records(org_name):
                login = (rec.get("user_login", "") or "").lower()
                if login != username_lower:
                    continue
                found = True
                day = rec.get("day", "")
                if day:
                    if day not in days:
                        days[day] = {
                            "day": day,
                            "interactions": 0,
                            "code_gen": 0,
                            "code_accept": 0,
                            "loc_suggested": 0,
                            "loc_accepted": 0,
                        }
                    days[day]["interactions"] += int(rec.get("user_initiated_interaction_count", 0) or 0)
                    days[day]["code_gen"] += int(rec.get("code_generation_activity_count", 0) or 0)
                    days[day]["code_accept"] += int(rec.get("code_acceptance_activity_count", 0) or 0)
                    days[day]["loc_suggested"] += _loc_suggested_sum(rec)
                    days[day]["loc_accepted"] += _loc_accepted_sum(rec)

                total_interactions += int(rec.get("user_initiated_interaction_count", 0) or 0)
                total_code_gen += int(rec.get("code_generation_activity_count", 0) or 0)
                total_code_accept += int(rec.get("code_acceptance_activity_count", 0) or 0)

                for item in rec.get("totals_by_feature", []):
                    feature = item.get("feature", "unknown")
                    features[feature]["interactions"] += int(item.get("user_initiated_interaction_count", 0) or 0)
                    features[feature]["code_gen"] += int(item.get("code_generation_activity_count", 0) or 0)
                    features[feature]["code_accept"] += int(item.get("code_acceptance_activity_count", 0) or 0)

                for item in rec.get("totals_by_model_feature", []):
                    model = item.get("model", "unknown")
                    models[model]["interactions"] += int(item.get("user_initiated_interaction_count", 0) or 0)
                    models[model]["code_gen"] += int(item.get("code_generation_activity_count", 0) or 0)

                for item in rec.get("totals_by_ide", []):
                    ide = item.get("ide", "unknown")
                    ides[ide]["interactions"] += int(item.get("user_initiated_interaction_count", 0) or 0)
                    ides[ide]["code_gen"] += int(item.get("code_generation_activity_count", 0) or 0)

        if not found:
            return empty_response

        acceptance_rate = round(total_code_accept / total_code_gen * 100, 1) if total_code_gen > 0 else 0.0
        return {
            "username": username,
            "has_data": True,
            "kpi": {
                "total_interactions": total_interactions,
                "total_code_gen": total_code_gen,
                "total_code_accept": total_code_accept,
                "acceptance_rate": acceptance_rate,
                "active_days": len(days),
            },
            "timeline": [days[day] for day in sorted(days)],
            "features": sorted(
                [{"feature": feature, **values} for feature, values in features.items()],
                key=lambda item: -(item["interactions"] + item["code_gen"]),
            ),
            "models": sorted(
                [{"model": model, **values} for model, values in models.items()],
                key=lambda item: -(item["interactions"] + item["code_gen"]),
            ),
            "ides": sorted(
                [{"ide": ide, **values} for ide, values in ides.items()],
                key=lambda item: -(item["interactions"] + item["code_gen"]),
            ),
        }
    except Exception:
        return empty_response


@router.get("/data/roi")
async def get_roi_dashboard(
    request: Request,
    orgs: str = Query(default="", description="Comma-separated org/enterprise slugs; empty = all"),
    group_id: int = Query(default=0),
    month: str = Query(default="", description="Billing cycle month, e.g. '2026-05'. Empty = current month."),
    start_date: str = Query(default="", description="Start date override."),
    end_date: str = Query(default="", description="End date override."),
):
    """Return ROI and acceptance-rate dashboard metrics."""
    empty_response = {
        "kpi": {
            "acceptance_rate": 0.0,
            "cost_per_active_user": 0.0,
            "active_users": 0,
            "total_seats": 0,
            "monthly_cost": 0.0,
            "total_code_gen": 0,
            "total_code_accept": 0,
            "total_loc_suggested": 0,
            "total_loc_accepted": 0,
            "loc_acceptance_rate": 0.0,
        },
        "daily_trend": [],
        "top_users_by_acceptance": [],
    }
    try:
        scope_users = _get_scope_usernames(request, group_id or None)
        selected = _get_selected_scope_names(orgs)

        import calendar
        if start_date.strip() and end_date.strip():
            _cs = date.fromisoformat(start_date.strip())
            _ce = date.fromisoformat(end_date.strip())
        elif month.strip():
            try:
                parts = month.strip().split("-")
                m_year, m_month = int(parts[0]), int(parts[1])
                _cs = date(m_year, m_month, 1)
                _ce = date(m_year, m_month, calendar.monthrange(m_year, m_month)[1])
            except (ValueError, IndexError):
                _cs = date.today().replace(day=1)
                _ce = date.today()
        else:
            _cs = date.today().replace(day=1)
            _ce = date.today()
        if _ce > date.today():
            _ce = date.today()
        if _cs > _ce:
            _cs, _ce = _ce, _cs
        cycle_start_str = _cs.isoformat()
        cycle_end_str = _ce.isoformat()

        daily_agg: dict[str, dict] = {}
        user_agg: dict[str, dict] = defaultdict(lambda: {
            "interactions": 0,
            "code_gen": 0,
            "code_accept": 0,
        })
        total_code_gen = 0
        total_code_accept = 0
        total_loc_suggested = 0
        total_loc_accepted = 0

        for org_name in selected:
            for rec in _get_usage_user_records(org_name, start_day=cycle_start_str, end_day=cycle_end_str):
                login = (rec.get("user_login", "") or "").lower()
                if not login or (scope_users is not None and login not in scope_users):
                    continue

                interactions = int(rec.get("user_initiated_interaction_count", 0) or 0)
                code_gen = int(rec.get("code_generation_activity_count", 0) or 0)
                code_accept = int(rec.get("code_acceptance_activity_count", 0) or 0)
                loc_suggested = _loc_suggested_sum(rec)
                loc_accepted = _loc_accepted_sum(rec)
                day = rec.get("day", "")

                total_code_gen += code_gen
                total_code_accept += code_accept
                total_loc_suggested += loc_suggested
                total_loc_accepted += loc_accepted

                user_agg[login]["interactions"] += interactions
                user_agg[login]["code_gen"] += code_gen
                user_agg[login]["code_accept"] += code_accept

                if day:
                    if day not in daily_agg:
                        daily_agg[day] = {
                            "day": day,
                            "interactions": 0,
                            "code_gen": 0,
                            "code_accept": 0,
                            "active_users": set(),
                        }
                    daily_agg[day]["interactions"] += interactions
                    daily_agg[day]["code_gen"] += code_gen
                    daily_agg[day]["code_accept"] += code_accept
                    daily_agg[day]["active_users"].add(login)

        total_seats = 0
        monthly_cost = 0.0
        for org_name in selected:
            billing = data_collector.load_latest("billing", org_name)
            seats_data = data_collector.load_latest("seats", org_name)
            if not billing and not seats_data:
                continue
            if scope_users is not None:
                seen_logins: set = set()
                for seat in (seats_data or {}).get("seats", []):
                    login = ((seat.get("assignee") or {}).get("login", "") or "").lower()
                    if login and login in scope_users:
                        seen_logins.add(login)
                seat_count = len(seen_logins)
                # Use flat price for scoped view
                price = float((billing or {}).get("_detected_price_per_seat", 39.0) or 39.0)
                monthly_cost += seat_count * price
            elif billing and billing.get("_plan_counts"):
                # Use per-plan pricing from real billing data
                plan_counts = billing["_plan_counts"]
                for plan, count in plan_counts.items():
                    plan_price = COPILOT_PRICING.get(plan, COPILOT_PRICING["enterprise"])
                    monthly_cost += count * plan_price
                seat_count = int((billing.get("seat_breakdown", {}) or {}).get("total", sum(plan_counts.values())))
            elif billing and not billing.get("_billing_scope_error"):
                seat_count = int((billing.get("seat_breakdown", {}) or {}).get("total", 0) or 0)
                price = float((billing or {}).get("_detected_price_per_seat", 39.0) or 39.0)
                monthly_cost += seat_count * price
            else:
                seat_count = int((seats_data or {}).get("total_seats", len((seats_data or {}).get("seats", []))) or 0)
                monthly_cost += seat_count * 39.0
            total_seats += seat_count

        active_users = len(user_agg)
        acceptance_rate = round(total_code_accept / total_code_gen * 100, 1) if total_code_gen > 0 else 0.0
        # Cap LOC acceptance at 100%: loc_added/deleted can exceed loc_suggested due to
        # how the metrics API counts edits vs. raw suggestion content.
        loc_acceptance_rate = min(round(total_loc_accepted / total_loc_suggested * 100, 1), 100.0) if total_loc_suggested > 0 else 0.0
        daily_trend = []
        for day in sorted(daily_agg):
            row = daily_agg[day]
            daily_trend.append({
                "day": day,
                "code_gen": row["code_gen"],
                "code_accept": row["code_accept"],
                "acceptance_rate": round(row["code_accept"] / row["code_gen"] * 100, 1) if row["code_gen"] > 0 else 0.0,
                "interactions": row["interactions"],
                "active_users": len(row["active_users"]),
            })

        top_users = []
        for user, values in user_agg.items():
            code_gen = values["code_gen"]
            if code_gen < 10:
                continue
            top_users.append({
                "user": user,
                "acceptance_rate": round(values["code_accept"] / code_gen * 100, 1) if code_gen > 0 else 0.0,
                "code_gen": code_gen,
                "code_accept": values["code_accept"],
                "interactions": values["interactions"],
            })
        top_users.sort(key=lambda item: (-item["acceptance_rate"], -item["code_gen"], item["user"]))

        return {
            "kpi": {
                "acceptance_rate": acceptance_rate,
                "cost_per_active_user": round(monthly_cost / active_users, 2) if active_users > 0 else 0.0,
                "active_users": active_users,
                "total_seats": total_seats,
                "monthly_cost": round(monthly_cost, 2),
                "total_code_gen": total_code_gen,
                "total_code_accept": total_code_accept,
                "total_loc_suggested": total_loc_suggested,
                "total_loc_accepted": total_loc_accepted,
                "loc_acceptance_rate": loc_acceptance_rate,
            },
            "daily_trend": daily_trend,
            "top_users_by_acceptance": top_users[:20],
        }
    except Exception:
        return empty_response


@router.get("/data/lifecycle-scan")
async def get_lifecycle_scan(
    request: Request,
    threshold_days: int = Query(default=30, ge=0),
    group_id: int = Query(default=0),
):
    """Return inactive-seat candidates across all synced organizations."""
    empty_response = {
        "threshold_days": threshold_days,
        "inactive_count": 0,
        "monthly_waste": 0.0,
        "users": [],
    }
    try:
        scope_users = _get_scope_usernames(request, group_id or None)
        now = datetime.now(timezone.utc)
        users = []
        monthly_waste = 0.0

        for org_name in _get_all_scope_names():
            seats_data = data_collector.load_latest("seats", org_name)
            if not seats_data:
                continue
            billing = data_collector.load_latest("billing", org_name)
            monthly_cost = float((billing or {}).get("_detected_price_per_seat", 39.0) or 39.0)

            for seat in seats_data.get("seats", []):
                assignee = seat.get("assignee") or {}
                login = (assignee.get("login", "") or "").lower()
                if not login:
                    continue
                if scope_users is not None and login not in scope_users:
                    continue

                last_activity_at = seat.get("last_activity_at")
                last_activity_dt = _parse_utc_datetime(last_activity_at)
                if last_activity_dt is None:
                    days_inactive = threshold_days
                    include_user = True
                else:
                    days_inactive = max((now - last_activity_dt).days, 0)
                    include_user = days_inactive >= threshold_days

                if not include_user:
                    continue

                users.append({
                    "user": assignee.get("login", ""),
                    "org": org_name,
                    "last_activity_at": last_activity_at,
                    "days_inactive": days_inactive,
                    "monthly_cost": round(monthly_cost, 2),
                })
                monthly_waste += monthly_cost

        users.sort(key=lambda item: item["days_inactive"], reverse=True)
        return {
            "threshold_days": threshold_days,
            "inactive_count": len(users),
            "monthly_waste": round(monthly_waste, 2),
            "users": users,
        }
    except Exception:
        return empty_response


@router.post("/data/lifecycle-recommend")
async def create_lifecycle_recommendations(payload: dict):
    """Create pending seat-removal recommendations for inactive users."""
    try:
        db = db_module.db
        items = payload.get("users", []) if isinstance(payload, dict) else []
        if db is None or not isinstance(items, list):
            return {"created": 0}

        created = 0
        ts_base = int(datetime.now(timezone.utc).timestamp())
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            user = str(item.get("user", "") or "").strip()
            org = str(item.get("org", "") or "").strip()
            if not user or not org:
                continue
            days_inactive = int(item.get("days_inactive", 0) or 0)
            monthly_cost = float(item.get("monthly_cost", 0) or 0.0)
            rec = {
                "id": f"lifecycle-{user}-{ts_base + index}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "org": org,
                "type": "remove_seats",
                "affected_users": [user],
                "description": f"Inactive {days_inactive} days — remove to save ${monthly_cost:.2f}/mo",
                "estimated_monthly_savings": monthly_cost,
                "status": "pending",
            }
            db.save_recommendation(rec)
            created += 1

        return {"created": created}
    except Exception:
        return {"created": 0}


@router.get("/data/kpi-trend")
async def get_kpi_trend(
    request: Request,
    orgs: str = Query(default="", description="Comma-separated org/enterprise slugs; empty = all"),
    group_id: int = Query(default=0),
):
    """Return week-over-week KPI deltas from the most recent daily usage data."""
    empty_period = {
        "avg_dau": 0.0,
        "total_interactions": 0,
        "total_code_gen": 0,
        "acceptance_rate": 0.0,
    }
    empty_response = {
        "has_data": False,
        "period_days": 7,
        "current": dict(empty_period),
        "previous": dict(empty_period),
        "deltas": {
            "dau_pct": 0.0,
            "interactions_pct": 0.0,
            "code_gen_pct": 0.0,
            "acceptance_rate_pt": 0.0,
        },
    }
    try:
        scope_users = _get_scope_usernames(request, group_id or None)
        daily_map: dict[str, dict] = {}

        if scope_users is not None:
            for org_name in _get_selected_scope_names(orgs):
                for rec in _get_usage_user_records(org_name):
                    login = (rec.get("user_login", "") or "").lower()
                    if not login or login not in scope_users:
                        continue
                    day = rec.get("day", "")
                    if not day:
                        continue
                    if day not in daily_map:
                        daily_map[day] = {
                            "day": day,
                            "interactions": 0,
                            "code_gen": 0,
                            "code_accept": 0,
                            "active_users": set(),
                        }
                    daily_map[day]["interactions"] += int(rec.get("user_initiated_interaction_count", 0) or 0)
                    daily_map[day]["code_gen"] += int(rec.get("code_generation_activity_count", 0) or 0)
                    daily_map[day]["code_accept"] += int(rec.get("code_acceptance_activity_count", 0) or 0)
                    daily_map[day]["active_users"].add(login)
        else:
            for org_name in _get_selected_scope_names(orgs):
                for rec in _get_usage_records(org_name):
                    for day_total in rec.get("day_totals", []):
                        day = day_total.get("day", "")
                        if not day:
                            continue
                        if day not in daily_map:
                            daily_map[day] = {
                                "day": day,
                                "dau": 0,
                                "interactions": 0,
                                "code_gen": 0,
                                "code_accept": 0,
                            }
                        daily_map[day]["dau"] += int(day_total.get("daily_active_users", 0) or 0)
                        daily_map[day]["interactions"] += int(day_total.get("user_initiated_interaction_count", 0) or 0)
                        daily_map[day]["code_gen"] += int(day_total.get("code_generation_activity_count", 0) or 0)
                        daily_map[day]["code_accept"] += int(day_total.get("code_acceptance_activity_count", 0) or 0)

        if not daily_map:
            return empty_response

        ordered_days = [daily_map[day] for day in sorted(daily_map)][-14:]
        previous_days = ordered_days[:-7]
        current_days = ordered_days[-7:]

        def _summarize_period(period_rows: list[dict]) -> dict:
            if not period_rows:
                return dict(empty_period)
            total_interactions = sum(int(row.get("interactions", 0) or 0) for row in period_rows)
            total_code_gen = sum(int(row.get("code_gen", 0) or 0) for row in period_rows)
            total_code_accept = sum(int(row.get("code_accept", 0) or 0) for row in period_rows)
            if scope_users is not None:
                dau_values = [len(row.get("active_users", set())) for row in period_rows]
            else:
                dau_values = [int(row.get("dau", 0) or 0) for row in period_rows]
            return {
                "avg_dau": round(sum(dau_values) / len(dau_values), 1) if dau_values else 0.0,
                "total_interactions": total_interactions,
                "total_code_gen": total_code_gen,
                "acceptance_rate": round(total_code_accept / total_code_gen * 100, 1) if total_code_gen > 0 else 0.0,
            }

        current = _summarize_period(current_days)
        previous = _summarize_period(previous_days)

        def _pct_delta(current_value: float, previous_value: float) -> float:
            if previous_value == 0:
                return 0.0
            return round((current_value - previous_value) / previous_value * 100, 1)

        return {
            "has_data": True,
            "period_days": 7,
            "current": current,
            "previous": previous,
            "deltas": {
                "dau_pct": _pct_delta(current["avg_dau"], previous["avg_dau"]),
                "interactions_pct": _pct_delta(current["total_interactions"], previous["total_interactions"]),
                "code_gen_pct": _pct_delta(current["total_code_gen"], previous["total_code_gen"]),
                "acceptance_rate_pt": round(current["acceptance_rate"] - previous["acceptance_rate"], 1),
            },
        }
    except Exception:
        return empty_response
