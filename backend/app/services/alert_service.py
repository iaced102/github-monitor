"""
Alert service — evaluates threshold rules against current Copilot data
and returns actionable alerts.

Thresholds are stored in the SQLite database (app_config table, key='alert_config').
Default thresholds if not configured:
  - inactive_rate    : warn ≥ 25%, critical ≥ 40%
  - cost_waste_pct   : warn ≥ 30%, critical ≥ 50%
  - acceptance_rate  : warn ≤ 20%, critical ≤ 10%
  - no_active_days   : warn ≥ 7 days, critical ≥ 14 days (for quarterly report)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .data_collector import DataCollector

_CONFIG_KEY = "alert_config"

DEFAULT_CONFIG: dict = {
    "enabled": True,
    "thresholds": {
        "inactive_rate": {
            "enabled": True,
            "warn": 25.0,
            "critical": 40.0,
            "description": "% of seats inactive (no usage in 30 days)",
        },
        "cost_waste_pct": {
            "enabled": True,
            "warn": 30.0,
            "critical": 50.0,
            "description": "% of monthly spend that is wasted (inactive seats)",
        },
        "acceptance_rate": {
            "enabled": True,
            "warn": 20.0,
            "critical": 10.0,
            "description": "Average code suggestion acceptance rate (%); alert when BELOW threshold",
        },
        "no_active_days": {
            "enabled": True,
            "warn": 7,
            "critical": 14,
            "description": "Consecutive days with 0 daily-active users; alert when AT OR ABOVE threshold",
        },
    },
}


def _get_db():
    from . import database as db_module
    return db_module.db


def load_config() -> dict:
    db = _get_db()
    if db:
        stored = db.get_config(_CONFIG_KEY)
        if stored:
            # Merge with defaults so new threshold keys appear automatically
            cfg = stored
            defaults = DEFAULT_CONFIG["thresholds"]
            cfg.setdefault("enabled", True)
            cfg.setdefault("thresholds", {})
            for k, v in defaults.items():
                cfg["thresholds"].setdefault(k, v)
            return cfg
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    db = _get_db()
    if db:
        db.set_config(_CONFIG_KEY, cfg)


def _level(value: float, warn: float, critical: float, higher_is_worse: bool = True) -> str:
    """Return 'critical', 'warning', or 'ok'."""
    if higher_is_worse:
        if value >= critical:
            return "critical"
        if value >= warn:
            return "warning"
    else:
        if value <= critical:
            return "critical"
        if value <= warn:
            return "warning"
    return "ok"


def evaluate_alerts(collector: "DataCollector") -> list[dict]:
    """Evaluate all enabled thresholds and return list of active alerts."""
    cfg = load_config()
    if not cfg.get("enabled", True):
        return []

    thresholds = cfg.get("thresholds", {})
    alerts: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()

    # ── Gather data from collector ──────────────────────────────────────────
    all_seats = collector.load_all_latest("seats")       # {org: {seats: [...]}}
    all_billing = collector.load_all_latest("billing")   # {org: {total_seats, ...}}
    all_usage = collector.load_all_latest("usage")       # {org: {days: [...]}}

    # ── 1. Inactive rate ────────────────────────────────────────────────────
    thresh = thresholds.get("inactive_rate", {})
    if thresh.get("enabled", True):
        total_seats = 0
        inactive_seats = 0
        inactive_by_org: dict[str, tuple[int, int]] = {}  # org -> (inactive, total)

        for org, data in all_seats.items():
            seats_list = data.get("seats", []) if isinstance(data, dict) else []
            org_total = len(seats_list)
            org_inactive = sum(
                1 for s in seats_list
                if not s.get("last_activity_at") or _days_since(s.get("last_activity_at", "")) >= 30
            )
            total_seats += org_total
            inactive_seats += org_inactive
            if org_total > 0:
                inactive_by_org[org] = (org_inactive, org_total)

        if total_seats > 0:
            rate = inactive_seats / total_seats * 100
            lvl = _level(rate, thresh.get("warn", 25), thresh.get("critical", 40))
            if lvl != "ok":
                worst_orgs = sorted(
                    [(o, i / t * 100) for o, (i, t) in inactive_by_org.items()],
                    key=lambda x: -x[1]
                )[:3]
                org_detail = ", ".join(f"{o} ({p:.0f}%)" for o, p in worst_orgs)
                alerts.append({
                    "id": "inactive_rate",
                    "type": "inactive_rate",
                    "level": lvl,
                    "title": f"Tỷ lệ inactive cao: {rate:.1f}%",
                    "message": (
                        f"{inactive_seats}/{total_seats} seats không có hoạt động trong 30 ngày "
                        f"(ngưỡng {lvl}: {thresh.get('critical' if lvl == 'critical' else 'warn')}%). "
                        f"Org cao nhất: {org_detail}"
                    ),
                    "value": round(rate, 1),
                    "threshold": thresh.get("critical" if lvl == "critical" else "warn"),
                    "unit": "%",
                    "created_at": now,
                })

    # ── 2. Cost waste % ─────────────────────────────────────────────────────
    thresh = thresholds.get("cost_waste_pct", {})
    if thresh.get("enabled", True):
        total_cost = 0.0
        total_waste = 0.0
        for org, data in all_billing.items():
            if isinstance(data, dict):
                total_cost += data.get("monthly_cost", 0) or 0
                total_waste += data.get("monthly_waste", 0) or 0

        if total_cost > 0:
            waste_pct = total_waste / total_cost * 100
            lvl = _level(waste_pct, thresh.get("warn", 30), thresh.get("critical", 50))
            if lvl != "ok":
                alerts.append({
                    "id": "cost_waste_pct",
                    "type": "cost_waste_pct",
                    "level": lvl,
                    "title": f"Lãng phí chi phí: {waste_pct:.1f}%",
                    "message": (
                        f"${total_waste:,.0f}/{total_cost:,.0f} USD/tháng bị lãng phí "
                        f"do seats không sử dụng "
                        f"(ngưỡng {lvl}: {thresh.get('critical' if lvl == 'critical' else 'warn')}%)"
                    ),
                    "value": round(waste_pct, 1),
                    "threshold": thresh.get("critical" if lvl == "critical" else "warn"),
                    "unit": "%",
                    "created_at": now,
                })

    # ── 3. Acceptance rate ──────────────────────────────────────────────────
    thresh = thresholds.get("acceptance_rate", {})
    if thresh.get("enabled", True):
        total_suggestions = 0
        total_accepted = 0
        for org, data in all_usage.items():
            if isinstance(data, dict):
                days_data = data.get("days", [])
                for day in days_data:
                    total_suggestions += day.get("total_suggestions_count", 0) or 0
                    total_accepted += day.get("total_acceptances_count", 0) or 0

        if total_suggestions > 0:
            acc_rate = total_accepted / total_suggestions * 100
            lvl = _level(acc_rate, thresh.get("warn", 20), thresh.get("critical", 10), higher_is_worse=False)
            if lvl != "ok":
                alerts.append({
                    "id": "acceptance_rate",
                    "type": "acceptance_rate",
                    "level": lvl,
                    "title": f"Acceptance rate thấp: {acc_rate:.1f}%",
                    "message": (
                        f"Tỷ lệ chấp nhận gợi ý code chỉ đạt {acc_rate:.1f}% "
                        f"({total_accepted:,}/{total_suggestions:,} suggestions) — "
                        f"ngưỡng {lvl}: {thresh.get('critical' if lvl == 'critical' else 'warn')}%"
                    ),
                    "value": round(acc_rate, 1),
                    "threshold": thresh.get("critical" if lvl == "critical" else "warn"),
                    "unit": "%",
                    "created_at": now,
                })

    # ── 4. No-active-days streak ─────────────────────────────────────────────
    thresh = thresholds.get("no_active_days", {})
    if thresh.get("enabled", True):
        # Find max consecutive tail of zero-DAU days across all orgs (combined)
        daily_active: dict[str, int] = {}
        for org, data in all_usage.items():
            if isinstance(data, dict):
                for day in data.get("days", []):
                    dt = day.get("date", "")[:10]
                    active = day.get("total_active_users", 0) or 0
                    if dt:
                        daily_active[dt] = daily_active.get(dt, 0) + active

        if daily_active:
            sorted_days = sorted(daily_active.keys())
            streak = 0
            for d in reversed(sorted_days):
                if daily_active[d] == 0:
                    streak += 1
                else:
                    break

            lvl = _level(streak, thresh.get("warn", 7), thresh.get("critical", 14))
            if lvl != "ok":
                alerts.append({
                    "id": "no_active_days",
                    "type": "no_active_days",
                    "level": lvl,
                    "title": f"Không có người dùng active: {streak} ngày liên tiếp",
                    "message": (
                        f"Trong {streak} ngày gần nhất không có user nào sử dụng Copilot "
                        f"(ngưỡng {lvl}: {thresh.get('critical' if lvl == 'critical' else 'warn')} ngày). "
                        f"Kể từ: {sorted_days[-streak] if streak <= len(sorted_days) else sorted_days[0]}"
                    ),
                    "value": streak,
                    "threshold": thresh.get("critical" if lvl == "critical" else "warn"),
                    "unit": "days",
                    "created_at": now,
                })

    # Sort: critical first, then warning
    alerts.sort(key=lambda a: (0 if a["level"] == "critical" else 1, a["id"]))
    return alerts


def _days_since(ts: str) -> int:
    """Return integer days since an ISO timestamp. Returns 999 if empty/invalid."""
    if not ts:
        return 999
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return 999
