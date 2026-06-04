import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { useI18n } from "../contexts/I18nContext";
import { useUIState } from "../contexts/UIStateContext";
import { useDashboard, useKpiTrend } from "../hooks/useData";
import { PeriodicReportButton } from "./PeriodicReportButton";
import { InfoIcon, ChartTitle } from "./InfoIcon";
import { UserDetailModal } from "./UserDetailModal";
import { exportCSV } from "../utils/export";

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f778ba", "#79c0ff", "#56d364"];
const TOOLTIP_STYLE = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

const FEATURE_NAME_MAP: Record<string, string> = {
  chat_panel_agent_mode: "Chat – Agent Mode",
  chat_panel_ask_mode: "Chat – Ask Mode",
  chat_panel_plan_mode: "Chat – Plan Mode",
  chat_panel_custom_mode: "Chat – Custom Mode",
  chat_panel_default: "Chat – Default",
  chat_panel_unknown_mode: "Chat – Unknown Mode",
  chat_inline: "Chat – Inline",
  copilot_cli: "Copilot CLI",
  agent_edit: "Agent Edit",
  code_completion: "Code Completions",
  code_completions: "Code Completions",
  inline_suggestions: "Inline Suggestions",
  pull_request_summaries: "Pull Request Summaries",
  code_review: "Code Review",
  test_generation: "Test Generation",
  explain_and_fix: "Explain & Fix",
  documentation: "Documentation",
};

interface Props {
  refreshKey: number;
}

