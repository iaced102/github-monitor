"""
Copilot usage analysis tools for the AI engine.
Provides tools to read cached usage data and fetch live usage metrics reports.
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from copilot import define_tool

from ..services.data_collector import DataCollector

if TYPE_CHECKING:
    from ..services.api_manager import APIManager


# ---------------------------------------------------------------------------
# Param models
# ---------------------------------------------------------------------------

class GetUsageReportParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class GetUsersUsageReportParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class GetMetricsDetailParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class FetchOrgUsageReportParams(BaseModel):
    org: str = Field(description="Organization name (required).")
    day: str = Field(
        default="",
        description="Specific day in YYYY-MM-DD format. Leave empty to get latest 28-day report.",
    )


class FetchOrgUsersUsageReportParams(BaseModel):
    org: str = Field(description="Organization name (required).")
    day: str = Field(
        default="",
        description="Specific day in YYYY-MM-DD format. Leave empty to get latest 28-day report.",
    )


class GetUserPremiumUsageParams(BaseModel):
    user: str = Field(default="", description="Username to filter. Leave empty for all users.")
    org: str = Field(default="", description="Organization name to filter. Leave empty for all orgs.")


class GetPremiumRequestUsageParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class FetchPremiumRequestUsageParams(BaseModel):
    org: str = Field(description="Organization name (required).")
    year: int = Field(default=0, description="Year (e.g. 2026). Leave 0 for current year.")
    month: int = Field(default=0, description="Month (1-12). Leave 0 for current month.")


class GetFeatureAdoptionParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")
    user: str = Field(default="", description="Username to filter. Leave empty for all users.")


class GetLocMetricsParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")
    top_n: int = Field(default=10, description="Number of top users to return by lines added.")


class GetIdeDistributionParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class GetModelUsageParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class GetLanguageAdoptionParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")
    top_n: int = Field(default=15, description="Number of top languages to return.")


class FetchEnterpriseUsageReportParams(BaseModel):
    enterprise: str = Field(description="Enterprise slug (required).")
    day: str = Field(
        default="",
        description="Specific day in YYYY-MM-DD format. Leave empty to get latest 28-day report.",
    )


class FetchEnterpriseUsersUsageReportParams(BaseModel):
    enterprise: str = Field(description="Enterprise slug (required).")
    day: str = Field(
        default="",
        description="Specific day in YYYY-MM-DD format. Leave empty to get latest 28-day report.",
    )


class GetCliTokenUsageParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")
    top_n: int = Field(default=10, description="Number of top CLI users to return by total tokens.")


class GetUsageTrendsParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")
    metric: str = Field(
        default="all",
        description=(
            "Metric to trend. Options: 'all', 'dau' (daily active users), "
            "'generations' (code generation count), 'acceptances', 'loc_added', "
            "'interactions' (user-initiated). Default: 'all'."
        ),
    )


class GetUserActivityTimelineParams(BaseModel):
    user: str = Field(description="GitHub username (required).")
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class GetDormantUsersParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")
    split_day: str = Field(
        default="",
        description="Day to split early vs late period (YYYY-MM-DD). Leave empty to auto-split at midpoint.",
    )


class GetNeverUsedSeatsParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


# ---------------------------------------------------------------------------
# Tool factory
# ---------------------------------------------------------------------------

def create_usage_tools(
    collector: DataCollector,
    api_manager: APIManager | None = None,
) -> list:
    """Create usage tools bound to a DataCollector and optional APIManager for live fetches."""

    # --- Cached data tools ---

    @define_tool(
        description=(
            "Get the org-level Copilot usage report from cached data (synced during last Sync Data). "
            "Contains aggregated usage statistics, feature adoption metrics, and engagement data "
            "for the latest 28-day period."
        )
    )
    def get_usage_report(params: GetUsageReportParams) -> str:
        if params.org:
            data = collector.load_latest("usage", params.org)
            if not data:
                return json.dumps({"error": f"No usage report for org '{params.org}'. Try fetch_org_usage_report to get live data."})
            return json.dumps(data, default=str)
        else:
            all_data = collector.load_all_latest("usage")
            if not all_data:
                return json.dumps({"error": "No usage report data found. Try fetch_org_usage_report to get live data."})
            return json.dumps(all_data, default=str)

    @define_tool(
        description=(
            "Get the user-level Copilot usage report from cached data (synced during last Sync Data). "
            "Contains per-user engagement statistics, feature usage patterns, and adoption metrics "
            "for the latest 28-day period."
        )
    )
    def get_users_usage_report(params: GetUsersUsageReportParams) -> str:
        if params.org:
            data = collector.load_latest("usage_users", params.org)
            if not data:
                return json.dumps({"error": f"No user-level usage report for org '{params.org}'. Try fetch_org_users_usage_report to get live data."})
            return json.dumps(data, default=str)
        else:
            all_data = collector.load_all_latest("usage_users")
            if not all_data:
                return json.dumps({"error": "No user-level usage data found. Try fetch_org_users_usage_report to get live data."})
            return json.dumps(all_data, default=str)

    @define_tool(
        description=(
            "Get detailed Copilot metrics (legacy API) including IDE code completions, chat usage, "
            "PR summaries, and per-editor/model breakdown."
        )
    )
    def get_metrics_detail(params: GetMetricsDetailParams) -> str:
        if params.org:
            data = collector.load_latest("metrics", params.org)
            if not data:
                return json.dumps({"error": f"No metrics data for org '{params.org}'."})
            return json.dumps(data, default=str)
        else:
            all_data = collector.load_all_latest("metrics")
            if not all_data:
                return json.dumps({"error": "No metrics data found."})
            return json.dumps(all_data, default=str)

    @define_tool(
        description=(
            "Get Copilot premium request usage from cached data (synced during last Sync Data). "
            "Shows per-model breakdown of premium request consumption including model names, "
            "request counts, pricing, gross/discount/net amounts. Essential for cost analysis."
        )
    )
    def get_premium_request_usage(params: GetPremiumRequestUsageParams) -> str:
        if params.org:
            data = collector.load_latest("premium_requests", params.org)
            if not data:
                return json.dumps({"error": f"No premium request data for org '{params.org}'. Try fetch_premium_request_usage to get live data."})
            return json.dumps(data, default=str)
        else:
            all_data = collector.load_all_latest("premium_requests")
            if not all_data:
                return json.dumps({"error": "No premium request data found. Try fetch_premium_request_usage to get live data."})
            return json.dumps(all_data, default=str)

    @define_tool(
        description=(
            "Get per-user premium request usage from uploaded CSV data. "
            "This data comes from CSV files manually exported from GitHub UI and uploaded by the admin. "
            "Shows each user's daily premium request consumption broken down by AI model, "
            "including request counts, costs, quota usage percentage, and active days. "
            "Can filter by username or organization. Use this to answer questions about "
            "individual user's premium request spending and model preferences."
        )
    )
    def get_user_premium_usage(params: GetUserPremiumUsageParams) -> str:
        import csv as csv_mod
        # Check both primary and fallback (global) data dirs for CSV files
        csv_dirs = [collector.data_dir / "premium_usage_csv"]
        if collector._fallback_dir:
            csv_dirs.append(collector._fallback_dir / "premium_usage_csv")
        records: list[dict] = []
        seen_files: set[str] = set()
        for csv_dir in csv_dirs:
            if not csv_dir.exists():
                continue
            for f in sorted(csv_dir.glob("*.csv")):
                if f.name in seen_files:
                    continue
                seen_files.add(f.name)
                with open(f, encoding="utf-8") as fh:
                    for row in csv_mod.DictReader(fh):
                        records.append(row)

        if not records:
            return json.dumps({"error": "No per-user premium usage CSV data found. Please upload a premium request usage CSV from the Dashboard page."})

        # Filter
        if params.org:
            records = [r for r in records if r.get("organization", "") == params.org]
        if params.user:
            records = [r for r in records if r.get("username", "") == params.user]

        if not records:
            return json.dumps({"error": f"No records found matching user='{params.user}', org='{params.org}'."})

        # Aggregate per user
        from collections import defaultdict as dd
        user_map: dict[str, dict] = dd(lambda: {
            "total_requests": 0, "total_cost": 0.0,
            "models": dd(float), "days": set(), "org": "", "quota": 0,
        })
        for r in records:
            user = r.get("username", "")
            u = user_map[user]
            qty = float(r.get("quantity", 0))
            u["total_requests"] += qty
            u["total_cost"] += float(r.get("gross_amount", 0))
            u["models"][r.get("model", "unknown")] += qty
            u["days"].add(r.get("date", ""))
            u["org"] = r.get("organization", "")
            try:
                u["quota"] = int(r.get("total_monthly_quota", 0))
            except (ValueError, TypeError):
                pass

        result = []
        for username, info in sorted(user_map.items(), key=lambda x: -x[1]["total_requests"]):
            result.append({
                "user": username,
                "org": info["org"],
                "total_requests": round(info["total_requests"], 2),
                "total_cost": round(info["total_cost"], 4),
                "quota": info["quota"],
                "usage_pct": round(info["total_requests"] / info["quota"] * 100, 1) if info["quota"] > 0 else 0,
                "days_active": len(info["days"]),
                "date_range": {"start": min(info["days"]), "end": max(info["days"])} if info["days"] else None,
                "models": {m: round(q, 2) for m, q in sorted(info["models"].items(), key=lambda x: -x[1])},
            })

        return json.dumps({"users": result, "total_records": len(records)}, default=str)

    # --- New analysis tools from usage_users cached data ---

    @define_tool(
        description=(
            "Analyze Copilot feature adoption across users. Shows how many users are using "
            "code completions, chat (ask/edit/plan/agent modes), CLI, Copilot Coding Agent, "
            "and Copilot Cloud Agent. Also shows per-feature engagement counts. "
            "Use this to understand feature penetration and identify under-utilized features."
        )
    )
    def get_feature_adoption(params: GetFeatureAdoptionParams) -> str:
        from collections import defaultdict
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        # Aggregate across all records per user (latest snapshot per user_login)
        user_latest: dict[str, dict] = {}
        feature_totals: dict[str, dict] = defaultdict(lambda: {"interactions": 0, "generations": 0, "acceptances": 0})

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                login = r.get("user_login", "")
                if params.user and login != params.user:
                    continue
                # Keep latest record per user
                if login not in user_latest or r.get("day", "") > user_latest[login].get("day", ""):
                    user_latest[login] = {**r, "_org": org}

                # Accumulate feature totals
                for feat in r.get("totals_by_feature", []):
                    fname = feat.get("feature", "unknown")
                    feature_totals[fname]["interactions"] += feat.get("user_initiated_interaction_count", 0) or 0
                    feature_totals[fname]["generations"] += feat.get("code_generation_activity_count", 0) or 0
                    feature_totals[fname]["acceptances"] += feat.get("code_acceptance_activity_count", 0) or 0

        if not user_latest:
            return json.dumps({"error": "No matching user data found."})

        total_users = len(user_latest)
        used_chat = sum(1 for u in user_latest.values() if u.get("used_chat"))
        used_agent = sum(1 for u in user_latest.values() if u.get("used_agent"))
        used_cli = sum(1 for u in user_latest.values() if u.get("used_cli"))
        used_coding_agent = sum(1 for u in user_latest.values() if u.get("used_copilot_coding_agent"))
        used_cloud_agent = sum(1 for u in user_latest.values() if u.get("used_copilot_cloud_agent"))

        def pct(n: int) -> float:
            return round(n / total_users * 100, 1) if total_users > 0 else 0.0

        adoption = {
            "total_users_in_report": total_users,
            "feature_adoption": {
                "chat": {"users": used_chat, "adoption_pct": pct(used_chat)},
                "agent_mode": {"users": used_agent, "adoption_pct": pct(used_agent)},
                "cli": {"users": used_cli, "adoption_pct": pct(used_cli)},
                "copilot_coding_agent": {"users": used_coding_agent, "adoption_pct": pct(used_coding_agent)},
                "copilot_cloud_agent": {"users": used_cloud_agent, "adoption_pct": pct(used_cloud_agent)},
            },
            "feature_engagement": {
                fname: {
                    "total_interactions": v["interactions"],
                    "total_generations": v["generations"],
                    "total_acceptances": v["acceptances"],
                }
                for fname, v in sorted(feature_totals.items(), key=lambda x: -x[1]["generations"])
            },
        }
        return json.dumps(adoption)

    @define_tool(
        description=(
            "Get Lines of Code (LoC) productivity metrics from Copilot usage data. "
            "Shows loc_suggested_to_add vs loc_added (actual acceptance of suggestions) per user. "
            "A high acceptance ratio means the user is effectively using Copilot-generated code. "
            "Returns top N users by lines added, plus org-level totals."
        )
    )
    def get_loc_metrics(params: GetLocMetricsParams) -> str:
        from collections import defaultdict
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        user_agg: dict[str, dict] = defaultdict(lambda: {
            "loc_suggested": 0, "loc_added": 0,
            "loc_suggested_delete": 0, "loc_deleted": 0, "org": "",
        })

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                login = r.get("user_login", "")
                if not login:
                    continue
                u = user_agg[login]
                u["loc_suggested"] += r.get("loc_suggested_to_add_sum", 0) or 0
                u["loc_added"] += r.get("loc_added_sum", 0) or 0
                u["loc_suggested_delete"] += r.get("loc_suggested_to_delete_sum", 0) or 0
                u["loc_deleted"] += r.get("loc_deleted_sum", 0) or 0
                u["org"] = org

        if not user_agg:
            return json.dumps({"error": "No LoC data found."})

        users_sorted = sorted(user_agg.items(), key=lambda x: -x[1]["loc_added"])
        top_users = []
        for login, v in users_sorted[:params.top_n]:
            suggested = v["loc_suggested"]
            added = v["loc_added"]
            top_users.append({
                "user": login,
                "org": v["org"],
                "loc_suggested_to_add": suggested,
                "loc_added": added,
                "acceptance_ratio_pct": round(added / suggested * 100, 1) if suggested > 0 else 0.0,
                "loc_suggested_to_delete": v["loc_suggested_delete"],
                "loc_deleted": v["loc_deleted"],
            })

        total_suggested = sum(v["loc_suggested"] for v in user_agg.values())
        total_added = sum(v["loc_added"] for v in user_agg.values())
        return json.dumps({
            "totals": {
                "total_users": len(user_agg),
                "total_loc_suggested_to_add": total_suggested,
                "total_loc_added": total_added,
                "overall_acceptance_ratio_pct": round(total_added / total_suggested * 100, 1) if total_suggested > 0 else 0.0,
            },
            "top_users_by_loc_added": top_users,
        })

    @define_tool(
        description=(
            "Get IDE/editor distribution of Copilot usage. Shows which IDEs (VSCode, IntelliJ, "
            "Vim/Neovim, etc.) are being used, their relative usage share, and engagement metrics "
            "per editor. Useful for understanding the developer tooling landscape and targeting "
            "training or support efforts."
        )
    )
    def get_ide_distribution(params: GetIdeDistributionParams) -> str:
        from collections import defaultdict
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        ide_agg: dict[str, dict] = defaultdict(lambda: {
            "users": set(), "interactions": 0, "generations": 0,
            "acceptances": 0, "loc_suggested": 0, "loc_added": 0,
        })

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                login = r.get("user_login", "")
                for ide_entry in r.get("totals_by_ide", []):
                    ide = ide_entry.get("ide", "unknown")
                    agg = ide_agg[ide]
                    agg["users"].add(login)
                    agg["interactions"] += ide_entry.get("user_initiated_interaction_count", 0) or 0
                    agg["generations"] += ide_entry.get("code_generation_activity_count", 0) or 0
                    agg["acceptances"] += ide_entry.get("code_acceptance_activity_count", 0) or 0
                    agg["loc_suggested"] += ide_entry.get("loc_suggested_to_add_sum", 0) or 0
                    agg["loc_added"] += ide_entry.get("loc_added_sum", 0) or 0

        if not ide_agg:
            return json.dumps({"error": "No IDE distribution data found."})

        total_users = len({u for v in ide_agg.values() for u in v["users"]})
        result = []
        for ide, v in sorted(ide_agg.items(), key=lambda x: -len(x[1]["users"])):
            n_users = len(v["users"])
            result.append({
                "ide": ide,
                "unique_users": n_users,
                "share_pct": round(n_users / total_users * 100, 1) if total_users > 0 else 0.0,
                "total_interactions": v["interactions"],
                "total_generations": v["generations"],
                "total_acceptances": v["acceptances"],
                "loc_suggested": v["loc_suggested"],
                "loc_added": v["loc_added"],
            })

        return json.dumps({"total_users": total_users, "ide_breakdown": result})

    @define_tool(
        description=(
            "Get Copilot model usage breakdown from user-level data. Shows which AI models are being "
            "used for which features (code_completion, chat, agent, etc.), including interaction counts "
            "and code generation activity per model. Helps identify model adoption trends and "
            "which models drive the most engagement."
        )
    )
    def get_model_usage(params: GetModelUsageParams) -> str:
        from collections import defaultdict
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        model_feature_agg: dict[tuple, dict] = defaultdict(lambda: {
            "users": set(), "interactions": 0, "generations": 0, "acceptances": 0,
        })

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                login = r.get("user_login", "")
                for entry in r.get("totals_by_model_feature", []):
                    model = entry.get("model", "unknown")
                    feature = entry.get("feature", "unknown")
                    key = (model, feature)
                    agg = model_feature_agg[key]
                    agg["users"].add(login)
                    agg["interactions"] += entry.get("user_initiated_interaction_count", 0) or 0
                    agg["generations"] += entry.get("code_generation_activity_count", 0) or 0
                    agg["acceptances"] += entry.get("code_acceptance_activity_count", 0) or 0

        if not model_feature_agg:
            return json.dumps({
                "warning": "No per-model breakdown data found. This field is only populated when users explicitly select a non-default model.",
                "model_breakdown": [],
            })

        # Roll up by model
        model_rollup: dict[str, dict] = defaultdict(lambda: {
            "total_users": set(), "total_interactions": 0, "total_generations": 0, "features": [],
        })
        for (model, feature), v in sorted(model_feature_agg.items(), key=lambda x: -x[1]["generations"]):
            m = model_rollup[model]
            m["total_users"].update(v["users"])
            m["total_interactions"] += v["interactions"]
            m["total_generations"] += v["generations"]
            m["features"].append({
                "feature": feature,
                "unique_users": len(v["users"]),
                "interactions": v["interactions"],
                "generations": v["generations"],
            })

        breakdown = []
        for model, v in sorted(model_rollup.items(), key=lambda x: -x[1]["total_generations"]):
            breakdown.append({
                "model": model,
                "unique_users": len(v["total_users"]),
                "total_interactions": v["total_interactions"],
                "total_generations": v["total_generations"],
                "by_feature": v["features"],
            })

        return json.dumps({"model_breakdown": breakdown})

    @define_tool(
        description=(
            "Get programming language adoption metrics for Copilot. Shows which languages "
            "get the most Copilot suggestions, acceptance rates per language, and which features "
            "(code_completion, chat, agent) are used with each language. "
            "Helps identify where Copilot is most/least effective across the codebase."
        )
    )
    def get_language_adoption(params: GetLanguageAdoptionParams) -> str:
        from collections import defaultdict
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        lang_agg: dict[str, dict] = defaultdict(lambda: {
            "generations": 0, "acceptances": 0, "loc_suggested": 0, "loc_added": 0,
            "features": defaultdict(int),
        })

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                for entry in r.get("totals_by_language_feature", []):
                    lang = entry.get("language", "unknown")
                    feature = entry.get("feature", "unknown")
                    agg = lang_agg[lang]
                    agg["generations"] += entry.get("code_generation_activity_count", 0) or 0
                    agg["acceptances"] += entry.get("code_acceptance_activity_count", 0) or 0
                    agg["loc_suggested"] += entry.get("loc_suggested_to_add_sum", 0) or 0
                    agg["loc_added"] += entry.get("loc_added_sum", 0) or 0
                    agg["features"][feature] += entry.get("code_generation_activity_count", 0) or 0

        if not lang_agg:
            return json.dumps({"error": "No language adoption data found."})

        langs_sorted = sorted(lang_agg.items(), key=lambda x: -x[1]["generations"])
        result = []
        for lang, v in langs_sorted[:params.top_n]:
            gen = v["generations"]
            acc = v["acceptances"]
            result.append({
                "language": lang,
                "total_generations": gen,
                "total_acceptances": acc,
                "acceptance_rate_pct": round(acc / gen * 100, 1) if gen > 0 else 0.0,
                "loc_suggested": v["loc_suggested"],
                "loc_added": v["loc_added"],
                "by_feature": dict(sorted(v["features"].items(), key=lambda x: -x[1])),
            })

        return json.dumps({"top_languages": result, "total_languages": len(lang_agg)})

    @define_tool(
        description=(
            "Get Copilot CLI token usage statistics from usage data. "
            "Shows output tokens, prompt tokens, and average tokens per request for each user "
            "who uses the Copilot CLI. Token data is only available for CLI usage (not IDE). "
            "Useful for understanding CLI workload and identifying heavy token consumers."
        )
    )
    def get_cli_token_usage(params: GetCliTokenUsageParams) -> str:
        from collections import defaultdict
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        user_agg: dict[str, dict] = defaultdict(lambda: {
            "output_tokens": 0, "prompt_tokens": 0,
            "request_count": 0, "session_count": 0, "prompt_count": 0,
            "days_active": 0, "org": "",
        })

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                cli = r.get("totals_by_cli")
                if not cli:
                    continue
                login = r.get("user_login", "")
                if not login:
                    continue
                u = user_agg[login]
                token_usage = cli.get("token_usage", {})
                u["output_tokens"] += token_usage.get("output_tokens_sum", 0) or 0
                u["prompt_tokens"] += token_usage.get("prompt_tokens_sum", 0) or 0
                u["request_count"] += cli.get("request_count", 0) or 0
                u["session_count"] += cli.get("session_count", 0) or 0
                u["prompt_count"] += cli.get("prompt_count", 0) or 0
                u["days_active"] += 1
                u["org"] = org

        if not user_agg:
            return json.dumps({"message": "No CLI token usage data found. CLI token data is only recorded when users use the Copilot CLI."})

        total_output = sum(v["output_tokens"] for v in user_agg.values())
        total_prompt = sum(v["prompt_tokens"] for v in user_agg.values())
        total_requests = sum(v["request_count"] for v in user_agg.values())

        users_sorted = sorted(user_agg.items(), key=lambda x: -(x[1]["output_tokens"] + x[1]["prompt_tokens"]))
        top_users = []
        for login, v in users_sorted[:params.top_n]:
            total_tokens = v["output_tokens"] + v["prompt_tokens"]
            top_users.append({
                "user": login,
                "org": v["org"],
                "output_tokens": v["output_tokens"],
                "prompt_tokens": v["prompt_tokens"],
                "total_tokens": total_tokens,
                "request_count": v["request_count"],
                "session_count": v["session_count"],
                "prompt_count": v["prompt_count"],
                "days_active": v["days_active"],
                "avg_tokens_per_request": round(total_tokens / v["request_count"], 0) if v["request_count"] > 0 else 0,
            })

        return json.dumps({
            "totals": {
                "cli_users": len(user_agg),
                "total_output_tokens": total_output,
                "total_prompt_tokens": total_prompt,
                "total_tokens": total_output + total_prompt,
                "total_requests": total_requests,
            },
            "top_users_by_tokens": top_users,
        })

    @define_tool(
        description=(
            "Get day-by-day usage trends over the 28-day reporting period. "
            "Shows how key metrics change over time: daily active users (DAU), "
            "code generation count, acceptance count, lines of code added, "
            "and user-initiated interactions. Use this to spot adoption trends, "
            "dips, or spikes in Copilot usage. Metric options: 'all', 'dau', "
            "'generations', 'acceptances', 'loc_added', 'interactions'."
        )
    )
    def get_usage_trends(params: GetUsageTrendsParams) -> str:
        from collections import defaultdict
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        day_agg: dict[str, dict] = defaultdict(lambda: {
            "dau": set(), "generations": 0, "acceptances": 0,
            "loc_added": 0, "interactions": 0,
        })

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                day = r.get("day", "")[:10]
                if not day:
                    continue
                login = r.get("user_login", "")
                agg = day_agg[day]
                if login and (r.get("code_generation_activity_count", 0) or 0) > 0:
                    agg["dau"].add(login)
                agg["generations"] += r.get("code_generation_activity_count", 0) or 0
                agg["acceptances"] += r.get("code_acceptance_activity_count", 0) or 0
                agg["loc_added"] += r.get("loc_added_sum", 0) or 0
                agg["interactions"] += r.get("user_initiated_interaction_count", 0) or 0

        if not day_agg:
            return json.dumps({"error": "No trend data found."})

        metric = params.metric.lower()
        trend = []
        for day in sorted(day_agg.keys()):
            v = day_agg[day]
            row: dict = {"day": day}
            if metric in ("all", "dau"):
                row["dau"] = len(v["dau"])
            if metric in ("all", "generations"):
                row["generations"] = v["generations"]
            if metric in ("all", "acceptances"):
                row["acceptances"] = v["acceptances"]
            if metric in ("all", "loc_added"):
                row["loc_added"] = v["loc_added"]
            if metric in ("all", "interactions"):
                row["interactions"] = v["interactions"]
            if metric not in ("all", "dau", "generations", "acceptances", "loc_added", "interactions"):
                return json.dumps({"error": f"Unknown metric '{metric}'. Valid options: all, dau, generations, acceptances, loc_added, interactions."})
            trend.append(row)

        # Summary stats
        if trend:
            dau_vals = [d.get("dau", 0) for d in trend]
            summary = {
                "period_days": len(trend),
                "date_range": {"start": trend[0]["day"], "end": trend[-1]["day"]},
            }
            if metric in ("all", "dau"):
                summary["avg_dau"] = round(sum(dau_vals) / len(dau_vals), 1)
                summary["peak_dau"] = max(dau_vals)
                summary["peak_dau_day"] = trend[dau_vals.index(max(dau_vals))]["day"]
        else:
            summary = {}

        return json.dumps({"summary": summary, "daily_trend": trend})

    @define_tool(
        description=(
            "Get day-by-day activity timeline for a specific user over the 28-day period. "
            "Shows which days the user was active, what features they used each day, "
            "lines of code suggested and added, and whether they used chat/agent/CLI. "
            "Useful for understanding individual usage patterns and identifying dormant users."
        )
    )
    def get_user_activity_timeline(params: GetUserActivityTimelineParams) -> str:
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        user_records = []
        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                if r.get("user_login", "") == params.user:
                    user_records.append({**r, "_org": org})

        if not user_records:
            return json.dumps({"error": f"No data found for user '{params.user}'. Check the username and ensure data has been synced."})

        user_records.sort(key=lambda r: r.get("day", ""))

        timeline = []
        total_gen = total_acc = total_loc_added = total_loc_suggested = 0
        active_days = 0
        features_used: set = set()

        for r in user_records:
            gen = r.get("code_generation_activity_count", 0) or 0
            acc = r.get("code_acceptance_activity_count", 0) or 0
            loc_added = r.get("loc_added_sum", 0) or 0
            loc_suggested = r.get("loc_suggested_to_add_sum", 0) or 0
            interactions = r.get("user_initiated_interaction_count", 0) or 0
            is_active = gen > 0 or interactions > 0

            if is_active:
                active_days += 1
            total_gen += gen
            total_acc += acc
            total_loc_added += loc_added
            total_loc_suggested += loc_suggested

            day_features = []
            if r.get("used_chat"):
                day_features.append("chat")
                features_used.add("chat")
            if r.get("used_agent"):
                day_features.append("agent")
                features_used.add("agent")
            if r.get("used_cli"):
                day_features.append("cli")
                features_used.add("cli")
            if r.get("used_copilot_coding_agent"):
                day_features.append("coding_agent")
                features_used.add("coding_agent")
            if r.get("used_copilot_cloud_agent"):
                day_features.append("cloud_agent")
                features_used.add("cloud_agent")

            timeline.append({
                "day": r.get("day", "")[:10],
                "active": is_active,
                "generations": gen,
                "acceptances": acc,
                "loc_suggested": loc_suggested,
                "loc_added": loc_added,
                "interactions": interactions,
                "features_used": day_features,
            })

        report_start = user_records[0].get("report_start_day", timeline[0]["day"] if timeline else "")
        report_end = user_records[0].get("report_end_day", timeline[-1]["day"] if timeline else "")

        return json.dumps({
            "user": params.user,
            "org": user_records[0].get("_org", ""),
            "report_period": {"start": report_start, "end": report_end},
            "summary": {
                "total_days_in_report": len(timeline),
                "active_days": active_days,
                "inactive_days": len(timeline) - active_days,
                "total_generations": total_gen,
                "total_acceptances": total_acc,
                "acceptance_rate_pct": round(total_acc / total_gen * 100, 1) if total_gen > 0 else 0.0,
                "total_loc_suggested": total_loc_suggested,
                "total_loc_added": total_loc_added,
                "features_ever_used": sorted(features_used),
            },
            "daily_timeline": timeline,
        })

    @define_tool(
        description=(
            "Detect dormant users: Copilot seat holders who were active in the first half of the "
            "reporting period but stopped using Copilot in the second half. "
            "Also detects new adopters (appeared only in second half). "
            "Use this to identify who needs re-engagement vs who is just getting started. "
            "Optionally specify a split_day to define the boundary between early and late period."
        )
    )
    def get_dormant_users(params: GetDormantUsersParams) -> str:
        if params.org:
            raw = collector.load_latest("usage_users", params.org)
            all_raw = {params.org: raw} if raw else {}
        else:
            all_raw = collector.load_all_latest("usage_users")

        if not all_raw:
            return json.dumps({"error": "No user usage data found. Try fetch_org_users_usage_report to get live data."})

        # Collect all days and user activity per day
        day_user_active: dict[str, set] = {}
        user_org: dict[str, str] = {}

        for org, data in all_raw.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                day = r.get("day", "")[:10]
                login = r.get("user_login", "")
                if not day or not login:
                    continue
                if day not in day_user_active:
                    day_user_active[day] = set()
                if (r.get("code_generation_activity_count", 0) or 0) > 0 or \
                   (r.get("user_initiated_interaction_count", 0) or 0) > 0:
                    day_user_active[day].add(login)
                user_org[login] = org

        if not day_user_active:
            return json.dumps({"error": "No daily activity data found."})

        all_days = sorted(day_user_active.keys())
        if params.split_day and params.split_day in all_days:
            split = params.split_day
        else:
            split = all_days[len(all_days) // 2]

        early_days = [d for d in all_days if d <= split]
        late_days = [d for d in all_days if d > split]

        early_active = set().union(*(day_user_active.get(d, set()) for d in early_days))
        late_active = set().union(*(day_user_active.get(d, set()) for d in late_days))

        dormant = sorted(early_active - late_active)
        new_adopters = sorted(late_active - early_active)
        consistently_active = sorted(early_active & late_active)

        return json.dumps({
            "period": {"start": all_days[0], "end": all_days[-1], "split_at": split},
            "early_period": {"days": len(early_days), "active_users": len(early_active)},
            "late_period": {"days": len(late_days), "active_users": len(late_active)},
            "dormant_users": [{"user": u, "org": user_org.get(u, "")} for u in dormant],
            "dormant_count": len(dormant),
            "new_adopters": [{"user": u, "org": user_org.get(u, "")} for u in new_adopters],
            "new_adopters_count": len(new_adopters),
            "consistently_active_count": len(consistently_active),
        })

    @define_tool(
        description=(
            "Find Copilot seat holders who have NEVER used Copilot — no activity recorded "
            "in any usage data. These seats are pure waste: the license is paid but the user "
            "has never engaged. Cross-references seat assignments with usage data. "
            "Returns the list of never-used users with seat creation date and cost impact."
        )
    )
    def get_never_used_seats(params: GetNeverUsedSeatsParams) -> str:
        if params.org:
            seats_data = collector.load_latest("seats", params.org)
            all_seats = {params.org: seats_data} if seats_data else {}
            usage_data = collector.load_latest("usage_users", params.org)
            all_usage = {params.org: usage_data} if usage_data else {}
            billing_data = collector.load_latest("billing", params.org)
            all_billing = {params.org: billing_data} if billing_data else {}
        else:
            all_seats = collector.load_all_latest("seats")
            all_usage = collector.load_all_latest("usage_users")
            all_billing = collector.load_all_latest("billing")

        if not all_seats:
            return json.dumps({"error": "No seat data found. Please sync data first."})

        # Build set of users who appear in usage data (ever generated/interacted)
        ever_active: set[str] = set()
        for org, data in all_usage.items():
            records = data.get("records", data) if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for r in records:
                if (r.get("code_generation_activity_count", 0) or 0) > 0 or \
                   (r.get("user_initiated_interaction_count", 0) or 0) > 0:
                    ever_active.add(r.get("user_login", ""))

        never_used = []
        for org, data in all_seats.items():
            seats_list = data.get("seats", []) if isinstance(data, dict) else []
            billing = all_billing.get(org, {})
            price = billing.get("_detected_price_per_seat", 19.0) if billing else 19.0

            for seat in seats_list:
                login = seat.get("assignee", {}).get("login", "")
                if not login:
                    continue
                # Never used = not in usage data AND no last_activity_at
                if login not in ever_active and not seat.get("last_activity_at"):
                    never_used.append({
                        "user": login,
                        "org": org,
                        "seat_created_at": seat.get("created_at", ""),
                        "plan_type": seat.get("plan_type", ""),
                        "monthly_cost": price,
                    })

        total_waste = sum(u["monthly_cost"] for u in never_used)
        return json.dumps({
            "never_used_count": len(never_used),
            "total_monthly_waste": round(total_waste, 2),
            "annual_waste": round(total_waste * 12, 2),
            "never_used_seats": sorted(never_used, key=lambda x: x.get("seat_created_at", "")),
        })

    tools = [
        get_usage_report, get_users_usage_report, get_metrics_detail,
        get_premium_request_usage, get_user_premium_usage,
        get_feature_adoption, get_loc_metrics, get_ide_distribution,
        get_model_usage, get_language_adoption,
        get_cli_token_usage, get_usage_trends, get_user_activity_timeline,
        get_dormant_users, get_never_used_seats,
    ]

    # --- Live fetch tools (require api_manager) ---

    if api_manager:
        @define_tool(
            description=(
                "Fetch LIVE org-level Copilot usage report directly from GitHub API. "
                "Provide a specific day (YYYY-MM-DD) to get a 1-day report, or leave day empty "
                "for the latest 28-day report. The report contains aggregated usage statistics "
                "for various Copilot features, user engagement data, and feature adoption metrics. "
                "Data available from Oct 10, 2025 onward."
            )
        )
        def fetch_org_usage_report(params: FetchOrgUsageReportParams) -> str:
            api = api_manager.get_api_for_org(params.org)
            if not api:
                return json.dumps({"error": f"No API client for org '{params.org}'."})

            loop = asyncio.get_event_loop()
            if params.day:
                result = loop.run_until_complete(
                    api.get_org_usage_report_1day(params.org, params.day)
                )
            else:
                result = loop.run_until_complete(
                    api.get_org_usage_report_28day(params.org)
                )

            if not result:
                return json.dumps({"error": f"No usage report available for org '{params.org}'.", "hint": "Ensure the org has the Copilot usage metrics policy enabled."})

            # Cache the result
            collector._save_json("usage", params.org, result)
            return json.dumps(result, default=str)

        @define_tool(
            description=(
                "Fetch LIVE user-level Copilot usage report directly from GitHub API. "
                "Provide a specific day (YYYY-MM-DD) to get a 1-day report, or leave day empty "
                "for the latest 28-day report. Contains per-user engagement statistics, "
                "individual feature usage patterns, and adoption metrics broken down by user. "
                "Data available from Oct 10, 2025 onward."
            )
        )
        def fetch_org_users_usage_report(params: FetchOrgUsersUsageReportParams) -> str:
            api = api_manager.get_api_for_org(params.org)
            if not api:
                return json.dumps({"error": f"No API client for org '{params.org}'."})

            loop = asyncio.get_event_loop()
            if params.day:
                result = loop.run_until_complete(
                    api.get_org_users_usage_report_1day(params.org, params.day)
                )
            else:
                result = loop.run_until_complete(
                    api.get_org_users_usage_report_28day(params.org)
                )

            if not result:
                return json.dumps({"error": f"No user-level usage report available for org '{params.org}'.", "hint": "Ensure the org has the Copilot usage metrics policy enabled."})

            # Cache the result
            collector._save_json("usage_users", params.org, result)
            return json.dumps(result, default=str)

        @define_tool(
            description=(
                "Fetch LIVE Copilot premium request usage directly from GitHub API. "
                "Shows per-model breakdown of premium request consumption including "
                "model names (GPT-5.2, Claude Opus 4.6, etc.), request counts, "
                "pricing ($0.04/request), gross/discount/net amounts. "
                "Optionally specify year and month to query historical data (up to 24 months)."
            )
        )
        def fetch_premium_request_usage(params: FetchPremiumRequestUsageParams) -> str:
            api = api_manager.get_api_for_org(params.org)
            if not api:
                return json.dumps({"error": f"No API client for org '{params.org}'."})

            loop = asyncio.get_event_loop()
            result = loop.run_until_complete(
                api.get_premium_request_usage(
                    params.org,
                    year=params.year if params.year else None,
                    month=params.month if params.month else None,
                )
            )

            if not result:
                return json.dumps({"error": f"No premium request data for org '{params.org}'.", "hint": "Ensure the PAT has 'Administration' org permission (read)."})

            # Cache the result
            collector._save_json("premium_requests", params.org, result)
            return json.dumps(result, default=str)

        tools.extend([fetch_org_usage_report, fetch_org_users_usage_report, fetch_premium_request_usage])

        # --- Enterprise-level live fetch tools ---

        @define_tool(
            description=(
                "Fetch LIVE enterprise-level Copilot usage report directly from GitHub API. "
                "Aggregates usage data across ALL organizations in the enterprise. "
                "Provide a specific day (YYYY-MM-DD) for a 1-day report, or leave empty "
                "for the latest 28-day report. Use this for enterprise-wide FinOps analysis. "
                "Data available from Oct 10, 2025 onward."
            )
        )
        def fetch_enterprise_usage_report(params: FetchEnterpriseUsageReportParams) -> str:
            api = api_manager.get_api_for_enterprise(params.enterprise)
            if not api:
                return json.dumps({"error": f"No API client for enterprise '{params.enterprise}'."})

            loop = asyncio.get_event_loop()
            if params.day:
                result = loop.run_until_complete(
                    api.get_enterprise_usage_report_1day(params.enterprise, params.day)
                )
            else:
                result = loop.run_until_complete(
                    api.get_enterprise_usage_report_28day(params.enterprise)
                )

            if not result:
                return json.dumps({
                    "error": f"No enterprise usage report available for '{params.enterprise}'.",
                    "hint": "Ensure the enterprise has the Copilot usage metrics policy enabled and the PAT has 'read:enterprise' scope.",
                })

            collector._save_json("usage", f"enterprise_{params.enterprise}", result)
            return json.dumps(result, default=str)

        @define_tool(
            description=(
                "Fetch LIVE enterprise-level per-user Copilot usage report directly from GitHub API. "
                "Returns usage data for every user across ALL organizations in the enterprise. "
                "Provide a specific day (YYYY-MM-DD) for a 1-day report, or leave empty "
                "for the latest 28-day report. Essential for enterprise-wide user analysis. "
                "Data available from Oct 10, 2025 onward."
            )
        )
        def fetch_enterprise_users_usage_report(params: FetchEnterpriseUsersUsageReportParams) -> str:
            api = api_manager.get_api_for_enterprise(params.enterprise)
            if not api:
                return json.dumps({"error": f"No API client for enterprise '{params.enterprise}'."})

            loop = asyncio.get_event_loop()
            if params.day:
                result = loop.run_until_complete(
                    api.get_enterprise_users_usage_report_1day(params.enterprise, params.day)
                )
            else:
                result = loop.run_until_complete(
                    api.get_enterprise_users_usage_report_28day(params.enterprise)
                )

            if not result:
                return json.dumps({
                    "error": f"No enterprise user usage report available for '{params.enterprise}'.",
                    "hint": "Ensure the enterprise has the Copilot usage metrics policy enabled and the PAT has 'read:enterprise' scope.",
                })

            collector._save_json("usage_users", f"enterprise_{params.enterprise}", result)
            return json.dumps(result, default=str)

        tools.extend([fetch_enterprise_usage_report, fetch_enterprise_users_usage_report])

    return tools
