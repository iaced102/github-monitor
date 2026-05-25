"""
Copilot billing and cost analysis tools for the AI engine.
"""

import json
from datetime import datetime, timezone as tz
from pydantic import BaseModel, Field

from copilot import define_tool

from ..services.data_collector import DataCollector
from ..config import AIC_INCLUDED_PER_USER, AIC_PROMO_PER_USER, AIC_PROMO_START, AIC_PROMO_END, AIC_VALUE_USD


class GetCostOverviewParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


class CalculateROIParams(BaseModel):
    org: str = Field(default="", description="Organization name. Leave empty for all orgs.")


def create_billing_tools(collector: DataCollector) -> list:
    """Create billing tools bound to a specific DataCollector instance."""

    @define_tool(description="Get cost overview for Copilot across organizations. Shows total seats, active seats, wasted seats, monthly cost, estimated waste, and GitHub AI Credits (AIC) pool status (new billing model from June 1, 2026).")
    def get_cost_overview(params: GetCostOverviewParams) -> str:
        # Get orgs from billing data; fall back to seats data if billing unavailable
        billing_orgs = list(collector.load_all_latest("billing").keys())
        seats_orgs = list(collector.load_all_latest("seats").keys())
        orgs_to_check = [params.org] if params.org else (billing_orgs or seats_orgs)
        overview = []

        now = datetime.now(tz.utc)
        in_promo = AIC_PROMO_START <= now.strftime("%Y-%m-%d") < AIC_PROMO_END

        for org in orgs_to_check:
            billing = collector.load_latest("billing", org)
            seats_data = collector.load_latest("seats", org)
            usage_data = collector.load_latest("usage_users", org)

            if not billing and not seats_data:
                continue

            price = 39.0
            plan_type = "business"
            total = 0
            active = 0
            pending_cancel = 0

            if billing:
                price = billing.get("_detected_price_per_seat", 39.0)
                plan_type = billing.get("_detected_plan_type", "business")
                seat_breakdown = billing.get("seat_breakdown", {})
                total = seat_breakdown.get("total", 0)
                active = seat_breakdown.get("active_this_cycle", 0)
                pending_cancel = seat_breakdown.get("pending_cancellation", 0)
            elif seats_data:
                # Fallback: derive from seats data when billing is unavailable
                seats = seats_data.get("seats", [])
                total = seats_data.get("total_seats", len(seats))
                for s in seats:
                    last = s.get("last_activity_at")
                    if last:
                        try:
                            d = (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).days
                            if d < 30:
                                active += 1
                        except (ValueError, TypeError):
                            pass

            inactive = total - active
            monthly_cost = total * price
            waste_cost = inactive * price

            # AIC pool calculation
            rate_map = AIC_PROMO_PER_USER if in_promo else AIC_INCLUDED_PER_USER
            credits_per_user = rate_map.get(plan_type, AIC_INCLUDED_PER_USER["business"])
            aic_pool_total = total * credits_per_user
            aic_consumed = 0.0
            aic_cost = 0.0
            if usage_data:
                records = usage_data.get("records", usage_data) if isinstance(usage_data, dict) else usage_data
                if isinstance(records, list):
                    for r in records:
                        aic_consumed += float(r.get("aic_quantity") or 0)
                        aic_cost += float(r.get("aic_gross_amount") or 0)

            aic_remaining = max(0.0, aic_pool_total - aic_consumed)
            aic_util_pct = round(aic_consumed / aic_pool_total * 100, 1) if aic_pool_total > 0 else 0.0

            overview.append({
                "org": org,
                "plan_type": plan_type,
                # Legacy per-seat billing (pre June 1, 2026)
                "price_per_seat": price,
                "total_seats": total,
                "active_seats": active,
                "inactive_seats": inactive,
                "pending_cancellation": pending_cancel,
                "monthly_cost": monthly_cost,
                "estimated_monthly_waste": waste_cost,
                "utilization_pct": round(active / total * 100, 1) if total > 0 else 0,
                "billing_data_available": billing is not None,
                # New AIC billing (from June 1, 2026)
                "aic_billing": {
                    "promotional_period": in_promo,
                    "credits_per_user_per_month": credits_per_user,
                    "pool_total_aic": aic_pool_total,
                    "pool_total_usd": round(aic_pool_total * AIC_VALUE_USD, 2),
                    "consumed_aic": round(aic_consumed, 2),
                    "consumed_usd": round(aic_cost, 4),
                    "remaining_aic": round(aic_remaining, 2),
                    "remaining_usd": round(aic_remaining * AIC_VALUE_USD, 2),
                    "utilization_pct": aic_util_pct,
                },
            })

        grand_total_cost = sum(o["monthly_cost"] for o in overview)
        grand_total_waste = sum(o["estimated_monthly_waste"] for o in overview)
        grand_aic_pool = sum(o["aic_billing"]["pool_total_aic"] for o in overview)
        grand_aic_consumed = sum(o["aic_billing"]["consumed_aic"] for o in overview)

        return json.dumps({
            "organizations": overview,
            # Legacy billing totals
            "grand_total_monthly_cost": grand_total_cost,
            "grand_total_estimated_waste": grand_total_waste,
            "potential_annual_savings": grand_total_waste * 12,
            # AIC billing totals
            "aic_summary": {
                "billing_model": "GitHub AI Credits (AIC) — effective June 1, 2026",
                "aic_value": "1 AIC = $0.01 USD",
                "promotional_period_active": in_promo,
                "grand_pool_total_aic": grand_aic_pool,
                "grand_pool_total_usd": round(grand_aic_pool * AIC_VALUE_USD, 2),
                "grand_consumed_aic": round(grand_aic_consumed, 2),
                "grand_consumed_usd": round(grand_aic_consumed * AIC_VALUE_USD, 4),
                "grand_remaining_aic": round(max(0.0, grand_aic_pool - grand_aic_consumed), 2),
            },
        })

    @define_tool(description="Calculate ROI metrics for Copilot investment. Shows cost per active user, suggestions per dollar, and efficiency metrics.")
    def calculate_roi(params: CalculateROIParams) -> str:
        orgs_to_check = [params.org] if params.org else list(collector.load_all_latest("billing").keys())
        roi_data = []

        for org in orgs_to_check:
            billing = collector.load_latest("billing", org)
            usage_data = collector.load_latest("usage", org)

            if not billing:
                continue

            price = billing.get("_detected_price_per_seat", 19.0)
            seat_breakdown = billing.get("seat_breakdown", {})
            total = seat_breakdown.get("total", 0)
            active = seat_breakdown.get("active_this_cycle", 0)
            monthly_cost = total * price

            total_suggestions = 0
            total_acceptances = 0
            if usage_data and isinstance(usage_data, list):
                total_suggestions = sum(d.get("total_suggestions_count", 0) for d in usage_data)
                total_acceptances = sum(d.get("total_acceptances_count", 0) for d in usage_data)

            cost_per_active_user = monthly_cost / active if active > 0 else 0
            acceptance_rate = total_acceptances / total_suggestions * 100 if total_suggestions > 0 else 0

            roi_data.append({
                "org": org,
                "monthly_cost": monthly_cost,
                "total_seats": total,
                "active_seats": active,
                "cost_per_active_user": round(cost_per_active_user, 2),
                "total_suggestions": total_suggestions,
                "total_acceptances": total_acceptances,
                "acceptance_rate_pct": round(acceptance_rate, 1),
                "suggestions_per_dollar": round(total_suggestions / monthly_cost, 1) if monthly_cost > 0 else 0,
            })

        return json.dumps({"roi_by_org": roi_data})

    return [get_cost_overview, calculate_roi]
