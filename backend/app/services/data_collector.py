"""
Data collector service - fetches data from GitHub API and stores to SQLite (primary)
with JSON file fallback for session-scoped collectors.
Supports per-session data directories with fallback to global directory.
Uses APIManager to route API calls to the correct PAT.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from ..config import config

if TYPE_CHECKING:
    from .api_manager import APIManager
    from .database import Database
    from .github_api import GitHubAPI

# Type alias for the optional log callback: log_fn(level, message)
LogFn = Callable[[str, str], None] | None


class DataCollector:
    """Collects Copilot data from GitHub API and stores it.

    When a Database instance is provided, data is stored in SQLite.
    Otherwise (e.g. session-scoped collectors) data is stored as JSON files.

    Args:
        data_dir: Primary directory for reading/writing JSON data (fallback/sessions).
        fallback_dir: Optional fallback directory for reads when primary has no data.
        api_manager: Optional APIManager for routing API calls per org.
        db: Optional Database instance; if set, SQLite is used instead of JSON files.
    """

    def __init__(
        self,
        data_dir: Path | None = None,
        fallback_dir: Path | None = None,
        api_manager: APIManager | None = None,
        db: "Database | None" = None,
    ):
        self._data_dir = data_dir or config.data_dir
        self._fallback_dir = fallback_dir
        self._api_manager = api_manager
        self._db = db

    @property
    def data_dir(self) -> Path:
        return self._data_dir

    def set_api_manager(self, api_manager: APIManager):
        """Set the API manager (useful for deferred initialization)."""
        self._api_manager = api_manager

    def set_db(self, db: "Database"):
        """Set the database instance (used by global collector after DB init)."""
        self._db = db

    def _get_api_for_org(self, org: str) -> GitHubAPI | None:
        """Get the GitHubAPI instance for an org via api_manager."""
        if self._api_manager:
            return self._api_manager.get_api_for_org(org)
        return None

    def _save_json(self, category: str, org: str, data: dict | list) -> Path:
        """Persist data: uses SQLite when DB is available, otherwise JSON files.
        For 'usage' and 'usage_users', data is broken into per-day rows (UPSERT).
        All other categories are stored as a single snapshot blob.
        """
        if self._db is not None:
            if category == "usage":
                self._save_usage_daily(org, data)
            elif category == "usage_users":
                self._save_usage_users_daily(org, data)
            else:
                self._db.save_snapshot(category, org, data)
            return self._data_dir / category / f"{org}_latest.json"

        # JSON file fallback (session-scoped collectors)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filepath = self._data_dir / category / f"{org}_{ts}.json"
        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")

        # Also save a "latest" copy for easy access
        latest = self._data_dir / category / f"{org}_latest.json"
        latest.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
        return filepath

    def _save_usage_daily(self, org: str, usage_report: dict):
        """Break org-level usage report into per-day rows and upsert each."""
        records = usage_report.get("records", [])
        for record in records:
            day_totals = record.get("day_totals", [])
            meta = {k: v for k, v in record.items() if k != "day_totals"}
            for day_total in day_totals:
                day = day_total.get("day")
                if day:
                    self._db.save_daily("usage", org, day, {**meta, **day_total})

    def _save_usage_users_daily(self, org: str, users_report: dict):
        """Group user-level usage records by day and upsert each day's batch."""
        records = users_report.get("records", [])
        by_day: dict[str, list] = {}
        for rec in records:
            day = rec.get("day")
            if day:
                by_day.setdefault(day, []).append(rec)
        for day, day_records in by_day.items():
            self._db.save_daily("usage_users", org, day, day_records)

    @staticmethod
    def _reconstruct_usage_from_daily(rows: list[dict]) -> dict | None:
        """Reconstruct the original usage report format from per-day rows."""
        if not rows:
            return None
        day_totals = [r["data"] for r in rows]
        start_day = rows[0]["day"]
        end_day = rows[-1]["day"]
        return {
            "records": [{
                "report_start_day": start_day,
                "report_end_day": end_day,
                "day_totals": day_totals,
            }],
            "total_records": len(day_totals),
            "report_start_day": start_day,
            "report_end_day": end_day,
            "download_links_count": 0,
        }

    @staticmethod
    def _reconstruct_usage_users_from_daily(rows: list[dict]) -> dict | None:
        """Reconstruct the original usage_users report format from per-day rows."""
        if not rows:
            return None
        all_records: list = []
        for r in rows:
            all_records.extend(r["data"])
        return {
            "records": all_records,
            "total_records": len(all_records),
            "report_start_day": rows[0]["day"],
            "report_end_day": rows[-1]["day"],
            "download_links_count": 0,
        }

    def load_latest(self, category: str, org: str) -> dict | list | None:
        """Load the latest data. Checks DB first, then primary JSON dir, then fallback."""
        if self._db is not None:
            if category == "usage" and self._db.has_daily_data("usage", org):
                rows = self._db.load_daily("usage", org)
                return self._reconstruct_usage_from_daily(rows)
            if category == "usage_users" and self._db.has_daily_data("usage_users", org):
                rows = self._db.load_daily("usage_users", org)
                return self._reconstruct_usage_users_from_daily(rows)
            result = self._db.load_latest_snapshot(category, org)
            if result is not None:
                return result

    def load_daily_usage(self, org: str, start_day: str | None = None, end_day: str | None = None) -> dict | None:
        """Load usage data filtered by date range. Used for billing cycle queries."""
        if self._db is not None and self._db.has_daily_data("usage", org):
            rows = self._db.load_daily("usage", org, start_day=start_day, end_day=end_day)
            return self._reconstruct_usage_from_daily(rows)
        data = self.load_latest("usage", org)
        if data and start_day:
            records = data.get("records", [])
            for rec in records:
                day_totals = rec.get("day_totals", [])
                rec["day_totals"] = [dt for dt in day_totals
                                     if (not start_day or dt.get("day", "") >= start_day)
                                     and (not end_day or dt.get("day", "") <= end_day)]
        return data

    def load_daily_usage_users(self, org: str, start_day: str | None = None, end_day: str | None = None) -> dict | None:
        """Load usage_users data filtered by date range."""
        if self._db is not None and self._db.has_daily_data("usage_users", org):
            rows = self._db.load_daily("usage_users", org, start_day=start_day, end_day=end_day)
            return self._reconstruct_usage_users_from_daily(rows)
        return self.load_latest("usage_users", org)

        # JSON file path (session fallback or when DB not yet ready)
        filepath = self._data_dir / category / f"{org}_latest.json"
        if filepath.exists():
            return json.loads(filepath.read_text(encoding="utf-8"))

        # Try fallback directory
        if self._fallback_dir:
            fallback_path = self._fallback_dir / category / f"{org}_latest.json"
            if fallback_path.exists():
                return json.loads(fallback_path.read_text(encoding="utf-8"))

        return None

    def load_all_latest(self, category: str) -> dict[str, dict | list]:
        """Load latest data for all orgs. Uses DB when available, fills from JSON fallback."""
        if self._db is not None:
            if category in ("usage", "usage_users"):
                orgs = self._db.load_all_daily_orgs(category)
                result: dict[str, dict | list] = {}
                for org in orgs:
                    rows = self._db.load_daily(category, org)
                    if category == "usage":
                        rec = self._reconstruct_usage_from_daily(rows)
                    else:
                        rec = self._reconstruct_usage_users_from_daily(rows)
                    if rec:
                        result[org] = rec
                category_dir = self._data_dir / category
                if category_dir.exists():
                    for f in category_dir.glob("*_latest.json"):
                        org_name = f.name.replace("_latest.json", "")
                        if org_name not in result:
                            result[org_name] = json.loads(f.read_text(encoding="utf-8"))
                return result

            result = self._db.load_all_latest_snapshots(category)
            category_dir = self._data_dir / category
            if category_dir.exists():
                for f in category_dir.glob("*_latest.json"):
                    org_name = f.name.replace("_latest.json", "")
                    if org_name not in result:
                        result[org_name] = json.loads(f.read_text(encoding="utf-8"))
            return result

        result = {}
        category_dir = self._data_dir / category
        if category_dir.exists():
            for f in category_dir.glob("*_latest.json"):
                org_name = f.name.replace("_latest.json", "")
                result[org_name] = json.loads(f.read_text(encoding="utf-8"))

        if self._fallback_dir:
            fallback_dir = self._fallback_dir / category
            if fallback_dir.exists():
                for f in fallback_dir.glob("*_latest.json"):
                    org_name = f.name.replace("_latest.json", "")
                    if org_name not in result:
                        result[org_name] = json.loads(f.read_text(encoding="utf-8"))

        return result

    def load_daily(
        self, category: str, org: str,
        start_day: str | None = None, end_day: str | None = None,
    ) -> list[dict] | None:
        """Load per-day rows for usage/usage_users with optional date range filter.
        Returns list of {"day": ..., "data": ...} or None if DB not available."""
        if self._db is None:
            return None
        return self._db.load_daily(category, org, start_day=start_day, end_day=end_day)



    async def sync_org(self, org: str, log_fn: LogFn = None) -> dict:
        """Sync all Copilot data for a single org. Returns summary."""
        summary: dict = {"org": org, "synced": [], "errors": []}

        if log_fn:
            log_fn("info", f"Syncing {org}...")

        api = self._get_api_for_org(org)
        if api is None:
            msg = f"No API client available for {org}"
            summary["errors"].append(msg)
            if log_fn:
                log_fn("error", f"  {org}: {msg}")
            return summary

        # Billing
        try:
            billing = await api.get_copilot_billing(org)
            if billing:
                self._save_json("billing", org, billing)
                summary["synced"].append("billing")
                if log_fn:
                    log_fn("info", f"  {org}: billing synced")
        except Exception as e:
            summary["errors"].append(f"billing: {e}")
            if log_fn:
                log_fn("error", f"  {org}: billing error - {e}")

        # Seats
        try:
            seats = await api.get_copilot_seats(org)
            if seats and seats.get("_permission_error"):
                summary["errors"].append(f"seats: {seats['message']}")
                if log_fn:
                    log_fn("error", f"  {org}: seats - {seats['message']}")
            elif seats:
                self._save_json("seats", org, seats)
                summary["synced"].append(f"seats ({len(seats.get('seats', seats.get('total_seats', 0)))} total)")
                if log_fn:
                    log_fn("info", f"  {org}: seats synced ({len(seats.get('seats', []))} total)")
        except Exception as e:
            summary["errors"].append(f"seats: {e}")
            if log_fn:
                log_fn("error", f"  {org}: seats error - {e}")

        # Usage Report (org-level 28-day)
        try:
            usage_report = await api.get_org_usage_report_28day(org)
            if usage_report:
                self._save_json("usage", org, usage_report)
                n = usage_report.get("total_records", 0)
                summary["synced"].append(f"usage ({n} records)")
                if log_fn:
                    log_fn("info", f"  {org}: usage report synced ({n} records)")
        except Exception as e:
            summary["errors"].append(f"usage: {e}")
            if log_fn:
                log_fn("error", f"  {org}: usage report error - {e}")

        # Usage Users Report (org user-level 28-day)
        try:
            users_report = await api.get_org_users_usage_report_28day(org)
            if users_report:
                self._save_json("usage_users", org, users_report)
                n = users_report.get("total_records", 0)
                summary["synced"].append(f"usage_users ({n} records)")
                if log_fn:
                    log_fn("info", f"  {org}: usage users report synced ({n} records)")
        except Exception as e:
            summary["errors"].append(f"usage_users: {e}")
            if log_fn:
                log_fn("error", f"  {org}: usage users report error - {e}")

        # Metrics
        try:
            metrics = await api.get_copilot_metrics(org)
            if metrics:
                self._save_json("metrics", org, metrics)
                summary["synced"].append(f"metrics ({len(metrics)} entries)")
                if log_fn:
                    log_fn("info", f"  {org}: metrics synced ({len(metrics)} entries)")
        except Exception as e:
            summary["errors"].append(f"metrics: {e}")
            if log_fn:
                log_fn("error", f"  {org}: metrics error - {e}")

        # Premium Request Usage (current month)
        try:
            premium = await api.get_premium_request_usage(org)
            if premium:
                self._save_json("premium_requests", org, premium)
                n = len(premium.get("usageItems", []))
                summary["synced"].append(f"premium_requests ({n} items)")
                if log_fn:
                    log_fn("info", f"  {org}: premium requests synced ({n} items)")
        except Exception as e:
            summary["errors"].append(f"premium_requests: {e}")
            if log_fn:
                log_fn("error", f"  {org}: premium requests error - {e}")

        if log_fn:
            log_fn("info", f"  {org}: done ({len(summary['synced'])} synced, {len(summary['errors'])} errors)")

        return summary

    async def _expand_cost_center_members(
        self, cost_center: dict, api, log_fn: LogFn = None
    ) -> list[dict]:
        """Expand cost center resources into a flat member list.

        - Resource type "User"  → added directly.
        - Resource type "Org"   → all org members fetched and added.
        - Resource type "Team"  → expects "name" as "org/team-slug"; members fetched.
        """
        members: list[dict] = []
        seen_logins: set[str] = set()

        def _add_member(raw: dict, source_type: str, source_name: str):
            login = raw.get("login", "")
            if not login or login in seen_logins:
                return
            seen_logins.add(login)
            members.append({
                "login": login,
                "avatar_url": raw.get("avatar_url", ""),
                "html_url": raw.get("html_url", f"https://github.com/{login}"),
                "source_type": source_type,
                "source_name": source_name,
            })

        for resource in cost_center.get("resources", []):
            rtype = resource.get("type", "")
            rname = resource.get("name", "")

            if rtype == "User":
                _add_member({"login": rname}, "User", rname)

            elif rtype == "Org":
                try:
                    org_members = await api.get_org_members(rname)
                    for m in org_members:
                        _add_member(m, "Org", rname)
                    if log_fn:
                        log_fn("info", f"    Org '{rname}': {len(org_members)} members")
                except Exception as e:
                    if log_fn:
                        log_fn("error", f"    Org '{rname}' members error: {e}")

            elif rtype == "Team":
                # "name" may be "org/team-slug" or just "team-slug"
                parts = rname.split("/", 1)
                if len(parts) == 2:
                    org_name, team_slug = parts
                else:
                    # Fallback: try deriving org from the enterprise cost center context
                    team_slug = parts[0]
                    org_name = ""
                if org_name:
                    try:
                        team_members = await api.get_team_members(org_name, team_slug)
                        for m in team_members:
                            _add_member(m, "Team", rname)
                        if log_fn:
                            log_fn("info", f"    Team '{rname}': {len(team_members)} members")
                    except Exception as e:
                        if log_fn:
                            log_fn("error", f"    Team '{rname}' members error: {e}")

        return members

    async def sync_enterprises(self, log_fn: LogFn = None) -> dict:
        """Sync enterprise list, cost centers, seats, billing, and usage reports."""
        summary: dict = {"synced": [], "errors": []}
        if not self._api_manager:
            return summary

        enterprises = self._api_manager.get_all_enterprises()
        if not enterprises:
            if log_fn:
                log_fn("info", "  No enterprises discovered, skipping enterprise sync")
            return summary

        # Save full enterprise list
        self._save_json("enterprise", "all", enterprises)
        summary["synced"].append(f"enterprises ({len(enterprises)} total)")
        if log_fn:
            log_fn("info", f"  Enterprises synced: {[e['slug'] for e in enterprises]}")

        for ent in enterprises:
            slug = ent["slug"]
            api = self._api_manager.get_api_for_enterprise(slug)
            if not api:
                summary["errors"].append(f"enterprise/{slug}: no API client")
                continue

            if log_fn:
                log_fn("info", f"  Syncing enterprise: {slug}...")

            # Cost centers
            try:
                raw_cost_centers = await api.get_enterprise_cost_centers(slug)
                if log_fn:
                    log_fn("info", f"  {slug}: {len(raw_cost_centers)} cost centers, expanding members...")
                expanded = []
                total_members = 0
                for cc in raw_cost_centers:
                    members = await self._expand_cost_center_members(cc, api, log_fn=log_fn)
                    expanded.append({**cc, "members": members, "member_count": len(members)})
                    total_members += len(members)
                self._save_json("cost_centers", slug, {
                    "enterprise": slug,
                    "enterprise_name": ent.get("name", ""),
                    "cost_centers": expanded,
                    "total": len(expanded),
                    "total_unique_members": len({
                        m["login"] for cc in expanded for m in cc["members"]
                    }),
                })
                summary["synced"].append(
                    f"cost_centers/{slug} ({len(expanded)} centers, {total_members} member assignments)"
                )
                if log_fn:
                    log_fn("info", f"  {slug}: cost centers synced ({len(expanded)} centers)")
            except Exception as e:
                summary["errors"].append(f"cost_centers/{slug}: {e}")
                if log_fn:
                    log_fn("error", f"  {slug}: cost centers error - {e}")

            # Billing (use enterprise slug as org key so existing tools pick it up)
            # Incremental fetch: only get days not yet in DB + retry yesterday (report delay ~24h)
            from datetime import datetime, timezone, timedelta, date

            today = date.today()
            cycle_start = today.replace(day=1)
            days_in_cycle = [(cycle_start + timedelta(days=i)).isoformat()
                            for i in range((today - cycle_start).days + 1)]

            # Also include last 3 days of previous month (catch end-of-month miss due to report delay)
            prev_month_end = cycle_start - timedelta(days=1)
            prev_month_catchup = [(prev_month_end - timedelta(days=i)).isoformat() for i in range(2, -1, -1)]

            # Determine which days need fetching (not yet in DB, or yesterday/today for retry)
            yesterday = (today - timedelta(days=1)).isoformat()
            today_str = today.isoformat()

            existing_usage_days = set()
            existing_users_days = set()
            if self._db:
                for row in self._db.load_daily("usage", slug):
                    existing_usage_days.add(row["day"])
                for row in self._db.load_daily("usage_users", slug):
                    existing_users_days.add(row["day"])

            all_target_days = sorted(set(prev_month_catchup + days_in_cycle))
            usage_fetch_days = [d for d in all_target_days
                               if d not in existing_usage_days or d in (yesterday, today_str)]
            users_fetch_days = [d for d in all_target_days
                               if d not in existing_users_days or d in (yesterday, today_str)]

            # Enterprise usage (incremental)
            try:
                fetched_usage = 0
                for day in usage_fetch_days:
                    day_report = await api.get_enterprise_usage_report_1day(slug, day)
                    if day_report and day_report.get("records"):
                        for rec in day_report["records"]:
                            self._db.save_daily("usage", slug, rec.get("day", day), rec)
                            fetched_usage += 1
                if fetched_usage and log_fn:
                    log_fn("info", f"  {slug}: usage fetched {fetched_usage} new day(s)")
            except Exception as e:
                summary["errors"].append(f"usage/{slug}: {e}")
                if log_fn:
                    log_fn("error", f"  {slug}: usage error - {e}")

            # Users usage (incremental)
            try:
                fetched_users = 0
                for day in users_fetch_days:
                    day_report = await api.get_enterprise_users_usage_report_1day(slug, day)
                    if day_report and day_report.get("records"):
                        by_day: dict[str, list] = {}
                        for rec in day_report["records"]:
                            d = rec.get("day", day)
                            by_day.setdefault(d, []).append(rec)
                        for d, recs in by_day.items():
                            self._db.save_daily("usage_users", slug, d, recs)
                            fetched_users += 1
                if fetched_users and log_fn:
                    log_fn("info", f"  {slug}: usage users fetched {fetched_users} new day(s)")
            except Exception as e:
                summary["errors"].append(f"usage_users/{slug}: {e}")
                if log_fn:
                    log_fn("error", f"  {slug}: usage users error - {e}")

            # Load full billing cycle data from DB for seats derivation and metrics
            usage = None
            users_usage = None
            if self._db:
                usage_rows = self._db.load_daily("usage", slug,
                                                 start_day=days_in_cycle[0], end_day=days_in_cycle[-1])
                if usage_rows:
                    usage = self._reconstruct_usage_from_daily(usage_rows)
                    summary["synced"].append(f"usage/{slug} ({len(usage_rows)} days in cycle)")

                users_rows = self._db.load_daily("usage_users", slug,
                                                 start_day=days_in_cycle[0], end_day=days_in_cycle[-1])
                if users_rows:
                    users_usage = self._reconstruct_usage_users_from_daily(users_rows)
                    summary["synced"].append(f"usage_users/{slug} ({len(users_rows)} days in cycle)")

            # Derive synthetic seats: team members = licensed, billing cycle usage = active
            # Get all licensed users from enterprise teams
            all_licensed_users: set[str] = set()
            try:
                teams = await api.list_enterprise_teams(slug)
                if teams:
                    for team in teams:
                        team_id = team.get("id", 0)
                        if not team_id:
                            continue
                        members_raw = await api.get_enterprise_team_members(slug, team_id)
                        for m in members_raw:
                            login = m.get("login", "").strip()
                            if login:
                                all_licensed_users.add(login)
            except Exception:
                pass

            # Determine active users from billing cycle usage reports
            active_users: dict[str, str] = {}  # login -> last_day
            if users_usage and users_usage.get("records"):
                for rec in users_usage["records"]:
                    login = rec.get("user_login", "")
                    if not login:
                        continue
                    day = rec.get("day", "")
                    has_activity = rec.get("user_initiated_interaction_count", 0) > 0
                    if has_activity:
                        if login not in active_users or day > active_users[login]:
                            active_users[login] = day
                    all_licensed_users.add(login)

            seats_list = []
            active_count = 0
            for login in sorted(all_licensed_users):
                last_day = active_users.get(login)
                last_activity_at = f"{last_day}T23:59:59Z" if last_day else None
                is_active = login in active_users
                if is_active:
                    active_count += 1
                seats_list.append({
                    "assignee": {"login": login, "avatar_url": "", "type": "User"},
                    "last_activity_at": last_activity_at,
                    "plan_type": "enterprise",
                    "pending_cancellation_date": None,
                })

            if seats_list:
                seats_data = {"total_seats": len(seats_list), "seats": seats_list}
                self._save_json("seats", slug, seats_data)
                summary["synced"].append(f"seats/{slug} ({len(seats_list)} total)")
                if log_fn:
                    log_fn("info", f"  {slug}: seats derived ({len(seats_list)} licensed, {active_count} active in billing cycle)")

                # Synthetic billing
                billing_data = {
                    "seat_breakdown": {
                        "total": len(seats_list),
                        "active_this_cycle": active_count,
                    },
                    "_detected_price_per_seat": 39.0,
                    "_detected_plan_type": "enterprise",
                    "billing_cycle_start": days_in_cycle[0],
                    "billing_cycle_end": today.isoformat(),
                }
                self._save_json("billing", slug, billing_data)
                summary["synced"].append(f"billing/{slug}")
                if log_fn:
                    log_fn("info", f"  {slug}: billing derived ({len(seats_list)} seats, ${len(seats_list) * 39}/mo)")

            # Metrics from enterprise usage report
            if usage and usage.get("records"):
                metrics_list = []
                for rec in usage["records"]:
                    for day_total in rec.get("day_totals", []):
                        metrics_list.append(day_total)
                if metrics_list:
                    self._save_json("metrics", slug, metrics_list)
                    summary["synced"].append(f"metrics/{slug} ({len(metrics_list)} entries)")
                    if log_fn:
                        log_fn("info", f"  {slug}: metrics synced ({len(metrics_list)} entries)")

        return summary

    async def sync_github_teams(self, log_fn: LogFn = None) -> dict:
        """Sync GitHub Enterprise teams → user groups in the database.

        For every discovered enterprise, lists all enterprise-level teams and
        their members, then upserts groups named '{enterprise}/{team_name}'
        with a full member replace.
        Falls back to org-level teams if no enterprise teams are found.
        Called automatically as part of sync_all().

        Returns a summary dict with counts and any errors.
        """
        summary: dict = {"synced": [], "errors": []}

        if not self._api_manager:
            return summary

        db = self._db
        if db is None:
            return summary

        enterprises = self._api_manager.get_all_enterprises()

        if not enterprises:
            if log_fn:
                log_fn("info", "  No enterprises discovered, skipping enterprise teams sync")
            return summary

        if log_fn:
            log_fn("info", f"Syncing GitHub Enterprise Teams for {len(enterprises)} enterprise(s)...")

        groups_created = 0
        groups_updated = 0
        members_synced = 0

        for ent in enterprises:
            slug = ent.get("slug", "")
            if not slug:
                continue

            api = self._api_manager.get_api_for_enterprise(slug)
            if not api:
                summary["errors"].append(f"{slug}: no API client")
                continue

            try:
                teams = await api.list_enterprise_teams(slug)
            except Exception as e:
                summary["errors"].append(f"{slug}: list_enterprise_teams failed - {e}")
                if log_fn:
                    log_fn("error", f"  {slug}: list_enterprise_teams error - {e}")
                continue

            if not teams:
                if log_fn:
                    log_fn("info", f"  {slug}: no enterprise teams (or access denied)")
                continue

            if log_fn:
                log_fn("info", f"  {slug}: found {len(teams)} team(s)")

            for team in teams:
                team_name: str = team.get("name") or ""
                team_id: int = team.get("id") or 0
                if not team_name or not team_id:
                    continue

                group_name = f"{slug}/{team_name}"
                description = f"Synced from GitHub Enterprise team '{team_name}' in enterprise '{slug}'"

                try:
                    members_raw = await api.get_enterprise_team_members(slug, team_id)
                    usernames = [
                        m.get("login", "").lower()
                        for m in members_raw
                        if m.get("login")
                    ]

                    grp = db.get_group_by_name(group_name)
                    if grp is None:
                        gid = db.create_group(group_name, description)
                        groups_created += 1
                    else:
                        gid = grp["id"]
                        db.update_group(gid, name=group_name, description=description)
                        groups_updated += 1
                        for existing in db.get_group_members(gid):
                            db.remove_group_member(gid, existing)

                    if usernames:
                        db.add_group_members(gid, usernames)
                        members_synced += len(usernames)

                    summary["synced"].append(f"team/{slug}/{team_name} ({len(usernames)} members)")
                except Exception as e:
                    summary["errors"].append(f"{slug}/{team_name}: {e}")
                    if log_fn:
                        log_fn("error", f"  {slug}/{team_name}: error - {e}")

        if log_fn:
            log_fn(
                "info",
                f"  Enterprise teams sync: {groups_created} created, {groups_updated} updated, "
                f"{members_synced} members synced",
            )

        return summary

    async def sync_all(self, log_fn: LogFn = None) -> list[dict]:
        """Sync data for all discovered orgs and enterprises via api_manager."""
        if not self._api_manager:
            return []

        org_logins = self._api_manager.get_all_org_logins()
        enterprises = self._api_manager.get_all_enterprises() if hasattr(self._api_manager, "get_all_enterprises") else []
        if log_fn:
            org_part = f": {', '.join(org_logins)}" if org_logins else ""
            ent_part = f" [enterprises: {', '.join(e['slug'] for e in enterprises)}]" if enterprises else ""
            parts = []
            if org_logins:
                parts.append(f"{len(org_logins)} org(s){org_part}")
            if enterprises:
                parts.append(f"{len(enterprises)} enterprise(s){ent_part}")
            scope_desc = " and ".join(parts) if parts else "no configured scopes"
            log_fn("info", f"Starting sync for {scope_desc}")

        results = []
        for org_name in org_logins:
            result = await self.sync_org(org_name, log_fn=log_fn)
            results.append(result)

        # Sync enterprise data (enterprises + cost centers)
        if log_fn:
            log_fn("info", "Syncing enterprise and cost center data...")
        enterprise_summary = await self.sync_enterprises(log_fn=log_fn)
        results.append({"org": "__enterprise__", **enterprise_summary})

        # Sync GitHub Teams → user groups
        if log_fn:
            log_fn("info", "Syncing GitHub Teams → groups...")
        teams_summary = await self.sync_github_teams(log_fn=log_fn)
        results.append({"org": "__teams__", **teams_summary})

        if log_fn:
            total_synced = sum(len(r["synced"]) for r in results)
            total_errors = sum(len(r["errors"]) for r in results)
            log_fn("info", f"Sync complete: {total_synced} datasets synced, {total_errors} errors")

        return results


def create_session_collector(
    session_dir: Path,
    api_manager: APIManager | None = None,
) -> DataCollector:
    """Create a DataCollector scoped to a session directory, with fallback to global.

    Session writes go to JSON in session_dir (ephemeral).
    Reads fall through to the global SQLite DB so AI tools see synced data.
    """
    from . import database as db_module
    return DataCollector(
        data_dir=session_dir,
        fallback_dir=config.data_dir,
        api_manager=api_manager,
        db=db_module.db,  # Share global DB for reads; session writes go to JSON
    )


# Global instance (used by sidebar/overview endpoints and startup sync)
data_collector = DataCollector()
