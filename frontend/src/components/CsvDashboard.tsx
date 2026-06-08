import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from "recharts";
import { useI18n } from "../contexts/I18nContext";
import { useUIState } from "../contexts/UIStateContext";
import { useCsvDashboard } from "../hooks/useData";
import type { PremiumCsvSection, UsageReportSection, ApiUsageSection, ApiPremiumSection } from "../types";
import { InfoIcon, ChartTitle } from "./InfoIcon";
import { exportCSV } from "../utils/export";

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f778ba", "#79c0ff", "#56d364"];
const TOOLTIP_STYLE = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

interface Props {
  refreshKey: number;
  tab: "premium" | "usage";
}

/* ---------- Multi-select Dropdown ---------- */
function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isAll = selected.length === 0;
  const triggerLabel = isAll ? label : selected.length === 1 ? selected[0] : `${selected.length} / ${options.length}`;

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  return (
    <div className="org-dropdown" ref={ref} style={{ minWidth: 140 }}>
      <button className="org-dropdown-trigger" onClick={() => setOpen((o) => !o)}>
        <span>{triggerLabel}</span>
        <span className="org-dropdown-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="org-dropdown-menu">
          <label className={`org-dropdown-item ${isAll ? "org-dropdown-item-active" : ""}`}>
            <input type="checkbox" checked={isAll} onChange={() => onChange([])} />
            <span>{label}</span>
          </label>
          <div className="org-dropdown-divider" />
          {options.map((opt) => (
            <label key={opt} className={`org-dropdown-item ${selected.includes(opt) ? "org-dropdown-item-active" : ""}`}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Collapsible Section ---------- */
function Section({ sectionKey, title, infoKey, defaultOpen = true, children }: {
  sectionKey: string; title: string; infoKey?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const { dashboardSections, patch } = useUIState();
  const open = dashboardSections[`csv_${sectionKey}`] ?? defaultOpen;
  const toggle = useCallback(() => {
    patch({ dashboardSections: { ...dashboardSections, [`csv_${sectionKey}`]: !open } });
  }, [patch, dashboardSections, sectionKey, open]);
  return (
    <div className="dash-section">
      <div className="dash-section-header" onClick={toggle}>
        <span className="dash-section-chevron">{open ? "▼" : "▶"}</span>
        <h3 className="dash-section-title">{title}</h3>
        {infoKey && <InfoIcon id={infoKey} />}
      </div>
      {open && <div className="dash-section-body">{children}</div>}
    </div>
  );
}

/* ---------- API Premium fallback content ---------- */
function ApiPremiumContent({ data }: { data: ApiPremiumSection }) {
  const { t } = useI18n();
  const isActivity = data.source === "activity";
  const isAiCredits = data.source === "ai_credits";
  const hasBillingContext = isActivity && data.billing_models && data.billing_models.length > 0;

  // Build pie chart data for cost distribution (billing mode only)
  const billingModels = !isActivity ? data.models : (data.billing_models ?? []);
  const pieData = billingModels
    .filter((m) => m.gross_amount > 0)
    .map((m, i) => ({ name: m.model, value: m.gross_amount, color: COLORS[i % COLORS.length] }));

  return (
    <>
      <div className="dashboard-notice" style={{ marginBottom: 12, padding: "8px 14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{isActivity ? t("csvDash.apiModelActivitySource") : t("csvDash.apiDataSource")}</span>
        <InfoIcon id="csv_section_apiPremiumKpi" />
      </div>
      <div className="dashboard-kpi">
        {isActivity ? (
          <>
            <div className="stat-card">
              <div className="stat-value">{data.net_requests.toLocaleString()}</div>
              <div className="stat-label">{t("dashboard.interactions")}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{(data.total_requests - data.net_requests).toLocaleString()}</div>
              <div className="stat-label">{t("dashboard.codeGen")}</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-value">{Math.round(data.total_requests).toLocaleString()}</div>
              <div className="stat-label">{isAiCredits ? "AI Credits (Gross)" : t("csvDash.totalRequests")}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{Math.round(data.net_requests).toLocaleString()}</div>
              <div className="stat-label">{isAiCredits ? "Overage Credits" : t("csvDash.netRequests")}</div>
            </div>
            <div className="stat-card cost">
              <div className="stat-value cost">${data.total_cost.toFixed(2)}</div>
              <div className="stat-label">{isAiCredits ? "Chi phí vượt pool" : t("csvDash.totalCost")}</div>
            </div>
          </>
        )}
        <div className="stat-card">
          <div className="stat-value">{data.models.length}</div>
          <div className="stat-label">{t("csvDash.uniqueModels")}</div>
        </div>
      </div>

      <Section sectionKey="apiPremiumModels" title={t("csvDash.modelBreakdown")} infoKey="csv_section_apiPremiumModels">
        <div className="dashboard-charts">
          {/* Pie chart — cost distribution (billing mode or org context) */}
          {pieData.length > 0 && (
            <div className="chart-card">
              <ChartTitle text={`${t("csvDash.costByModel")}${hasBillingContext ? " (toàn tổ chức)" : ""}`} infoKey="csv_chart_apiPremiumCostByModel" />
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={52}
                    paddingAngle={2}
                    label={({ name, percent }) => `${(name ?? "").length > 18 ? (name ?? "").slice(0, 16) + "…" : (name ?? "")} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: any) => `$${Number(v).toFixed(2)}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Horizontal bar chart — activity (group-filtered) */}
          {isActivity && data.models.length > 0 && (
            <div className={pieData.length > 0 ? "chart-card" : "chart-card chart-card-wide"}>
              <ChartTitle text={t("monitor.modelActivity")} infoKey="csv_section_apiPremiumModels" />
              <ResponsiveContainer width="100%" height={Math.max(200, data.models.length * 44)}>
                <BarChart data={data.models} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="model" type="category" width={190} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => Math.round(Number(v)).toLocaleString()} />
                  <Bar dataKey="interactions" name={t("dashboard.interactions")} fill="#bc8cff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="code_gen" name={t("dashboard.codeGen")} fill="#58a6ff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="code_accept" name={t("dashboard.codeAccept")} fill="#3fb950" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Horizontal bar chart — billing requests (org-level or direct billing) */}
          {!isActivity && (
            <div className={pieData.length > 0 ? "chart-card" : "chart-card chart-card-wide"}>
              <ChartTitle text={t("csvDash.requestsByModel")} infoKey="csv_section_apiPremiumModels" />
              {data.models.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(200, data.models.length * 44)}>
                  <BarChart data={data.models} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <YAxis dataKey="model" type="category" width={190} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v: any, name?: string) =>
                        name?.toLowerCase().includes("cost") ? `$${Number(v).toFixed(2)}` : Math.round(Number(v)).toLocaleString()
                      }
                    />
                    <Bar dataKey="gross_qty" name={t("csvDash.totalRequests")} fill="#bc8cff" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="gross_amount" name={t("csvDash.grossAmount")} fill="#58a6ff" radius={[0, 4, 4, 0]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
            </div>
          )}

          {/* Org-level billing request chart when group filter is active */}
          {hasBillingContext && billingModels.length > 0 && (
            <div className="chart-card chart-card-wide">
              <ChartTitle text={`${t("csvDash.requestsByModel")} (toàn tổ chức)`} infoKey="csv_section_apiPremiumModels" />
              <ResponsiveContainer width="100%" height={Math.max(200, billingModels.length * 44)}>
                <BarChart data={billingModels} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="model" type="category" width={190} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: any, name?: string) =>
                      name?.toLowerCase().includes("cost") ? `$${Number(v).toFixed(2)}` : Math.round(Number(v)).toLocaleString()
                    }
                  />
                  <Bar dataKey="gross_qty" name={t("csvDash.totalRequests")} fill="#bc8cff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="gross_amount" name={t("csvDash.grossAmount")} fill="#58a6ff" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Org-level billing KPI when group filter is active */}
        {hasBillingContext && (
          <div className="dashboard-kpi" style={{ marginTop: 12 }}>
            <div className="stat-card" style={{ opacity: 0.8 }}>
              <div className="stat-value" style={{ fontSize: 18 }}>{Math.round(data.billing_total_requests ?? 0).toLocaleString()}</div>
              <div className="stat-label">{t("csvDash.totalRequests")} (tổ chức)</div>
            </div>
            <div className="stat-card cost" style={{ opacity: 0.8 }}>
              <div className="stat-value cost" style={{ fontSize: 18 }}>${(data.billing_total_cost ?? 0).toFixed(2)}</div>
              <div className="stat-label">{t("csvDash.totalCost")} (tổ chức)</div>
            </div>
            <div className="stat-card" style={{ opacity: 0.8 }}>
              <div className="stat-value" style={{ fontSize: 18 }}>{billingModels.length}</div>
              <div className="stat-label">{t("csvDash.uniqueModels")} (tổ chức)</div>
            </div>
          </div>
        )}
      </Section>

      {/* Per-user breakdown (billing mode) */}
      {!isActivity && data.users && data.users.length > 0 && (() => {
        const hasBilling = data.users.some(u => u.source === "billing" && u.quota != null);
        return (
          <Section sectionKey="apiPremiumUsers" title={t("csvDash.userTable")} infoKey="csv_section_apiPremiumUsers">
            <div className="dashboard-charts">
              <div className="chart-card chart-card-wide">
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                  ℹ️ {hasBilling ? t("csvDash.premiumUserNoteBilling") : t("csvDash.premiumUserNote")}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  <button className="btn btn-small" onClick={() => exportCSV("premium-users-activity", data.users!)}>⬇ CSV</button>
                </div>
                <div className="dashboard-table-wrap">
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t("csvDash.user")}</th>
                        <th>{t("monitor.topModel")}</th>
                        <th>{isAiCredits ? "AI Credits" : t("csvDash.totalRequests")}</th>
                        {hasBilling && <th>{t("csvDash.quota")}</th>}
                        {hasBilling
                          ? <th style={{ minWidth: 160 }}>{t("csvDash.quotaUsage")}</th>
                          : <th style={{ minWidth: 140 }}>% {t("monitor.total")}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((u, i) => {
                        const quotaPct = u.quota_pct ?? u.pct;
                        const barColor = (u.quota_pct ?? 0) >= 90 ? "#f85149"
                          : (u.quota_pct ?? 0) >= 70 ? "#e3b341" : "#bc8cff";
                        return (
                          <tr key={u.user}>
                            <td className="rank">{i + 1}</td>
                            <td className="user-name">{u.user}</td>
                            <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.top_model || "—"}</td>
                            <td>{(u.activity ?? u.gross_credits ?? 0).toLocaleString()}</td>
                            {hasBilling && <td style={{ fontSize: 11 }}>{u.quota?.toLocaleString() ?? "—"}</td>}
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, minWidth: 80 }}>
                                  <div style={{
                                    width: `${Math.min(quotaPct, 100)}%`, height: "100%",
                                    background: barColor, borderRadius: 3,
                                  }} />
                                </div>
                                <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>{quotaPct.toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Section>
        );
      })()}
    </>
  );
}

/* ---------- API Usage Activity fallback content ---------- */
function ApiUsageContent({ data }: { data: ApiUsageSection }) {
  const { t } = useI18n();

  const totalInteractions = data.users.reduce((s, u) => s + u.interactions, 0);
  const totalCodeGen = data.users.reduce((s, u) => s + u.code_gen, 0);
  const totalLocSuggested = data.users.reduce((s, u) => s + u.loc_suggested, 0);
  const totalActivity = totalInteractions + totalCodeGen;
  const avgAcceptRate = data.users.length > 0
    ? (data.users.reduce((s, u) => s + u.acceptance_rate, 0) / data.users.length).toFixed(1)
    : "0";

  // Sort by total activity descending
  const sortedUsers = [...data.users].sort(
    (a, b) => (b.interactions + b.code_gen) - (a.interactions + a.code_gen)
  );

  // Top 15 for bar chart with % of total
  const topUsers = sortedUsers.slice(0, 15).map((u) => ({
    ...u,
    total: u.interactions + u.code_gen,
    pct: totalActivity > 0 ? ((u.interactions + u.code_gen) / totalActivity * 100) : 0,
  }));

  // IDE distribution aggregated across all users
  const ideMap: Record<string, number> = {};
  for (const u of data.users) {
    for (const ide of u.ides) {
      ideMap[ide.ide] = (ideMap[ide.ide] || 0) + ide.count;
    }
  }
  const ideData = Object.entries(ideMap)
    .map(([ide, count], i) => ({ ide, count, color: COLORS[i % COLORS.length] }))
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <div className="dashboard-notice" style={{ marginBottom: 12, padding: "8px 14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{t("csvDash.apiActivitySource")}{data.date_range?.start && ` · ${data.date_range.start} → ${data.date_range.end}`}</span>
        <InfoIcon id="csv_section_apiUsageKpi" />
      </div>
      <div className="dashboard-kpi">
        <div className="stat-card">
          <div className="stat-value">{data.total_users}</div>
          <div className="stat-label">{t("csvDash.uniqueUsers")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalInteractions.toLocaleString()}</div>
          <div className="stat-label">{t("dashboard.interactions")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalCodeGen.toLocaleString()}</div>
          <div className="stat-label">{t("dashboard.codeGen")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalLocSuggested.toLocaleString()}</div>
          <div className="stat-label">{t("dashboard.locSuggested")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgAcceptRate}%</div>
          <div className="stat-label">{t("dashboard.acceptRate")}</div>
        </div>
      </div>

      {/* Top users bar chart + IDE pie chart */}
      <Section sectionKey="apiUsageCharts" title={t("monitor.userActivity")} defaultOpen={true} infoKey="csv_section_apiUsageCharts">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            <ChartTitle text={t("monitor.topUsers")} infoKey="csv_section_apiUsageCharts" />
            {topUsers.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(220, topUsers.length * 44)}>
                <BarChart data={topUsers} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="user" type="category" width={150} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: any, name?: string, props?: any) => {
                      const val = Math.round(Number(v)).toLocaleString();
                      const pct = props?.payload?.pct != null ? ` (${props.payload.pct.toFixed(1)}% total)` : "";
                      return [`${val}${name === t("dashboard.codeGen") ? pct : ""}`, name];
                    }}
                  />
                  <Bar dataKey="interactions" name={t("dashboard.interactions")} stackId="a" fill="#bc8cff" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="code_gen" name={t("dashboard.codeGen")} stackId="a" fill="#58a6ff" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>

          {ideData.length > 1 && (
            <div className="chart-card">
              <ChartTitle text="IDE Distribution" infoKey="csv_section_apiUsageCharts" />
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={ideData}
                    dataKey="count"
                    nameKey="ide"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    innerRadius={48}
                    paddingAngle={2}
                    label={({ name, percent }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {ideData.map((entry) => (
                      <Cell key={entry.ide} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => Number(v).toLocaleString()} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Section>

      <Section sectionKey="apiUsageUsers" title={t("csvDash.userTable")} infoKey="csv_section_apiUsageUsers">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {sortedUsers.length > 0 ? (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  <button className="btn btn-small" onClick={() => exportCSV("api-usage-users", sortedUsers)}>⬇ CSV</button>
                </div>
                <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("csvDash.user")}</th>
                      <th>{t("csvDash.org")}</th>
                      <th>{t("dashboard.interactions")}</th>
                      <th>{t("dashboard.codeGen")}</th>
                      <th style={{ minWidth: 130 }}>% {t("monitor.total")}</th>
                      <th>{t("dashboard.codeAccept")}</th>
                      <th>{t("dashboard.locSuggested")}</th>
                      <th>{t("dashboard.daysActive")}</th>
                      <th>{t("dashboard.acceptRate")}</th>
                      <th>IDEs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedUsers.map((u, i) => {
                      const userTotal = u.interactions + u.code_gen;
                      const pct = totalActivity > 0 ? (userTotal / totalActivity * 100) : 0;
                      return (
                        <tr key={u.user}>
                          <td className="rank">{i + 1}</td>
                          <td className="user-name">{u.user}</td>
                          <td>{u.org}</td>
                          <td>{u.interactions.toLocaleString()}</td>
                          <td>{u.code_gen.toLocaleString()}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{
                                flex: 1, height: 6, background: "var(--border)", borderRadius: 3, minWidth: 60,
                              }}>
                                <div style={{
                                  width: `${Math.min(pct, 100)}%`, height: "100%",
                                  background: "#58a6ff", borderRadius: 3,
                                }} />
                              </div>
                              <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td>{u.code_accept.toLocaleString()}</td>
                          <td>{u.loc_suggested.toLocaleString()}</td>
                          <td>{u.days_active}</td>
                          <td>{u.acceptance_rate}%</td>
                          <td className="model-tags">
                            {u.ides.slice(0, 2).map((ide) => (
                              <span key={ide.ide} className="dash-badge dash-badge-muted">
                                {ide.ide}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>
    </>
  );
}

/* ---------- Premium CSV content ---------- */
function PremiumContent({ data, apiData }: { data: PremiumCsvSection; apiData?: ApiPremiumSection }) {
  const { t } = useI18n();

  if (!data.has_data) {
    if (apiData?.has_data) return <ApiPremiumContent data={apiData} />;
    return <div className="dashboard-empty">{t("csvDash.noDataType")}</div>;
  }

  return (
    <>
      <div className="dashboard-kpi">
        <div className="stat-card">
          <div className="stat-value">{data.kpi.total_requests.toLocaleString()}</div>
          <div className="stat-label">{t("csvDash.totalRequests")}</div>
        </div>
        <div className="stat-card cost">
          <div className="stat-value cost">${data.kpi.total_cost.toFixed(2)}</div>
          <div className="stat-label">{t("csvDash.totalCost")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.kpi.unique_users}</div>
          <div className="stat-label">{t("csvDash.uniqueUsers")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.kpi.unique_orgs}</div>
          <div className="stat-label">{t("csvDash.uniqueOrgs")}</div>
        </div>
      </div>

      <Section sectionKey="premiumTrend" title={t("csvDash.dailyTrend")} infoKey="csv_section_premiumTrend">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {data.daily_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.daily_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="requests" name="Requests" stroke="#bc8cff" fill="#bc8cff" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="active_users" name="Active Users" stroke="#3fb950" fill="#3fb950" fillOpacity={0.15} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>

      <Section sectionKey="premiumBreakdowns" title={t("csvDash.modelBreakdown")} infoKey="csv_section_premiumBreakdowns">
        <div className="dashboard-charts">
          <div className="chart-card">
            <ChartTitle text={t("csvDash.modelBreakdown")} infoKey="csv_chart_modelBreakdown" />
            {data.model_breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={data.model_breakdown} dataKey="requests" nameKey="model"
                    cx="50%" cy="50%" outerRadius={80}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${(name || "").split(":").pop()?.trim() || name} ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={false}>
                    {data.model_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
          <div className="chart-card">
            <ChartTitle text={t("csvDash.orgBreakdown")} infoKey="csv_chart_orgBreakdown" />
            {data.org_breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, data.org_breakdown.length * 36)}>
                <BarChart data={data.org_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="org" type="category" width={120} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="requests" name="Requests" fill="#58a6ff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="user_count" name="Users" fill="#3fb950" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
          <div className="chart-card">
            <ChartTitle text={t("dashboard.costCenterBreakdown")} infoKey="csv_chart_costCenter" />
            {data.cost_center_breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, data.cost_center_breakdown.length * 36)}>
                <BarChart data={data.cost_center_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="cost_center" type="category" width={140} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, name?: string) => name === "amount" ? `$${Number(v).toFixed(2)}` : v} />
                  <Bar dataKey="requests" name="Requests" fill="#bc8cff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="user_count" name="Users" fill="#58a6ff" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>

      <Section sectionKey="premiumUsers" title={t("csvDash.userTable")} infoKey="csv_section_premiumUsers">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {data.users.length > 0 ? (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  <button className="btn btn-small" onClick={() => exportCSV("premium-users", data.users)}>⬇ CSV</button>
                </div>
                <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("csvDash.user")}</th>
                      <th>{t("csvDash.org")}</th>
                      <th>{t("csvDash.costCenter")}</th>
                      <th>{t("csvDash.requests")}</th>
                      <th>{t("csvDash.grossAmount")}</th>
                      <th>{t("csvDash.quota")}</th>
                      <th>{t("csvDash.quotaUsage")}</th>
                      <th>{t("csvDash.daysActive")}</th>
                      <th>{t("csvDash.models")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u, i) => (
                      <tr key={u.user}>
                        <td className="rank">{i + 1}</td>
                        <td className="user-name">{u.user}</td>
                        <td>{u.org}</td>
                        <td>{u.cost_center || "—"}</td>
                        <td>{u.requests.toLocaleString()}</td>
                        <td>${u.gross_amount.toFixed(2)}</td>
                        <td>{u.quota.toLocaleString()}</td>
                        <td>
                          <div className="quota-bar-wrap">
                            <div className="quota-bar">
                              <div
                                className={`quota-bar-fill ${u.usage_pct > 80 ? "danger" : u.usage_pct > 50 ? "warning" : "success"}`}
                                style={{ width: `${Math.min(u.usage_pct, 100)}%` }}
                              />
                            </div>
                            <span className="quota-bar-label">{u.usage_pct}%</span>
                          </div>
                        </td>
                        <td>{u.days_active}</td>
                        <td className="model-tags">
                          {u.models.slice(0, 3).map((m) => (
                            <span key={m.model} className="dash-badge dash-badge-muted">
                              {m.model.split(":").pop()?.trim()}: {m.requests}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>

      <PremiumUserModelChart data={data} />
    </>
  );
}

/* ---------- Premium User×Model Chart + Table ---------- */
function PremiumUserModelChart({ data }: { data: PremiumCsvSection }) {
  const { t } = useI18n();

  if (!data.users || data.users.length === 0) return null;

  // Collect all unique model names (shortened)
  const allModels = useMemo(() => {
    const set = new Set<string>();
    data.users.forEach((u) => u.models.forEach((m) => set.add(m.model)));
    return Array.from(set);
  }, [data.users]);

  // Build chart data: one entry per user with a key per model
  const chartData = useMemo(() => {
    const TOP = 20; // limit to top 20 users by total requests
    const sorted = [...data.users].sort((a, b) => b.requests - a.requests).slice(0, TOP);
    return sorted.map((u) => {
      const entry: Record<string, string | number> = {
        user: u.user.split("@")[0], // show login only
      };
      allModels.forEach((m) => {
        const found = u.models.find((x) => x.model === m);
        entry[m] = found ? found.requests : 0;
      });
      return entry;
    });
  }, [data.users, allModels]);

  // Build cross-tab table: rows = users, columns = models
  const tableData = useMemo(() => {
    return [...data.users]
      .sort((a, b) => b.requests - a.requests)
      .map((u) => ({
        user: u.user,
        org: u.org,
        total: u.requests,
        models: allModels.map((m) => {
          const found = u.models.find((x) => x.model === m);
          return found ? found.requests : 0;
        }),
      }));
  }, [data.users, allModels]);

  const shortModel = (m: string) => m.split(":").pop()?.trim() || m;

  return (
    <>
      <Section sectionKey="premiumUserModelChart" title={t("csvDash.userModelChart")} infoKey="csv_section_premiumUserModelChart">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 36)}>
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="user" type="category" width={130} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  {allModels.map((m, i) => (
                    <Bar key={m} dataKey={m} name={shortModel(m)} stackId="stack"
                      fill={COLORS[i % COLORS.length]} radius={i === allModels.length - 1 ? [0, 4, 4, 0] : undefined} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => shortModel(String(v))} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>

      <Section sectionKey="premiumUserModelTable" title={t("csvDash.userModelTable")} infoKey="csv_section_premiumUserModelTable">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {tableData.length > 0 ? (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  <button className="btn btn-small" onClick={() => {
                    const rows = tableData.map((u) => ({
                      user: u.user, org: u.org, total: u.total,
                      ...Object.fromEntries(allModels.map((m, i) => [shortModel(m), u.models[i]])),
                    }));
                    exportCSV("premium-user-model", rows);
                  }}>⬇ CSV</button>
                </div>
                <div className="dashboard-table-wrap">
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t("csvDash.user")}</th>
                        <th>{t("csvDash.org")}</th>
                        <th>{t("csvDash.total")}</th>
                        {allModels.map((m) => (
                          <th key={m} title={m}>{shortModel(m)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.map((u, i) => (
                        <tr key={u.user}>
                          <td className="rank">{i + 1}</td>
                          <td className="user-name">{u.user}</td>
                          <td>{u.org}</td>
                          <td><strong>{u.total.toLocaleString()}</strong></td>
                          {u.models.map((cnt, j) => (
                            <td key={j} style={{ color: cnt > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                              {cnt > 0 ? cnt.toLocaleString() : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>
    </>
  );
}

/* ---------- Usage Report content ---------- */
function UsageContent({ data, apiData }: { data: UsageReportSection; apiData?: ApiUsageSection }) {
  const { t } = useI18n();

  if (!data.has_data) {
    if (apiData?.has_data) return <ApiUsageContent data={apiData} />;
    if (apiData?.scope_filtered) return <div className="dashboard-empty">{t("csvDash.noDataGroup")}</div>;
    return <div className="dashboard-empty">{t("csvDash.noDataType")}</div>;
  }

  return (
    <>
      <div className="dashboard-kpi">
        <div className="stat-card cost">
          <div className="stat-value cost">${data.kpi.total_gross.toFixed(2)}</div>
          <div className="stat-label">{t("csvDash.totalGross")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${data.kpi.total_net.toFixed(2)}</div>
          <div className="stat-label">{t("csvDash.totalNet")}</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-value warning">${data.kpi.total_discount.toFixed(2)}</div>
          <div className="stat-label">{t("csvDash.totalDiscount")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.kpi.unique_users}</div>
          <div className="stat-label">{t("csvDash.uniqueUsers")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.kpi.unique_orgs}</div>
          <div className="stat-label">{t("csvDash.uniqueOrgs")}</div>
        </div>
      </div>

      <Section sectionKey="usageTrend" title={t("csvDash.dailyTrend")} infoKey="csv_section_usageTrend">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {data.daily_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.daily_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => `$${Number(v).toFixed(4)}`} />
                  <Area type="monotone" dataKey="gross_amount" name="Gross" stroke="#58a6ff" fill="#58a6ff" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="net_amount" name="Net" stroke="#3fb950" fill="#3fb950" fillOpacity={0.15} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>

      <Section sectionKey="usageBreakdowns" title={`${t("csvDash.productBreakdown")} & ${t("csvDash.skuBreakdown")}`} infoKey="csv_section_usageBreakdowns">
        <div className="dashboard-charts">
          <div className="chart-card">
            <ChartTitle text={t("csvDash.productBreakdown")} infoKey="csv_chart_productBreakdown" />
            {data.product_breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(120, data.product_breakdown.length * 40)}>
                <BarChart data={data.product_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="product" type="category" width={80} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, name?: string) => name?.includes("amount") ? `$${Number(v).toFixed(4)}` : v} />
                  <Bar dataKey="gross_amount" name="Gross" fill="#58a6ff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="net_amount" name="Net" fill="#3fb950" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
          <div className="chart-card">
            <ChartTitle text={t("csvDash.skuBreakdown")} infoKey="csv_chart_skuBreakdown" />
            {data.sku_breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(160, data.sku_breakdown.length * 40)}>
                <BarChart data={data.sku_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="sku" type="category" width={180} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, name?: string) => name?.includes("amount") ? `$${Number(v).toFixed(4)}` : v} />
                  <Bar dataKey="gross_amount" name="Gross" fill="#d29922" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="net_amount" name="Net" fill="#bc8cff" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
          <div className="chart-card">
            <ChartTitle text={t("csvDash.orgBreakdown")} infoKey="csv_chart_orgBreakdown2" />
            {data.org_breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(160, data.org_breakdown.length * 36)}>
                <BarChart data={data.org_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="org" type="category" width={120} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, name?: string) => name?.includes("amount") ? `$${Number(v).toFixed(4)}` : v} />
                  <Bar dataKey="gross_amount" name="Gross" fill="#58a6ff" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
          <div className="chart-card">
            <ChartTitle text={t("dashboard.costCenterBreakdown")} infoKey="csv_chart_costCenter2" />
            {data.cost_center_breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(160, data.cost_center_breakdown.length * 36)}>
                <BarChart data={data.cost_center_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="cost_center" type="category" width={140} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, name?: string) => name?.includes("amount") ? `$${Number(v).toFixed(4)}` : v} />
                  <Bar dataKey="gross_amount" name="Gross" fill="#bc8cff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="net_amount" name="Net" fill="#f778ba" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>

      <Section sectionKey="usageUsers" title={t("csvDash.userTable")} infoKey="csv_section_usageUsers">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {data.users.length > 0 ? (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  <button className="btn btn-small" onClick={() => exportCSV("usage-report-users", data.users)}>⬇ CSV</button>
                </div>
                <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("csvDash.user")}</th>
                      <th>{t("csvDash.org")}</th>
                      <th>{t("csvDash.costCenter")}</th>
                      <th>{t("csvDash.grossAmount")}</th>
                      <th>{t("csvDash.netAmount")}</th>
                      <th>{t("csvDash.quantity")}</th>
                      <th>{t("csvDash.daysActive")}</th>
                      <th>{t("csvDash.skus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u, i) => (
                      <tr key={u.user}>
                        <td className="rank">{i + 1}</td>
                        <td className="user-name">{u.user}</td>
                        <td>{u.org}</td>
                        <td>{u.cost_center || "—"}</td>
                        <td>${u.gross_amount.toFixed(4)}</td>
                        <td>${u.net_amount.toFixed(4)}</td>
                        <td>{u.quantity.toFixed(4)}</td>
                        <td>{u.days_active}</td>
                        <td className="model-tags">
                          {u.skus.slice(0, 3).map((s) => (
                            <span key={s.sku} className="dash-badge dash-badge-muted">
                              {s.sku}: ${s.amount.toFixed(2)}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            ) : <div className="chart-empty">{t("csvDash.noData")}</div>}
          </div>
        </div>
      </Section>
    </>
  );
}

/* ---------- Main CSV Dashboard ---------- */
export function CsvDashboard({ refreshKey, tab }: Props) {
  const { t } = useI18n();
  const ui = useUIState();

  const orgs = ui.csvDashOrgs;
  const costCenters = ui.csvDashCostCenters;
  const products = ui.csvDashProducts;
  const setProducts = useCallback((v: string[]) => ui.patch({ csvDashProducts: v }), [ui.patch]);
  const skus = ui.csvDashSkus;
  const setSkus = useCallback((v: string[]) => ui.patch({ csvDashSkus: v }), [ui.patch]);
  const dateFrom = ui.csvDashDateFrom;
  const setDateFrom = useCallback((v: string) => ui.patch({ csvDashDateFrom: v }), [ui.patch]);
  const dateTo = ui.csvDashDateTo;
  const setDateTo = useCallback((v: string) => ui.patch({ csvDashDateTo: v }), [ui.patch]);

  // Default date range: billing cycle (1st of month → today)
  const defaultDateRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { start: fmt(from), end: fmt(to) };
  }, []);

  const params = useMemo(() => ({
    orgs, costCenters, products, skus, dateFrom, dateTo,
    groupId: ui.selectedGroupId,
  }), [orgs.join(","), costCenters.join(","), products.join(","), skus.join(","), dateFrom, dateTo, ui.selectedGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading } = useCsvDashboard(params);

  const hasAnyData = data && (
    data.premium_csv?.has_data || data.usage_report?.has_data ||
    data.api_usage?.has_data || data.api_premium?.has_data
  );

  const activeDateRange = useMemo(() => {
    if (!data) return null;
    const section = tab === "premium" ? data.premium_csv : data.usage_report;
    return section?.has_data ? section.date_range : null;
  }, [data, tab]);

  return (
    <div className="dashboard" key={`${refreshKey}-${tab}`}>
      {/* Left-aligned filters */}
      <div className="dashboard-filters">
        <div className="dashboard-filter-group">
          <label>{t("csvDash.filters")}:</label>
          {data && (
            <>
              {tab === "usage" && (
                <>
                  <MultiSelect
                    label={t("csvDash.allProducts")}
                    options={data.filters.products}
                    selected={products}
                    onChange={setProducts}
                  />
                  <MultiSelect
                    label={t("csvDash.allSkus")}
                    options={data.filters.skus}
                    selected={skus}
                    onChange={setSkus}
                  />
                </>
              )}
            </>
          )}
        </div>
        <div className="dashboard-filter-group">
          <input
            type="date"
            className="dashboard-date-input"
            value={dateFrom || activeDateRange?.start || defaultDateRange.start}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className="dashboard-date-sep">—</span>
          <input
            type="date"
            className="dashboard-date-input"
            value={dateTo || activeDateRange?.end || defaultDateRange.end}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {loading && !data && <div className="dashboard-loading">{t("loading")}</div>}
      {!loading && !hasAnyData && <div className="dashboard-empty">{t("csvDash.noData")}</div>}

      {data && (
        tab === "premium"
          ? <PremiumContent data={data.premium_csv} apiData={data.api_premium} />
          : <UsageContent data={data.usage_report} apiData={data.api_usage} />
      )}
    </div>
  );
}
