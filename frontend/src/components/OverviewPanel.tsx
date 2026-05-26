import { useOverview } from "../hooks/useData";
import { useI18n } from "../contexts/I18nContext";
import { useUIState } from "../contexts/UIStateContext";
import { InfoIcon } from "./InfoIcon";

export function OverviewPanel() {
  const ui = useUIState();
  const { overview, loading } = useOverview(ui.selectedGroupId);
  const { t } = useI18n();

  if (loading) {
    return <div className="sidebar-section loading">{t("loading")}</div>;
  }

  if (!overview) return null;

  return (
    <div className="sidebar-overview">
      <div className="overview-cards">
        <div className="stat-card">
          <InfoIcon id="kpi_overview_total_seats" />
          <div className="stat-value">{overview.total_seats}</div>
          <div className="stat-label">{t("sidebar.totalSeats")}</div>
          {overview.plan_breakdown && overview.plan_breakdown.length > 0 && (
            <div className="stat-breakdown">
              {overview.plan_breakdown.map(p => (
                <div key={p.plan} className="stat-breakdown-row">
                  <span className={`plan-badge plan-${p.plan}`}>{p.plan}</span>
                  <span>{p.seats} users</span>
                  <span className="active-count">{p.active} active</span>
                </div>
              ))}
              {(overview.pending_cancellation ?? 0) > 0 && (
                <div className="stat-breakdown-row pending-row">
                  <span>⏳ {overview.pending_cancellation} chờ hủy seat</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="stat-card">
          <InfoIcon id="kpi_overview_active_seats" />
          <div className="stat-value">{overview.total_active_seats}</div>
          <div className="stat-label">{t("sidebar.active")}</div>
        </div>
        <div className="stat-card warning">
          <InfoIcon id="kpi_overview_inactive_seats" />
          <div className="stat-value">{overview.total_inactive_seats}</div>
          <div className="stat-label">{t("sidebar.inactive")}</div>
        </div>
        <div className="stat-card">
          <InfoIcon id="kpi_overview_utilization" />
          <div className="stat-value">{overview.utilization_pct}%</div>
          <div className="stat-label">{t("sidebar.utilization")}</div>
        </div>
        <div className="stat-card cost">
          <InfoIcon id="kpi_overview_monthly_cost" />
          <div className="stat-value">${overview.monthly_cost.toLocaleString()}</div>
          <div className="stat-label">{t("sidebar.monthlyCost")}</div>
        </div>
        <div className="stat-card danger">
          <InfoIcon id="kpi_overview_monthly_waste" />
          <div className="stat-value">${overview.monthly_waste.toLocaleString()}</div>
          <div className="stat-label">{t("sidebar.monthlyWaste")}</div>
        </div>
      </div>
    </div>
  );
}
