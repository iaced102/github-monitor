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
          <InfoIcon
            id="kpi_overview_total_seats"
            extraContent={
              overview.plan_breakdown && overview.plan_breakdown.length > 0 ? (
                <div className="info-modal-breakdown">
                  <h4 className="info-modal-section-title">📋 Chi tiết theo plan</h4>
                  <table className="info-metrics-table">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Tổng</th>
                        <th>Active (30d)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.plan_breakdown.map(p => (
                        <tr key={p.plan}>
                          <td><span className={`plan-badge plan-${p.plan}`}>{p.plan}</span></td>
                          <td>{p.seats} users</td>
                          <td className="info-metric-example">{p.active} active</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(overview.pending_cancellation ?? 0) > 0 && (
                    <div className="info-modal-tip" style={{ marginTop: "0.5rem" }}>
                      <span className="info-tip-icon">⏳</span>
                      <span>{overview.pending_cancellation} users có seat Business cũ đang chờ hủy cuối chu kỳ billing (đã nâng cấp lên Enterprise, vẫn dùng bình thường)</span>
                    </div>
                  )}
                </div>
              ) : undefined
            }
          />
          <div className="stat-value">{overview.total_seats}</div>
          <div className="stat-label">{t("sidebar.totalSeats")}</div>
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
          <InfoIcon
            id="kpi_overview_monthly_cost"
            extraContent={
              overview.plan_breakdown && overview.plan_breakdown.length > 0 ? (
                <div className="info-modal-breakdown">
                  <h4 className="info-modal-section-title">📋 Chi tiết theo plan</h4>
                  <table className="info-metrics-table">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Seats</th>
                        <th>Đơn giá</th>
                        <th>Chi phí/tháng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.plan_breakdown.map(p => (
                        <tr key={p.plan}>
                          <td><span className={`plan-badge plan-${p.plan}`}>{p.plan}</span></td>
                          <td>{p.seats} users</td>
                          <td>${p.price_per_seat}/user</td>
                          <td className="info-metric-example">${p.monthly_cost.toLocaleString()}/tháng</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
                        <td colSpan={3}>Tổng</td>
                        <td className="info-metric-example">${overview.monthly_cost.toLocaleString()}/tháng</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="info-modal-tip" style={{ marginTop: "0.5rem" }}>
                    <span className="info-tip-icon">⚠️</span>
                    <span>Chi phí thực tế có thể khác nếu có discount hoặc proration giữa chu kỳ billing.</span>
                  </div>
                </div>
              ) : undefined
            }
          />
          <div className="stat-value">${overview.monthly_cost.toLocaleString()}</div>
          <div className="stat-label">{t("sidebar.monthlyCost")}</div>
        </div>
        <div className="stat-card danger">
          <InfoIcon
            id="kpi_overview_monthly_waste"
            extraContent={
              overview.plan_breakdown && overview.plan_breakdown.some(p => p.inactive > 0) ? (
                <div className="info-modal-breakdown">
                  <h4 className="info-modal-section-title">📋 Chi tiết theo plan</h4>
                  <table className="info-metrics-table">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Inactive</th>
                        <th>Đơn giá</th>
                        <th>Lãng phí/tháng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.plan_breakdown.map(p => (
                        <tr key={p.plan}>
                          <td><span className={`plan-badge plan-${p.plan}`}>{p.plan}</span></td>
                          <td>{p.inactive} users</td>
                          <td>${p.price_per_seat}/user</td>
                          <td className="info-metric-example">${(p.inactive * p.price_per_seat).toLocaleString()}/tháng</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
                        <td colSpan={3}>Tổng lãng phí</td>
                        <td className="info-metric-example">${overview.monthly_waste.toLocaleString()}/tháng</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="info-modal-tip" style={{ marginTop: "0.5rem" }}>
                    <span className="info-tip-icon">💡</span>
                    <span>Thu hồi {overview.total_inactive_seats} inactive seat{overview.total_inactive_seats !== 1 ? "s" : ""} để tiết kiệm ${overview.monthly_waste.toLocaleString()}/tháng (${(overview.monthly_waste * 12).toLocaleString()}/năm).</span>
                  </div>
                </div>
              ) : undefined
            }
          />
          <div className="stat-value">${overview.monthly_waste.toLocaleString()}</div>
          <div className="stat-label">{t("sidebar.monthlyWaste")}</div>
        </div>
      </div>
    </div>
  );
}
