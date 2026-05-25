import { useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";
import { useI18n } from "../contexts/I18nContext";
import { useUIState } from "../contexts/UIStateContext";
import { useRoiDashboard } from "../hooks/useData";
import { exportCSV } from "../utils/export";

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f778ba"];
const TOOLTIP_STYLE = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

interface Props { refreshKey: number }

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="dash-kpi-card">
      <div className="dash-kpi-label">{label}</div>
      <div className={`dash-kpi-value${accent ? " dash-kpi-accent" : ""}`}>{value}</div>
      {sub && <div className="dash-kpi-sub">{sub}</div>}
    </div>
  );
}

export function RoiDashboard({ refreshKey }: Props) {
  const { t } = useI18n();
  const ui = useUIState();
  const selectedOrgs = ui.dashboardSelectedOrgs ?? [];
  const { data, loading } = useRoiDashboard(selectedOrgs, ui.selectedGroupId);

  const exportUsers = useCallback(() => {
    if (!data?.top_users_by_acceptance) return;
    exportCSV("roi-users", data.top_users_by_acceptance);
  }, [data]);

  const hasData = data && (data.kpi?.active_users > 0 || data.daily_trend?.length > 0);

  return (
    <div className="dashboard" key={refreshKey}>
      {loading && !data && <div className="dashboard-loading">{t("loading")}</div>}
      {!loading && !hasData && <div className="dashboard-empty">{t("dashboard.noData")}</div>}

      {hasData && (
        <>
          {/* KPI Cards */}
          <div className="dash-kpi-row">
            <KpiCard
              label={t("roi.acceptanceRate")}
              value={`${data.kpi.acceptance_rate}%`}
              sub={`${data.kpi.total_code_accept.toLocaleString()} / ${data.kpi.total_code_gen.toLocaleString()} accepted`}
              accent
            />
            <KpiCard
              label={t("roi.locAcceptance")}
              value={(data.kpi.total_loc_accepted ?? 0).toLocaleString()}
              sub={t("roi.locAccepted")}
            />
            <KpiCard
              label={t("roi.activeUsers")}
              value={data.kpi.active_users}
              sub={`${t("roi.ofSeats").replace("{n}", String(data.kpi.total_seats))}`}
            />
            <KpiCard
              label={t("roi.costPerUser")}
              value={`$${data.kpi.cost_per_active_user}`}
              sub={`$${data.kpi.monthly_cost.toLocaleString()} ${t("roi.totalPerMonth")}`}
            />
          </div>

          {/* Acceptance Rate Trend */}
          {data.daily_trend?.length > 0 && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3 className="dash-section-title">{t("roi.trendTitle")}</h3>
              </div>
              <div className="dash-section-body">
                <div className="dashboard-charts">
                  <div className="chart-card chart-card-wide">
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={data.daily_trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={40} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v ?? 0}%`, t("roi.acceptanceRate")]} />
                        <Area type="monotone" dataKey="acceptance_rate" name={t("roi.acceptanceRate")}
                          stroke="#58a6ff" fill="rgba(88,166,255,0.2)" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="chart-card">
                    <div className="chart-title">{t("roi.dailyActivity")}</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={data.daily_trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={40} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Area type="monotone" dataKey="code_gen" name="Code Gen" stroke="#3fb950" fill="rgba(63,185,80,0.2)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="code_accept" name="Accepted" stroke="#58a6ff" fill="rgba(88,166,255,0.15)" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="chart-card">
                    <div className="chart-title">{t("roi.activeUsersDay")}</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={data.daily_trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={30} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Area type="monotone" dataKey="active_users" name={t("roi.activeUsers")} stroke="#d29922" fill="rgba(210,153,34,0.2)" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Top users by acceptance rate */}
          {data.top_users_by_acceptance?.length > 0 && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3 className="dash-section-title">{t("roi.topUsers")}</h3>
                <button className="btn btn-small" style={{ marginLeft: "auto" }} onClick={exportUsers}>⬇ CSV</button>
              </div>
              <div className="dash-section-body">
                <div className="dashboard-charts">
                  <div className="chart-card chart-card-wide">
                    {data.top_users_by_acceptance.length <= 15 ? (
                      <ResponsiveContainer width="100%" height={Math.max(180, data.top_users_by_acceptance.length * 28)}>
                        <BarChart data={data.top_users_by_acceptance} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                          <YAxis dataKey="user" type="category" width={110} tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v ?? 0}%`, t("roi.acceptanceRate")]} />
                          {data.top_users_by_acceptance.map((_: any, i: number) => (
                            <Bar key={i} dataKey="acceptance_rate" fill={COLORS[i % COLORS.length]} radius={[0, 4, 4, 0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="dashboard-table-wrap">
                        <table className="dashboard-table">
                          <thead>
                            <tr><th>#</th><th>User</th><th>{t("roi.acceptanceRate")}</th><th>Code Gen</th><th>Accepted</th><th>Interactions</th></tr>
                          </thead>
                          <tbody>
                            {data.top_users_by_acceptance.map((u: any, i: number) => (
                              <tr key={u.user}>
                                <td className="rank">{i + 1}</td>
                                <td className="user-name">{u.user}</td>
                                <td><strong>{u.acceptance_rate}%</strong></td>
                                <td>{u.code_gen.toLocaleString()}</td>
                                <td>{u.code_accept.toLocaleString()}</td>
                                <td>{u.interactions.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
