"""
SQLite database manager for OctoFinance.

Replaces JSON file storage with a proper relational database.
Tables:
  - data_snapshots: cached API data (seats, billing, usage, metrics, etc.)
  - recommendations: AI-generated recommendations for admin review
  - audit_log: record of all executed actions
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path


class Database:
    """Thread-safe SQLite database manager."""

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._local = threading.local()
        self._lock = threading.Lock()
        # Ensure the parent directory exists
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # Initialize schema using a temporary connection
        conn = self._make_conn()
        self._create_tables(conn)
        conn.close()

    def _make_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @property
    def _conn(self) -> sqlite3.Connection:
        """Return a per-thread connection, creating one if needed."""
        if not getattr(self._local, "conn", None):
            self._local.conn = self._make_conn()
        return self._local.conn

    def _create_tables(self, conn: sqlite3.Connection):
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS data_snapshots (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                category    TEXT NOT NULL,
                org         TEXT NOT NULL,
                data        TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
                ON data_snapshots(category, org, created_at DESC);

            -- Per-day data storage: each (category, org, day) is unique — UPSERT on sync
            CREATE TABLE IF NOT EXISTS data_daily (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                category    TEXT NOT NULL,
                org         TEXT NOT NULL,
                day         TEXT NOT NULL,
                data        TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                UNIQUE(category, org, day)
            );
            CREATE INDEX IF NOT EXISTS idx_daily_lookup
                ON data_daily(category, org, day);

            CREATE TABLE IF NOT EXISTS recommendations (
                id                          TEXT PRIMARY KEY,
                created_at                  TEXT NOT NULL,
                org                         TEXT NOT NULL,
                type                        TEXT NOT NULL,
                affected_users              TEXT NOT NULL DEFAULT '[]',
                description                 TEXT NOT NULL,
                estimated_monthly_savings   REAL DEFAULT 0,
                status                      TEXT DEFAULT 'pending',
                approved_at                 TEXT,
                rejected_at                 TEXT,
                executed_at                 TEXT,
                execution_result            TEXT
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at  TEXT NOT NULL,
                action      TEXT NOT NULL,
                org         TEXT NOT NULL,
                usernames   TEXT NOT NULL DEFAULT '[]',
                reason      TEXT,
                results     TEXT
            );

            -- Multi-user auth: super_admin and manager accounts
            CREATE TABLE IF NOT EXISTS app_users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt          TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'manager',
                created_at    TEXT NOT NULL
            );

            -- Groups of GitHub Copilot seat-holders
            CREATE TABLE IF NOT EXISTS user_groups (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            -- GitHub logins that belong to each group
            CREATE TABLE IF NOT EXISTS group_members (
                group_id        INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
                github_username TEXT NOT NULL,
                PRIMARY KEY (group_id, github_username)
            );

            -- Which groups a manager is allowed to see
            CREATE TABLE IF NOT EXISTS manager_groups (
                manager_username TEXT NOT NULL,
                group_id         INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
                PRIMARY KEY (manager_username, group_id)
            );

            -- Per-org monthly budget configuration
            CREATE TABLE IF NOT EXISTS budgets (
                org         TEXT PRIMARY KEY,
                budget_usd  REAL NOT NULL,
                note        TEXT NOT NULL DEFAULT '',
                updated_at  TEXT NOT NULL
            );

            -- Alert threshold configuration (single-row key/value store)
            CREATE TABLE IF NOT EXISTS app_config (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
        """)
        conn.commit()

    # ------------------------------------------------------------------ #
    # Data snapshots                                                       #
    # ------------------------------------------------------------------ #

    # Keep only this many snapshots per (category, org) — older rows are pruned.
    _SNAPSHOT_RETENTION = 10

    def save_snapshot(self, category: str, org: str, data: dict | list):
        """Persist a data snapshot for (category, org), pruning old rows."""
        ts = datetime.now(timezone.utc).isoformat()
        serialized = json.dumps(data, default=str)
        with self._lock:
            self._conn.execute(
                "INSERT INTO data_snapshots (category, org, data, created_at) VALUES (?, ?, ?, ?)",
                (category, org, serialized, ts),
            )
            # Prune: keep only the N most recent rows for this (category, org)
            self._conn.execute(
                """DELETE FROM data_snapshots
                   WHERE category = ? AND org = ?
                     AND id NOT IN (
                         SELECT id FROM data_snapshots
                         WHERE category = ? AND org = ?
                         ORDER BY created_at DESC
                         LIMIT ?
                     )""",
                (category, org, category, org, self._SNAPSHOT_RETENTION),
            )
            self._conn.commit()

    def load_latest_snapshot(self, category: str, org: str) -> dict | list | None:
        """Return the most recent snapshot for (category, org), or None."""
        row = self._conn.execute(
            """SELECT data FROM data_snapshots
               WHERE category = ? AND org = ?
               ORDER BY created_at DESC
               LIMIT 1""",
            (category, org),
        ).fetchone()
        return json.loads(row["data"]) if row else None

    def load_all_latest_snapshots(self, category: str) -> dict[str, dict | list]:
        """Return the most recent snapshot per org for a given category."""
        rows = self._conn.execute(
            """SELECT org, data FROM data_snapshots
               WHERE id IN (
                   SELECT MAX(id)
                   FROM data_snapshots
                   WHERE category = ?
                   GROUP BY org
               )""",
            (category,),
        ).fetchall()
        return {row["org"]: json.loads(row["data"]) for row in rows}

    # ------------------------------------------------------------------ #
    # Per-day data (usage, usage_users)                                   #
    # ------------------------------------------------------------------ #

    def save_daily(self, category: str, org: str, day: str, data: dict | list):
        """Upsert one day's data for (category, org, day)."""
        ts = datetime.now(timezone.utc).isoformat()
        serialized = json.dumps(data, default=str)
        with self._lock:
            self._conn.execute(
                """INSERT INTO data_daily (category, org, day, data, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(category, org, day) DO UPDATE SET
                       data = excluded.data,
                       updated_at = excluded.updated_at""",
                (category, org, day, serialized, ts),
            )
            self._conn.commit()

    def load_daily(
        self, category: str, org: str,
        start_day: str | None = None, end_day: str | None = None,
    ) -> list[dict]:
        """Return daily rows for (category, org), optionally filtered by day range.
        Each row is {"day": ..., "data": ...} sorted by day ascending."""
        query = "SELECT day, data FROM data_daily WHERE category = ? AND org = ?"
        params: list = [category, org]
        if start_day:
            query += " AND day >= ?"
            params.append(start_day)
        if end_day:
            query += " AND day <= ?"
            params.append(end_day)
        query += " ORDER BY day ASC"
        rows = self._conn.execute(query, params).fetchall()
        return [{"day": r["day"], "data": json.loads(r["data"])} for r in rows]

    def has_daily_data(self, category: str, org: str) -> bool:
        """Return True if there is any per-day data for (category, org)."""
        row = self._conn.execute(
            "SELECT 1 FROM data_daily WHERE category = ? AND org = ? LIMIT 1",
            (category, org),
        ).fetchone()
        return row is not None

    def load_all_daily_orgs(self, category: str) -> list[str]:
        """Return all orgs that have daily data for the given category."""
        rows = self._conn.execute(
            "SELECT DISTINCT org FROM data_daily WHERE category = ?", (category,)
        ).fetchall()
        return [r["org"] for r in rows]

    def cleanup_old_daily(self, retention_days: int = 180):
        """Remove daily data older than retention_days. Default: 6 months."""
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=retention_days)).isoformat()
        deleted = self._conn.execute(
            "DELETE FROM data_daily WHERE day < ?", (cutoff,)
        ).rowcount
        self._conn.commit()
        if deleted:
            print(f"[Database] Cleaned up {deleted} daily rows older than {cutoff}")
        return deleted

    # ------------------------------------------------------------------ #
    # Recommendations                                                      #
    # ------------------------------------------------------------------ #

    def save_recommendation(self, rec: dict):
        """Insert or replace a recommendation record."""
        with self._lock:
            self._conn.execute(
                """INSERT OR REPLACE INTO recommendations
                   (id, created_at, org, type, affected_users, description,
                    estimated_monthly_savings, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    rec["id"],
                    rec.get("timestamp") or rec.get("created_at") or datetime.now(timezone.utc).isoformat(),
                    rec["org"],
                    rec["type"],
                    json.dumps(rec.get("affected_users", []), default=str),
                    rec["description"],
                    rec.get("estimated_monthly_savings", 0),
                    rec.get("status", "pending"),
                ),
            )
            self._conn.commit()

    def get_recommendations(self, status: str = "all") -> list[dict]:
        """Return recommendations, optionally filtered by status."""
        if status == "all":
            rows = self._conn.execute(
                "SELECT * FROM recommendations ORDER BY created_at DESC"
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM recommendations WHERE status = ? ORDER BY created_at DESC",
                (status,),
            ).fetchall()
        return [self._rec_to_dict(r) for r in rows]

    def get_recommendation(self, rec_id: str) -> dict | None:
        """Return a single recommendation by ID."""
        row = self._conn.execute(
            "SELECT * FROM recommendations WHERE id = ?", (rec_id,)
        ).fetchone()
        return self._rec_to_dict(row) if row else None

    def update_recommendation(self, rec_id: str, updates: dict):
        """Apply a partial update to a recommendation row."""
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [rec_id]
        with self._lock:
            self._conn.execute(
                f"UPDATE recommendations SET {set_clause} WHERE id = ?", values
            )
            self._conn.commit()

    def _rec_to_dict(self, row: sqlite3.Row) -> dict:
        d = dict(row)
        d["affected_users"] = json.loads(d.get("affected_users") or "[]")
        if d.get("execution_result"):
            try:
                d["execution_result"] = json.loads(d["execution_result"])
            except (json.JSONDecodeError, TypeError):
                pass
        # Backward-compat alias used in older code
        d["timestamp"] = d.get("created_at", "")
        return d

    # ------------------------------------------------------------------ #
    # Audit log                                                            #
    # ------------------------------------------------------------------ #

    def append_audit_log(self, entry: dict):
        """Append a single audit log entry."""
        with self._lock:
            self._conn.execute(
                """INSERT INTO audit_log
                   (created_at, action, org, usernames, reason, results)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    entry.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                    entry.get("action", ""),
                    entry.get("org", ""),
                    json.dumps(entry.get("usernames", []), default=str),
                    entry.get("reason", ""),
                    json.dumps(entry.get("results", []), default=str),
                ),
            )
            self._conn.commit()

    def get_audit_log(self, limit: int = 500) -> list[dict]:
        """Return the most recent audit log entries."""
        rows = self._conn.execute(
            "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["usernames"] = json.loads(d.get("usernames") or "[]")
            d["results"] = json.loads(d.get("results") or "[]")
            results.append(d)
        return results

    # ------------------------------------------------------------------ #
    # Migration helpers                                                    #
    # ------------------------------------------------------------------ #

    def migrate_from_json_dir(self, data_dir: Path):
        """One-time migration: import existing JSON files into the database.

        For each category subdirectory, imports all *_latest.json files.
        Skips categories that are not data snapshots (sessions/, premium_usage_csv/).
        Also imports recommendations.json and audit_log.json if present.
        """
        snapshot_categories = [
            "billing", "seats", "usage", "usage_users",
            "metrics", "premium_requests", "enterprise", "cost_centers",
        ]

        for category in snapshot_categories:
            cat_dir = data_dir / category
            if not cat_dir.exists():
                continue
            for json_file in cat_dir.glob("*_latest.json"):
                org = json_file.name.replace("_latest.json", "")
                # Skip if we already have data for this (category, org)
                existing = self.load_latest_snapshot(category, org)
                if existing is not None:
                    continue
                try:
                    data = json.loads(json_file.read_text(encoding="utf-8"))
                    self.save_snapshot(category, org, data)
                    print(f"[DB] Migrated {category}/{org} from JSON")
                except Exception as e:
                    print(f"[DB] Migration warning for {category}/{org}: {e}")

        # Migrate recommendations.json
        rec_file = data_dir / "recommendations.json"
        if rec_file.exists():
            try:
                recs = json.loads(rec_file.read_text(encoding="utf-8"))
                existing_ids = {r["id"] for r in self.get_recommendations("all")}
                migrated = 0
                for rec in recs:
                    if rec.get("id") not in existing_ids:
                        # Normalize keys
                        rec.setdefault("timestamp", rec.get("created_at", datetime.now(timezone.utc).isoformat()))
                        self.save_recommendation(rec)
                        # Restore status fields that INSERT OR REPLACE overwrites
                        updates = {}
                        for field in ("status", "approved_at", "rejected_at", "executed_at"):
                            if rec.get(field) and field != "status":
                                updates[field] = rec[field]
                        if rec.get("status", "pending") != "pending":
                            updates["status"] = rec["status"]
                        if updates:
                            self.update_recommendation(rec["id"], updates)
                        migrated += 1
                if migrated:
                    print(f"[DB] Migrated {migrated} recommendations from JSON")
            except Exception as e:
                print(f"[DB] Migration warning for recommendations.json: {e}")

        # Migrate audit_log.json
        audit_file = data_dir / "audit_log.json"
        if audit_file.exists():
            try:
                entries = json.loads(audit_file.read_text(encoding="utf-8"))
                count = self._conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
                if count == 0 and entries:
                    for entry in entries:
                        self.append_audit_log(entry)
                    print(f"[DB] Migrated {len(entries)} audit log entries from JSON")
            except Exception as e:
                print(f"[DB] Migration warning for audit_log.json: {e}")

    # ------------------------------------------------------------------ #
    # App users (multi-user auth)                                         #
    # ------------------------------------------------------------------ #

    def create_app_user(self, username: str, password_hash: str, salt: str, role: str = "manager") -> int:
        """Create a new app user. Returns the new row id."""
        ts = datetime.now(timezone.utc).isoformat()
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO app_users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (username, password_hash, salt, role, ts),
            )
            self._conn.commit()
            return cur.lastrowid

    def get_app_user(self, username: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM app_users WHERE username = ?", (username,)
        ).fetchone()
        return dict(row) if row else None

    def list_app_users(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT id, username, role, created_at FROM app_users ORDER BY created_at"
        ).fetchall()
        return [dict(r) for r in rows]

    def update_app_user_password(self, username: str, password_hash: str, salt: str):
        with self._lock:
            self._conn.execute(
                "UPDATE app_users SET password_hash = ?, salt = ? WHERE username = ?",
                (password_hash, salt, username),
            )
            self._conn.commit()

    def update_app_user_role(self, username: str, role: str):
        with self._lock:
            self._conn.execute(
                "UPDATE app_users SET role = ? WHERE username = ?",
                (role, username),
            )
            self._conn.commit()

    def delete_app_user(self, username: str):
        with self._lock:
            self._conn.execute("DELETE FROM app_users WHERE username = ?", (username,))
            self._conn.execute("DELETE FROM manager_groups WHERE manager_username = ?", (username,))
            self._conn.commit()

    def app_user_exists(self) -> bool:
        """Return True if at least one app user exists."""
        count = self._conn.execute("SELECT COUNT(*) FROM app_users").fetchone()[0]
        return count > 0

    # ------------------------------------------------------------------ #
    # User groups                                                         #
    # ------------------------------------------------------------------ #

    def create_group(self, name: str, description: str = "") -> int:
        ts = datetime.now(timezone.utc).isoformat()
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO user_groups (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (name, description, ts, ts),
            )
            self._conn.commit()
            return cur.lastrowid

    def get_group(self, group_id: int) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM user_groups WHERE id = ?", (group_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_group_by_name(self, name: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM user_groups WHERE name = ?", (name,)
        ).fetchone()
        return dict(row) if row else None

    def list_groups(self) -> list[dict]:
        rows = self._conn.execute(
            """SELECT g.*, COUNT(gm.github_username) as member_count
               FROM user_groups g
               LEFT JOIN group_members gm ON g.id = gm.group_id
               GROUP BY g.id
               ORDER BY g.name"""
        ).fetchall()
        return [dict(r) for r in rows]

    def update_group(self, group_id: int, name: str | None = None, description: str | None = None):
        fields = {}
        if name is not None:
            fields["name"] = name
        if description is not None:
            fields["description"] = description
        if not fields:
            return
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [group_id]
        with self._lock:
            self._conn.execute(f"UPDATE user_groups SET {set_clause} WHERE id = ?", values)
            self._conn.commit()

    def delete_group(self, group_id: int):
        with self._lock:
            self._conn.execute("DELETE FROM group_members WHERE group_id = ?", (group_id,))
            self._conn.execute("DELETE FROM manager_groups WHERE group_id = ?", (group_id,))
            self._conn.execute("DELETE FROM user_groups WHERE id = ?", (group_id,))
            self._conn.commit()

    # ------------------------------------------------------------------ #
    # Group members                                                       #
    # ------------------------------------------------------------------ #

    def get_group_members(self, group_id: int) -> list[str]:
        rows = self._conn.execute(
            "SELECT github_username FROM group_members WHERE group_id = ? ORDER BY github_username",
            (group_id,),
        ).fetchall()
        return [r[0] for r in rows]

    def add_group_members(self, group_id: int, usernames: list[str]):
        with self._lock:
            self._conn.executemany(
                "INSERT OR IGNORE INTO group_members (group_id, github_username) VALUES (?, ?)",
                [(group_id, u) for u in usernames],
            )
            self._conn.execute(
                "UPDATE user_groups SET updated_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), group_id),
            )
            self._conn.commit()

    def remove_group_member(self, group_id: int, username: str):
        with self._lock:
            self._conn.execute(
                "DELETE FROM group_members WHERE group_id = ? AND github_username = ?",
                (group_id, username),
            )
            self._conn.commit()

    def get_all_group_usernames(self, group_ids: list[int]) -> list[str]:
        """Return distinct GitHub usernames across the given group IDs."""
        if not group_ids:
            return []
        placeholders = ",".join("?" * len(group_ids))
        rows = self._conn.execute(
            f"SELECT DISTINCT github_username FROM group_members WHERE group_id IN ({placeholders})",
            group_ids,
        ).fetchall()
        return [r[0] for r in rows]

    # ------------------------------------------------------------------ #
    # Manager ↔ group assignments                                        #
    # ------------------------------------------------------------------ #

    def get_manager_group_ids(self, manager_username: str) -> list[int]:
        rows = self._conn.execute(
            "SELECT group_id FROM manager_groups WHERE manager_username = ?",
            (manager_username,),
        ).fetchall()
        return [r[0] for r in rows]

    def set_manager_groups(self, manager_username: str, group_ids: list[int]):
        """Replace the group assignments for a manager."""
        with self._lock:
            self._conn.execute(
                "DELETE FROM manager_groups WHERE manager_username = ?", (manager_username,)
            )
            self._conn.executemany(
                "INSERT OR IGNORE INTO manager_groups (manager_username, group_id) VALUES (?, ?)",
                [(manager_username, gid) for gid in group_ids],
            )
            self._conn.commit()

    def get_manager_groups(self, manager_username: str) -> list[dict]:
        """Return full group objects for a manager."""
        rows = self._conn.execute(
            """SELECT g.*, COUNT(gm.github_username) as member_count
               FROM user_groups g
               JOIN manager_groups mg ON g.id = mg.group_id
               LEFT JOIN group_members gm ON g.id = gm.group_id
               WHERE mg.manager_username = ?
               GROUP BY g.id
               ORDER BY g.name""",
            (manager_username,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------ #
    # Budgets                                                              #
    # ------------------------------------------------------------------ #

    def get_all_budgets(self) -> dict[str, dict]:
        """Return all budgets as {org: {budget_usd, note}}."""
        rows = self._conn.execute("SELECT org, budget_usd, note FROM budgets").fetchall()
        return {r["org"]: {"monthly_budget_usd": r["budget_usd"], "note": r["note"]} for r in rows}

    def set_budget(self, org: str, budget_usd: float, note: str = "") -> None:
        """Upsert a budget for an org."""
        ts = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._conn.execute(
                """INSERT INTO budgets (org, budget_usd, note, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(org) DO UPDATE SET budget_usd=excluded.budget_usd,
                   note=excluded.note, updated_at=excluded.updated_at""",
                (org, budget_usd, note, ts),
            )
            self._conn.commit()

    def delete_budget(self, org: str) -> bool:
        """Delete a budget. Returns True if a row was deleted."""
        with self._lock:
            cur = self._conn.execute("DELETE FROM budgets WHERE org = ?", (org,))
            self._conn.commit()
            return cur.rowcount > 0

    # ------------------------------------------------------------------ #
    # App config (alert thresholds, etc.)                                 #
    # ------------------------------------------------------------------ #

    def get_config(self, key: str) -> dict | None:
        """Return a config value by key (parsed from JSON), or None."""
        row = self._conn.execute(
            "SELECT value FROM app_config WHERE key = ?", (key,)
        ).fetchone()
        return json.loads(row["value"]) if row else None

    def set_config(self, key: str, value: dict) -> None:
        """Upsert a config entry by key."""
        ts = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._conn.execute(
                """INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
                (key, json.dumps(value, ensure_ascii=False), ts),
            )
            self._conn.commit()


# Global database instance — initialized in main.py lifespan
db: Database | None = None