/* ---------- Collapsible Section ---------- */
function Section({ sectionKey, title, infoKey, defaultOpen = true, children }: { sectionKey: string; title: string; infoKey?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const { dashboardSections, patch } = useUIState();
  const open = dashboardSections[sectionKey] ?? defaultOpen;
  const toggle = useCallback(() => {
    patch({ dashboardSections: { ...dashboardSections, [sectionKey]: !open } });
  }, [patch, dashboardSections, sectionKey, open]);
  return (
    <div className="dash-section">
      <div className="dash-section-header" onClick={toggle}>
        <span className="dash-section-chevron">{open ? "\u25BC" : "\u25B6"}</span>
        <h3 className="dash-section-title">{title}</h3>
        {infoKey && <InfoIcon id={infoKey} />}
      </div>
      {open && <div className="dash-section-body">{children}</div>}
    </div>
  );
}

/* ---------- Main Dashboard ---------- */
export function Dashboard({ refreshKey }: Props) {
  const { t } = useI18n();
  const ui = useUIState();
  const selectedOrgs = ui.dashboardSelectedOrgs;
  const setSelectedOrgs = useCallback((v: string[] | null | ((prev: string[] | null) => string[] | null)) => {
    const next = typeof v === "function" ? v(ui.dashboardSelectedOrgs) : v;
    ui.patch({ dashboardSelectedOrgs: next });
  }, [ui.patch, ui.dashboardSelectedOrgs]);
  const { data, loading } = useDashboard(selectedOrgs ?? [], ui.selectedGroupId);
  const { trend } = useKpiTrend(selectedOrgs ?? [], ui.selectedGroupId);
  const [drilldownUser, setDrilldownUser] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [seatFilterPlan, setSeatFilterPlan] = useState<string>("all");
  const [seatFilterStatus, setSeatFilterStatus] = useState<string>("all");
  const [seatSort, setSeatSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "", dir: "asc" });

  const dateFrom = ui.dashboardDateFrom;
  const setDateFrom = useCallback((v: string) => ui.patch({ dashboardDateFrom: v }), [ui.patch]);
  const dateTo = ui.dashboardDateTo;
  const setDateTo = useCallback((v: string) => ui.patch({ dashboardDateTo: v }), [ui.patch]);

  // Auto-sync date filter when data range doesn't overlap with stored filter
  useEffect(() => {
    if (!data?.date_range?.start || !data?.date_range?.end) return;
    const rangeStart = data.date_range.start;
    const rangeEnd = data.date_range.end;
    const needsReset =
      (dateFrom && (dateFrom > rangeEnd || dateFrom < rangeStart)) ||
      (dateTo && (dateTo < rangeStart || dateTo > rangeEnd));
    if (needsReset) {
      ui.patch({ dashboardDateFrom: rangeStart, dashboardDateTo: rangeEnd });
    }
  }, [data?.date_range?.start, data?.date_range?.end]);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false);
      }
    };
    if (orgDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [orgDropdownOpen]);

  const filteredTrend = useMemo(() => {
    if (!data) return [];
    let trend = data.daily_trend;
    if (dateFrom) trend = trend.filter((d) => d.day >= dateFrom);
    if (dateTo) trend = trend.filter((d) => d.day <= dateTo);
    return trend;
  }, [data, dateFrom, dateTo]);

  const allOrgs = data?.orgs || [];

  const handleOrgToggle = useCallback((org: string) => {
    setSelectedOrgs((prev) => {
      if (prev === null) return allOrgs.filter((o) => o !== org);
      const next = prev.includes(org) ? prev.filter((o) => o !== org) : [...prev, org];
      if (next.length === allOrgs.length) return null;
      return next;
    });
  }, [allOrgs]);

  const toggleAllOrgs = useCallback(() => {
    setSelectedOrgs((prev) => (prev === null ? [] : null));
  }, []);

  const isOrgSelected = useCallback((org: string) => {
    return selectedOrgs === null || selectedOrgs.includes(org);
  }, [selectedOrgs]);

  const isAllSelected = selectedOrgs === null;
  const hasSelection = selectedOrgs === null || selectedOrgs.length > 0;

  const orgTriggerLabel = useMemo(() => {
    if (selectedOrgs === null) return t("dashboard.allOrgs");
    if (selectedOrgs.length === 0) return t("dashboard.noSelection");
    if (selectedOrgs.length === 1) return selectedOrgs[0];
    return `${selectedOrgs.length} / ${allOrgs.length}`;
  }, [selectedOrgs, allOrgs.length, t]);

  const hasData = hasSelection && data && (data.daily_trend.length > 0 || data.top_users.length > 0 || data.kpi.total_seats > 0);
  // When a group scope is selected, still show dashboard even with 0 KPIs
  const hasDataOrGroupScope = hasData || (hasSelection && !!data && !!ui.selectedGroupId);

  // Acceptance rate trend
  const acceptRateTrend = useMemo(() => {
    return filteredTrend.map((d) => ({
      day: d.day,
      accept_rate: d.code_gen > 0 ? Math.min(100, Math.round((d.code_accept / d.code_gen) * 100)) : 0,
      loc_accept_rate: d.loc_suggested > 0 ? Math.min(100, Math.round((d.loc_accepted / d.loc_suggested) * 100)) : 0,
    }));
  }, [filteredTrend]);

  // WoW delta helper
  const delta = (key: string) => {
    if (!trend?.deltas) return null;
    const v = trend.deltas[key];
    if (v == null || v === 0) return null;
    const pos = v > 0;
    return (
      <span className={`kpi-delta ${pos ? "kpi-delta-up" : "kpi-delta-down"}`}>
        {pos ? "▲" : "▼"} {Math.abs(Math.round(v))}%
      </span>
    );
  };

  return (
    <div className="dashboard" key={refreshKey}>
      {drilldownUser && (
        <UserDetailModal
          username={drilldownUser}
          orgs={selectedOrgs ?? undefined}
          groupId={ui.selectedGroupId}
          onClose={() => setDrilldownUser(null)}
        />
      )}
      {/* Filters */}
      <div className="dashboard-filters">
        <div className="dashboard-filter-group">
          <label>{t("dashboard.filters")}:</label>
          <div className="org-dropdown" ref={dropdownRef}>
            <button className="org-dropdown-trigger" onClick={() => setOrgDropdownOpen((v) => !v)}>
              <span>{orgTriggerLabel}</span>
              <span className="org-dropdown-arrow">{orgDropdownOpen ? "\u25B4" : "\u25BE"}</span>
            </button>
            {orgDropdownOpen && (
              <div className="org-dropdown-menu">
                <label className={`org-dropdown-item ${isAllSelected ? "org-dropdown-item-active" : ""}`}>
                  <input type="checkbox" checked={isAllSelected} onChange={toggleAllOrgs} />
                  <span>{t("dashboard.allOrgs")}</span>
                </label>
                <div className="org-dropdown-divider" />
                {allOrgs.map((org) => (
                  <label key={org} className={`org-dropdown-item ${isOrgSelected(org) ? "org-dropdown-item-active" : ""}`}>
                    <input type="checkbox" checked={isOrgSelected(org)} onChange={() => handleOrgToggle(org)} />
                    <span>{org}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="dashboard-filter-group">
          <input type="date" className="dashboard-date-input" value={dateFrom || data?.date_range?.start || ""} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="dashboard-date-sep">—</span>
          <input type="date" className="dashboard-date-input" value={dateTo || data?.date_range?.end || ""} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="dashboard-filter-group" style={{ marginLeft: "auto" }}>
          <PeriodicReportButton selectedOrgs={selectedOrgs ?? allOrgs} />
        </div>
      </div>

      {loading && !data && <div className="dashboard-loading">{t("loading")}</div>}
      {!loading && !hasDataOrGroupScope && <div className="dashboard-empty">{t("dashboard.noData")}</div>}
      {!loading && !hasData && hasDataOrGroupScope && (
        <div className="dashboard-empty">{t("dashboard.noDataGroup")}</div>
      )}

      {hasDataOrGroupScope && (
        <>
          {/* Billing scope error banner */}
          {data.kpi.billing_scope_error && (
            <div className="billing-scope-banner">
              ⚠️ {t("dashboard.billingScope")}
            </div>
          )}
          {/* ===== KPI Cards ===== */}
          <div className="dashboard-kpi">
            <div className="stat-card">
              <InfoIcon id="kpi_seats" />
              <div className="stat-value">{data.kpi.total_seats}</div>
              <div className="stat-label">{t("sidebar.totalSeats")}</div>
            </div>
            <div className="stat-card">
              <InfoIcon id="kpi_utilization" />
              <div className={`stat-value ${data.kpi.utilization_pct >= 80 ? "success" : data.kpi.utilization_pct >= 50 ? "warning" : "danger"}`}>
                {data.kpi.utilization_pct}%
              </div>
              <div className="stat-label">{t("sidebar.utilization")}</div>
            </div>
            <div className="stat-card">
              <InfoIcon id="kpi_cost" />
              <div className="stat-value cost">${data.kpi.monthly_cost.toLocaleString()}</div>
              <div className="stat-label">{t("sidebar.monthlyCost")}</div>
            </div>
            <div className="stat-card">
              <InfoIcon id="kpi_waste" />
              <div className={`stat-value ${data.kpi.monthly_waste > 0 ? "danger" : ""}`}>
                ${data.kpi.monthly_waste.toLocaleString()}
              </div>
              <div className="stat-label">{t("sidebar.monthlyWaste")}</div>
            </div>
            {trend?.has_data && (
              <>
                <div className="stat-card stat-card-trend">
                  <InfoIcon id="kpi_acceptance_rate" />
                  <div className="stat-value">{trend.current.acceptance_rate?.toFixed(1)}%</div>
                  <div className="stat-label">Acceptance Rate (7d) {delta("acceptance_rate_pt")}</div>
                </div>
                <div className="stat-card stat-card-trend">
                  <InfoIcon id="kpi_avg_dau" />
                  <div className="stat-value">{trend.current.avg_dau?.toFixed(1)}</div>
                  <div className="stat-label">Avg DAU (7d) {delta("dau_pct")}</div>
                </div>
              </>
            )}
            {data.chat_stats && (data.chat_stats.ide_chats > 0 || data.chat_stats.dotcom_chats > 0) && (
              <>
                <div className="stat-card">
                  <InfoIcon id="kpi_chats" />
                  <div className="stat-value">{(data.chat_stats.ide_chats + data.chat_stats.dotcom_chats).toLocaleString()}</div>
                  <div className="stat-label">{t("dashboard.totalChats")}</div>
                </div>
                <div className="stat-card">
                  <InfoIcon id="kpi_pr_summaries" />
                  <div className="stat-value">{data.chat_stats.pr_summaries.toLocaleString()}</div>
                  <div className="stat-label">{t("dashboard.prSummaries")}</div>
                </div>
              </>
            )}
          </div>

          {/* ===== Section: Active User Trends ===== */}
          <Section sectionKey="activeUserTrends" title={t("dashboard.activeUserTrends")} infoKey="section_activeUserTrends">
            <div className="dashboard-charts">
              <div className="chart-card chart-card-wide">
                <ChartTitle text={t("dashboard.dailyTrend")} infoKey="chart_dailyTrend" />
                {filteredTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={filteredTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Line type="monotone" dataKey="mau" name="MAU" stroke="#bc8cff" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="wau" name="WAU" stroke="#58a6ff" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="dau" name="DAU" stroke="#3fb950" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="chat_users" name="Chat" stroke="#d29922" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="agent_users" name="Agent" stroke="#f85149" strokeWidth={2} dot={false} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
            </div>
          </Section>

          {/* ===== Section: Code Productivity ===== */}
          <Section sectionKey="codeProductivity" title={t("dashboard.codeProductivity")} infoKey="section_codeProductivity">
            <div className="dashboard-charts">
              <div className="chart-card">
                <ChartTitle text={t("dashboard.locTrend")} infoKey="chart_locTrend" />
                {filteredTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={filteredTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Area type="monotone" dataKey="loc_suggested" name="LOC Suggested" stroke="#58a6ff" fill="#58a6ff" fillOpacity={0.15} />
                      <Area type="monotone" dataKey="loc_accepted" name="LOC Accepted" stroke="#3fb950" fill="#3fb950" fillOpacity={0.2} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
              <div className="chart-card">
                <ChartTitle text={t("dashboard.acceptRate")} infoKey="chart_acceptRate" />
                {acceptRateTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={acceptRateTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} domain={[0, 100]} unit="%" />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => `${v}%`} />
                      <Line type="monotone" dataKey="accept_rate" name="Code Accept %" stroke="#3fb950" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="loc_accept_rate" name="LOC Accept %" stroke="#58a6ff" strokeWidth={2} dot={false} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
            </div>
          </Section>

          {/* ===== Section: Feature Usage ===== */}
          <Section sectionKey="featureUsage" title={t("dashboard.featureUsage")} infoKey="section_featureUsage">
            <div className="dashboard-charts">
              <div className="chart-card chart-card-wide">
                {selectedFeature ? (
                  /* ── Per-user drilldown for selected feature ── */
                  (() => {
                    const featureUsers = (data.user_feature_usage ?? [])
                      .filter((r) => r.feature === selectedFeature)
                      .sort((a, b) => b.total - a.total);
                    return (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <button
                            className="btn btn-small"
                            onClick={() => setSelectedFeature(null)}
                            style={{ fontSize: 12 }}
                          >
                            ← {t("monitor.backToFeatures")}
                          </button>
                          <span style={{ fontWeight: 600, color: "var(--accent)" }}>
                            {FEATURE_NAME_MAP[selectedFeature] ?? selectedFeature}
                          </span>
                          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                            — {t("monitor.featureUserBreakdown")}
                          </span>
                        </div>
                        {featureUsers.length > 0 ? (
                          <div className="dashboard-table-wrap" style={{ maxHeight: 420 }}>
                            <table className="dashboard-table">
                              <thead>
                                <tr>
                                  <th>User</th>
                                  <th>Total</th>
                                  <th title="Số lần gửi prompt / chat">Interactions 💬</th>
                                  <th title="Số lần sinh code suggestion">Code Gen ⌨️</th>
                                  <th>Code Accept</th>
                                  <th>Accept %</th>
                                  <th>LOC Suggested</th>
                                  <th>LOC Accepted</th>
                                </tr>
                              </thead>
                              <tbody>
                                {featureUsers.map((u, ri) => (
                                  <tr
                                    key={u.user}
                                    className="clickable-row"
                                    style={{ background: ri % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)" }}
                                    onClick={() => setDrilldownUser(u.user)}
                                  >
                                    <td style={{ fontWeight: 500 }}><span className="user-link">{u.user}</span></td>
                                    <td style={{ fontWeight: 600, color: "var(--accent)" }}>{u.total.toLocaleString()}</td>
                                    <td>{u.interactions > 0 ? u.interactions.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                                    <td>{u.code_gen > 0 ? u.code_gen.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                                    <td>{u.code_accept > 0 ? u.code_accept.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                                    <td>{u.code_gen > 0 ? `${Math.round((u.code_accept / u.code_gen) * 100)}%` : "—"}</td>
                                    <td>{u.loc_suggested > 0 ? u.loc_suggested.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                                    <td>{u.loc_accepted > 0 ? u.loc_accepted.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="chart-empty">{t("dashboard.noData")}</div>
                        )}
                      </>
                    );
                  })()
                ) : data.feature_usage.length > 0 ? (
                  /* ── Feature summary table ── */
                  <div className="dashboard-table-wrap">
                    <table className="dashboard-table">
                      <thead>
                        <tr>
                          <th>Feature</th>
                          <th>Interactions</th>
                          <th>Code Gen</th>
                          <th>Code Accept</th>
                          <th>Accept %</th>
                          <th>LOC Suggested</th>
                          <th>LOC Accepted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.feature_usage.map((f, ri) => (
                          <tr
                            key={f.feature}
                            className="clickable-row"
                            style={{ background: ri % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)", cursor: "pointer" }}
                            onClick={() => setSelectedFeature(f.feature)}
                            title={`Xem sử dụng theo người dùng: ${FEATURE_NAME_MAP[f.feature] ?? f.feature}`}
                          >
                            <td className="user-name"><span className="user-link">{FEATURE_NAME_MAP[f.feature] ?? f.feature}</span></td>
                            <td>{f.interactions.toLocaleString()}</td>
                            <td>{f.code_gen.toLocaleString()}</td>
                            <td>{f.code_accept.toLocaleString()}</td>
                            <td>{f.code_gen > 0 ? `${Math.round((f.code_accept / f.code_gen) * 100)}%` : "—"}</td>
                            <td>{f.loc_suggested.toLocaleString()}</td>
                            <td>{f.loc_accepted.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
            </div>
          </Section>

          {/* ===== Section: Language Distribution ===== */}
          {(data.language_usage.length > 0 || data.code_completions.length > 0) && (
            <Section sectionKey="langDist" title={t("dashboard.langDist")} infoKey="section_langDist">
              <div className="dashboard-charts">
                {data.language_usage.length > 0 && (
                  <div className="chart-card">
                    <ChartTitle text={t("dashboard.langCodeGen")} infoKey="chart_langCodeGen" />
                    <ResponsiveContainer width="100%" height={Math.max(200, data.language_usage.length * 28)}>
                      <BarChart data={data.language_usage.slice(0, 15)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                        <YAxis dataKey="language" type="category" width={100} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="code_gen" name="Code Gen" fill="#58a6ff" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="code_accept" name="Accepted" fill="#3fb950" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {data.code_completions.length > 0 && (
                  <div className="chart-card">
                    <ChartTitle text={t("dashboard.codeCompletions")} infoKey="chart_codeCompletions" />
                    <div className="dashboard-table-wrap">
                      <table className="dashboard-table">
                        <thead>
                          <tr>
                            <th>Language</th>
                            <th>Suggestions</th>
                            <th>Accepted</th>
                            <th>Accept %</th>
                            <th>Lines Sugg.</th>
                            <th>Lines Acc.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.code_completions.slice(0, 15).map((c) => (
                            <tr key={c.language}>
                              <td className="user-name">{c.language}</td>
                              <td>{c.suggestions.toLocaleString()}</td>
                              <td>{c.acceptances.toLocaleString()}</td>
                              <td>{c.suggestions > 0 ? `${Math.round((c.acceptances / c.suggestions) * 100)}%` : "—"}</td>
                              <td>{c.lines_suggested.toLocaleString()}</td>
                              <td>{c.lines_accepted.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ===== Section: Model & Premium Requests ===== */}
          <Section sectionKey="modelPremium" title={t("dashboard.modelPremium")} infoKey="section_modelPremium">
            <div className="dashboard-charts">
              <div className="chart-card">
                <ChartTitle text={t("dashboard.modelUsage")} infoKey="chart_modelUsage" />
                {data.model_usage.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={data.model_usage}
                        dataKey="interactions"
                        nameKey="model"
                        cx="50%" cy="50%" outerRadius={80}
                        label={({ name, percent }: { name?: string; percent?: number }) => `${name || ""} ${((percent || 0) * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {data.model_usage.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
              <div className="chart-card">
                <ChartTitle text={t("dashboard.premiumDetail")} infoKey="chart_premiumDetail" />
                {data.premium_detail.length > 0 ? (
                  <div className="dashboard-table-wrap">
                    <table className="dashboard-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Gross Qty</th>
                          <th>Discount</th>
                          <th>Net Qty</th>
                          <th>Net Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.premium_detail.map((p) => (
                          <tr key={p.model}>
                            <td className="user-name">{p.model}</td>
                            <td>{p.gross_qty.toLocaleString()}</td>
                            <td>{p.discount_qty.toLocaleString()}</td>
                            <td>{p.net_qty.toLocaleString()}</td>
                            <td>${p.net_amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
            </div>
          </Section>

          {/* ===== Section: IDE Distribution ===== */}
          {/* ===== Section: IDE Usage ===== */}
          <Section sectionKey="ideUsage" title={t("dashboard.ideUsage")} infoKey="section_ideUsage">
            <div className="dashboard-charts">
              <div className="chart-card">
                <ChartTitle text={t("dashboard.ideChart")} infoKey="chart_ideChart" />
                {data.ide_usage.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.ide_usage}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="ide" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="interactions" name="Interactions" fill="#d29922" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="code_gen" name="Code Gen" fill="#58a6ff" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
              <div className="chart-card">
                <ChartTitle text={t("dashboard.ideDetail")} infoKey="chart_ideDetail" />
                {data.ide_usage.length > 0 ? (
                  <div className="dashboard-table-wrap">
                    <table className="dashboard-table">
                      <thead>
                        <tr>
                          <th>IDE</th>
                          <th>Interactions</th>
                          <th>Code Gen</th>
                          <th>Accept</th>
                          <th>LOC Sugg.</th>
                          <th>LOC Acc.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ide_usage.map((ide) => (
                          <tr key={ide.ide}>
                            <td className="user-name">{ide.ide}</td>
                            <td>{ide.interactions.toLocaleString()}</td>
                            <td>{ide.code_gen.toLocaleString()}</td>
                            <td>{ide.code_accept.toLocaleString()}</td>
                            <td>{ide.loc_suggested.toLocaleString()}</td>
                            <td>{ide.loc_accepted.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
            </div>
          </Section>

          {/* ===== Section: Seat Management ===== */}
          {data.seat_info && data.seat_info.seats.length > 0 && (() => {
            const seatStatus = (s: typeof data.seat_info.seats[0]) =>
              s.pending_cancellation_date ? "cancelling" : !s.last_activity_at ? "inactive" : "active";
            const planOptions = Array.from(new Set(data.seat_info.seats.map(s => s.plan_type).filter(Boolean)));
            const filteredSeats = data.seat_info.seats
              .filter(s => seatFilterPlan === "all" || s.plan_type === seatFilterPlan)
              .filter(s => seatFilterStatus === "all" || seatStatus(s) === seatFilterStatus)
              .sort((a, b) => {
                if (!seatSort.col) return 0;
                let av = "", bv = "";
                if (seatSort.col === "plan") { av = a.plan_type || ""; bv = b.plan_type || ""; }
                else if (seatSort.col === "status") { av = seatStatus(a); bv = seatStatus(b); }
                else if (seatSort.col === "activity") { av = a.last_activity_at || ""; bv = b.last_activity_at || ""; }
                const cmp = av.localeCompare(bv);
                return seatSort.dir === "asc" ? cmp : -cmp;
              });
            const toggleSort = (col: string) => setSeatSort(prev =>
              prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
            );
            const sortIcon = (col: string) => seatSort.col === col ? (seatSort.dir === "asc" ? " ▲" : " ▼") : " ⇅";
            return (
              <Section sectionKey="seatMgmt" title={t("dashboard.seatMgmt")} infoKey="section_seatMgmt" defaultOpen={false}>
                <div className="dashboard-charts">
                  <div className="chart-card chart-card-wide">
                    <div className="dash-seat-summary">
                      {Object.entries(data.seat_info.plans).map(([plan, count]) => (
                        <span key={plan} className="dash-badge">{plan}: {count}</span>
                      ))}
                      {Object.entries(data.seat_info.features).map(([feat, val]) => (
                        <span key={feat} className="dash-badge dash-badge-muted">{feat}: {val}</span>
                      ))}
                      <span className="dash-badge">Pending Invite: {data.seat_info.breakdown.pending_invitation}</span>
                      <span className="dash-badge">Pending Cancel: {data.seat_info.breakdown.pending_cancellation}</span>
                      <span className="dash-badge">Added This Cycle: {data.seat_info.breakdown.added_this_cycle}</span>
                      <button className="btn btn-small" style={{ marginLeft: "auto" }}
                        onClick={() => exportCSV("seats", data.seat_info.seats)}>⬇ CSV</button>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <select className="filter-select" value={seatFilterPlan} onChange={e => setSeatFilterPlan(e.target.value)}>
                        <option value="all">All License Types</option>
                        {planOptions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <select className="filter-select" value={seatFilterStatus} onChange={e => setSeatFilterStatus(e.target.value)}>
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="cancelling">Cancelling</option>
                      </select>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)", alignSelf: "center" }}>{filteredSeats.length} records</span>
                    </div>
                    <div className="dashboard-table-wrap" style={{ maxHeight: 400 }}>
                      <table className="dashboard-table">
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>Org</th>
                            <th>Team</th>
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("plan")}>License Type{sortIcon("plan")}</th>
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("activity")}>Last Activity{sortIcon("activity")}</th>
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("status")}>Status{sortIcon("status")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSeats.map((s) => {
                            const status = seatStatus(s);
                            return (
                              <tr key={`${s.org}-${s.user}-${s.plan_type}`} className="clickable-row" onClick={() => setDrilldownUser(s.user)}>
                                <td className="user-name">
                                  {s.avatar && <img src={s.avatar} alt="" className="dash-seat-avatar" />}
                                  <span className="user-link">{s.user}</span>
                                </td>
                                <td>{s.org}</td>
                                <td>{s.team || "—"}</td>
                                <td>{s.plan_type || "—"}</td>
                                <td>{s.last_activity_at ? s.last_activity_at.slice(0, 10) : "Never"}</td>
                                <td>
                                  {status === "cancelling" ? <span className="dash-status-badge danger">Cancelling</span>
                                    : status === "inactive" ? <span className="dash-status-badge warning">Inactive</span>
                                    : <span className="dash-status-badge success">Active</span>}
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

          {/* ===== Section: Top Active Users ===== */}
          <Section sectionKey="topUsers" title={t("dashboard.topUsers")} infoKey="section_topUsers">
            <div className="dashboard-charts">
              <div className="chart-card chart-card-wide">
                {data.top_users.length > 0 ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                      <button className="btn btn-small" onClick={() => exportCSV("top-users", data.top_users)}>⬇ CSV</button>
                    </div>
                    <div className="dashboard-table-wrap">
                      <table className="dashboard-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>User</th>
                            <th>Interactions</th>
                            <th>Code Gen</th>
                            <th>Accept</th>
                            <th>Accept %</th>
                            <th>LOC Sugg.</th>
                            <th>LOC Acc.</th>
                            <th>Days</th>
                            <th>Chat</th>
                            <th>Agent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.top_users.map((u, i) => (
                            <tr key={u.user} className="clickable-row" onClick={() => setDrilldownUser(u.user)}>
                              <td className="rank">{i + 1}</td>
                              <td className="user-name"><span className="user-link">{u.user}</span></td>
                              <td>{u.interactions.toLocaleString()}</td>
                              <td>{u.code_gen.toLocaleString()}</td>
                              <td>{u.code_accept.toLocaleString()}</td>
                              <td>{u.code_gen > 0 ? `${Math.round((u.code_accept / u.code_gen) * 100)}%` : "—"}</td>
                              <td>{u.loc_suggested.toLocaleString()}</td>
                              <td>{u.loc_accepted.toLocaleString()}</td>
                              <td>{u.days_active}</td>
                              <td>{u.used_chat ? "\u2713" : ""}</td>
                              <td>{u.used_agent ? "\u2713" : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="chart-empty">{t("dashboard.noData")}</div>
                )}
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
