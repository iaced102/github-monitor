import { useState, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useI18n } from "../contexts/I18nContext";
import { useUIState } from "../contexts/UIStateContext";
import { useUsageMonitor } from "../hooks/useData";
import { InfoIcon, ChartTitle } from "./InfoIcon";
import { UserDetailModal } from "./UserDetailModal";
import { exportCSV } from "../utils/export";

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f778ba", "#79c0ff", "#56d364", "#e3b341", "#ff7b72"];
const TOOLTIP_STYLE = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

interface Props {
  refreshKey: number;
  selectedOrgs: string[];
}

/* ---------- Collapsible Section ---------- */
function Section({ sectionKey, title, infoKey, defaultOpen = true, children }: {
  sectionKey: string; title: string; infoKey?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const { dashboardSections, patch } = useUIState();
  const open = dashboardSections[`mon_${sectionKey}`] ?? defaultOpen;
  const toggle = useCallback(() => {
    patch({ dashboardSections: { ...dashboardSections, [`mon_${sectionKey}`]: !open } });
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

/* ---------- Short model name for display ---------- */
function shortModel(m: string): string {
  if (m === "others") return "Others (mixed)";
  if (m === "auto") return "Auto (default)";
  return m.replace("gpt-", "GPT-").replace("claude-", "Claude-").replace("gemini-", "Gemini-");
}

/* ---------- Safe chart key from model name ---------- */
function modelKey(m: string): string {
  return m.replace(/[-./]/g, "_");
}

/* ---------- Friendly feature label ---------- */
const FEATURE_LABELS: Record<string, string> = {
  chat_panel_agent_mode:    "Chat – Agent Mode",
  chat_panel_ask_mode:      "Chat – Ask Mode",
  chat_panel_custom_mode:   "Chat – Custom Mode",
  chat_panel_plan_mode:     "Chat – Plan Mode",
  chat_panel_unknown_mode:  "Chat – Unknown Mode",
  agent_edit:               "Agent Edit (file edits)",
  copilot_cli:              "Copilot CLI",
  others:                   "Others (unclassified)",
};
function friendlyFeature(f: string): string {
  return FEATURE_LABELS[f] ?? f.replace(/_/g, " ");
}

export function UsageMonitorDashboard({ refreshKey: _refreshKey, selectedOrgs }: Props) {
  const { t } = useI18n();
  const ui = useUIState();
  const { data, loading } = useUsageMonitor(selectedOrgs, ui.selectedGroupId);
  const [userSearch, setUserSearch] = useState("");
  const [userSort, setUserSort] = useState<"total" | string>("total");
  const [userSortDir, setUserSortDir] = useState<"desc" | "asc">("desc");
  const [drilldownUser, setDrilldownUser] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);

  if (loading) {
    return <div className="dashboard-loading"><div className="loading-spinner" /><span>{t("loading")}</span></div>;
  }
  if (!data) {
    return <div className="dashboard-empty">{t("dashboard.noData")}</div>;
  }

  const { kpi, model_totals, model_feature, model_language, daily_trend, all_models, user_model, user_feature } = data;

  // Unique features for the feature×model table
  const allFeatures = [...new Set<string>(model_feature.map((r: any) => r.feature))].sort();

  // Build feature×model pivot for table
  const featureModelMap: Record<string, Record<string, number>> = {};
  for (const row of model_feature) {
    if (!featureModelMap[row.feature]) featureModelMap[row.feature] = {};
    featureModelMap[row.feature][row.model] = (row.interactions || 0) + (row.code_gen || 0);
  }

  // Filtered + sorted user list
  const filteredUsers = user_model
    .filter((u: any) => u.user.toLowerCase().includes(userSearch.toLowerCase()))
    .sort((a: any, b: any) => {
      const av = userSort === "total" ? (a.total ?? 0) : (a[userSort] ?? 0);
      const bv = userSort === "total" ? (b.total ?? 0) : (b[userSort] ?? 0);
      return userSortDir === "desc" ? bv - av : av - bv;
    });

  const toggleSort = (col: string) => {
    if (userSort === col) setUserSortDir(d => d === "desc" ? "asc" : "desc");
    else { setUserSort(col); setUserSortDir("desc"); }
  };

  const sortIcon = (col: string) => userSort === col ? (userSortDir === "desc" ? " ▼" : " ▲") : "";

  // Top languages per model
  const topLangByModel: Record<string, { language: string; code_gen: number }[]> = {};
  for (const row of model_language) {
    if (!topLangByModel[row.model]) topLangByModel[row.model] = [];
    topLangByModel[row.model].push({ language: row.language, code_gen: row.code_gen });
  }
  for (const m of Object.keys(topLangByModel)) {
    topLangByModel[m].sort((a, b) => b.code_gen - a.code_gen);
  }

  return (
    <div className="csv-dashboard">
      {drilldownUser && (
        <UserDetailModal
          username={drilldownUser}
          orgs={selectedOrgs}
          groupId={ui.selectedGroupId}
          onClose={() => setDrilldownUser(null)}
        />
      )}
      <div className="dash-section">
        <div className="dash-section-body" style={{ paddingTop: 0 }}>
          <div className="dashboard-kpi">
            <div className="stat-card">
              <InfoIcon id="mon_uniqueModels" />
              <div className="stat-value">{kpi.unique_models}</div>
              <div className="stat-label">{t("monitor.uniqueModels")}</div>
            </div>
            <div className="stat-card">
              <InfoIcon id="mon_topModel" />
              <div className="stat-value" style={{ fontSize: 14, wordBreak: "break-all" }}>
                {shortModel(kpi.top_model)}
              </div>
              <div className="stat-label">{t("monitor.topModel")}</div>
            </div>
            <div className="stat-card">
              <InfoIcon id="mon_totalInteractions" />
              <div className="stat-value">{kpi.total_interactions.toLocaleString()}</div>
              <div className="stat-label">{t("monitor.totalInteractions")}</div>
            </div>
            <div className="stat-card">
              <InfoIcon id="mon_totalCodeGen" />
              <div className="stat-value">{kpi.total_code_gen.toLocaleString()}</div>
              <div className="stat-label">{t("monitor.totalCodeGen")}</div>
            </div>
            <div className="stat-card">
              <InfoIcon id="mon_activeUsers" />
              <div className="stat-value">{kpi.active_users}</div>
              <div className="stat-label">{t("monitor.activeUsers")}</div>
            </div>
          </div>
          {kpi.report_start && kpi.report_end && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, paddingLeft: 2 }}>
              📅 Kỳ báo cáo: {kpi.report_start} → {kpi.report_end} (28 ngày)
            </div>
          )}
        </div>
      </div>

      {/* ── Model Overview ─────────────────────────────────────────────────── */}
      <Section sectionKey="modelOverview" title={t("monitor.sectionModelOverview")} infoKey="mon_modelOverview">
        <div className="dashboard-charts">
          {/* Pie chart: model share */}
          <div className="chart-card">
            <ChartTitle text={t("monitor.modelShare")} infoKey="mon_modelShare" />
            {model_totals.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={model_totals.map((m: any) => ({
                      name: shortModel(m.model),
                      value: m.interactions + m.code_gen,
                    }))}
                    dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={90}
                    label={({ percent }: any) => (percent || 0) >= 0.05 ? `${((percent || 0) * 100).toFixed(0)}%` : ""}
                    labelLine={false}
                  >
                    {model_totals.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("dashboard.noData")}</div>}
          </div>

          {/* Bar chart: model details */}
          <div className="chart-card chart-card-wide">
            <ChartTitle text={t("monitor.modelDetail")} infoKey="mon_modelDetail" />
            {model_totals.length > 0 ? (
              <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>{t("monitor.model")}</th>
                      <th title="Số lần người dùng gửi prompt/chat với model này">{t("monitor.interactions")} 💬</th>
                      <th title="Số lần model sinh code suggestion (inline completion)">{t("monitor.codeGen")} ⌨️</th>
                      <th title="Số lần inline suggestion được chấp nhận (Tab). Không áp dụng cho Chat.">{t("monitor.codeAccept")} ✅</th>
                      <th title="Code Accept / Code Gen × 100%. Chỉ có ý nghĩa với inline completion, không phải chat.">{t("monitor.acceptRate")} ⚠️</th>
                      <th title="Dòng code Copilot gợi ý (chủ yếu từ Chat). CLI/Agent edit không tính vào đây.">{t("monitor.locSuggested")}</th>
                      <th title="Dòng code thực sự được thêm vào file (CLI, Agent Edit). Chat không tính vào đây.">{t("monitor.locAdded")}</th>
                      <th>{t("monitor.topLangs")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model_totals.map((m: any, i: number) => {
                      const rate = m.code_gen > 0 ? ((m.code_accept / m.code_gen) * 100).toFixed(1) : "—";
                      const langs = (topLangByModel[m.model] || []).slice(0, 3).map((l: any) => l.language).join(", ");
                      return (
                        <tr key={m.model} style={{ background: i % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)" }}>
                          <td>
                            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                              background: COLORS[i % COLORS.length], marginRight: 6 }} />
                            {shortModel(m.model)}
                          </td>
                          <td>{m.interactions.toLocaleString()}</td>
                          <td>{m.code_gen.toLocaleString()}</td>
                          <td>{m.code_accept.toLocaleString()}</td>
                          <td>{rate}{rate !== "—" ? "%" : ""}</td>
                          <td>{m.loc_suggested.toLocaleString()}</td>
                          <td>{m.loc_added.toLocaleString()}</td>
                          <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{langs || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="chart-empty">{t("dashboard.noData")}</div>}
          </div>
        </div>
      </Section>

      {/* ── Daily Trend by Model ───────────────────────────────────────────── */}
      <Section sectionKey="dailyTrend" title={t("monitor.sectionDailyTrend")} infoKey="mon_dailyTrend">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            <ChartTitle text={t("monitor.dailyModelTrend")} infoKey="mon_dailyModelTrend" />
            {daily_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={daily_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                    tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE}
                    labelFormatter={(l) => `📅 ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => shortModel(v.replace(/_interact$/, "").replace(/_/g, "-"))} />
                  {all_models.map((m: string, i: number) => (
                    <Area key={m} type="monotone"
                      dataKey={`${modelKey(m)}_interact`}
                      name={shortModel(m)}
                      stackId="1"
                      stroke={COLORS[i % COLORS.length]}
                      fill={COLORS[i % COLORS.length]}
                      fillOpacity={0.4}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("dashboard.noData")}</div>}
          </div>

          <div className="chart-card chart-card-wide">
            <ChartTitle text={t("monitor.dailyCodeGenTrend")} infoKey="mon_dailyCodeGenTrend" />
            {daily_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={daily_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                    tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => shortModel(v.replace(/_codegen$/, "").replace(/_/g, "-"))} />
                  {all_models.map((m: string, i: number) => (
                    <Bar key={m} dataKey={`${modelKey(m)}_codegen`} name={shortModel(m)}
                      stackId="1" fill={COLORS[i % COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">{t("dashboard.noData")}</div>}
          </div>
        </div>
      </Section>

      {/* ── Feature × Model ───────────────────────────────────────────────── */}
      <Section sectionKey="featureModel" title={t("monitor.sectionFeatureModel")} infoKey="mon_featureModel">
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            {selectedFeature ? (
              /* ── Feature drilldown: per-user usage for selected feature ── */
              (() => {
                const featureUsers = (user_feature ?? [])
                  .filter((r: any) => r.feature === selectedFeature)
                  .sort((a: any, b: any) => b.total - a.total);
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
                        {friendlyFeature(selectedFeature)}
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
                              <th>{t("monitor.user")}</th>
                              <th>{t("monitor.total")}</th>
                              <th title="Số lần gửi prompt / chat">{t("monitor.interactions")} 💬</th>
                              <th title="Số lần sinh code suggestion">{t("monitor.codeGen")} ⌨️</th>
                            </tr>
                          </thead>
                          <tbody>
                            {featureUsers.map((u: any, ri: number) => (
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
            ) : (
              /* ── Feature × Model matrix ── */
              <>
                <ChartTitle text={t("monitor.featureModelMatrix")} infoKey="mon_featureModelMatrix" />
                {allFeatures.length > 0 ? (
                  <div className="dashboard-table-wrap">
                    <table className="dashboard-table">
                      <thead>
                        <tr>
                          <th title="Tên tính năng Copilot. Chat features không tính Accept Rate.">{t("monitor.feature")}</th>
                          {all_models.map((m: string, i: number) => (
                            <th key={m}>
                              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                                background: COLORS[i % COLORS.length], marginRight: 4 }} />
                              {shortModel(m)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allFeatures.map((feat, ri) => (
                          <tr
                            key={feat}
                            className="clickable-row"
                            style={{ background: ri % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)", cursor: "pointer" }}
                            onClick={() => setSelectedFeature(feat)}
                            title={`Xem sử dụng theo người dùng cho: ${friendlyFeature(feat)}`}
                          >
                            <td style={{ fontWeight: 500 }}>
                              <span className="user-link">{friendlyFeature(feat)}</span>
                            </td>
                            {all_models.map((m: string) => {
                              const v = featureModelMap[feat]?.[m] ?? 0;
                              const max = Math.max(...all_models.map((mm: string) => featureModelMap[feat]?.[mm] ?? 0));
                              const pct = max > 0 ? (v / max) * 100 : 0;
                              return (
                                <td key={m} style={{ position: "relative", minWidth: 80 }}>
                                  {v > 0 && (
                                    <div style={{
                                      position: "absolute", inset: "2px 4px",
                                      background: `rgba(88,166,255,${pct / 200 + 0.05})`,
                                      borderRadius: 3,
                                    }} />
                                  )}
                                  <span style={{ position: "relative" }}>{v > 0 ? v.toLocaleString() : "—"}</span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="chart-empty">{t("dashboard.noData")}</div>}
              </>
            )}
          </div>
        </div>
      </Section>

      {/* ── Per-user Model Usage ──────────────────────────────────────────── */}
      <Section sectionKey="userModel" title={t("monitor.sectionUserModel")} infoKey="mon_userModel">
        <div className="dash-section-body" style={{ padding: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="text"
            placeholder={t("monitor.searchUser")}
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            style={{
              background: "var(--bg-tertiary)", border: "1px solid var(--border)",
              borderRadius: 6, color: "var(--text-primary)", padding: "5px 10px",
              fontSize: 13, width: 240,
            }}
          />
          <button className="btn btn-small" style={{ marginLeft: "auto" }}
            onClick={() => exportCSV("monitor-users", filteredUsers)}>⬇ CSV</button>
        </div>
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            <ChartTitle text={t("monitor.userModelBreakdown")} infoKey="mon_userModelBreakdown" />
            {filteredUsers.length > 0 ? (
              <div className="dashboard-table-wrap" style={{ maxHeight: 480 }}>
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort("user")} style={{ cursor: "pointer" }}>
                        {t("monitor.user")}{sortIcon("user")}
                      </th>
                      <th onClick={() => toggleSort("total")} style={{ cursor: "pointer" }}>
                        {t("monitor.total")} (Chat+Code){sortIcon("total")}
                      </th>
                      {all_models.map((m: string, i: number) => (
                        <th key={m} onClick={() => toggleSort(m)} style={{ cursor: "pointer" }}>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                            background: COLORS[i % COLORS.length], marginRight: 4 }} />
                          {shortModel(m)}{sortIcon(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u: any, ri: number) => (
                      <tr key={u.user} className="clickable-row" style={{ background: ri % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)" }}
                        onClick={() => setDrilldownUser(u.user)}>
                        <td style={{ fontWeight: 500 }}><span className="user-link">{u.user}</span></td>
                        <td style={{ fontWeight: 600, color: "var(--accent)" }}>{(u.total ?? 0).toLocaleString()}</td>
                        {all_models.map((m: string) => {
                          const v = u[m] ?? 0;
                          return <td key={m}>{v > 0 ? v.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="chart-empty">{t("dashboard.noData")}</div>}
          </div>

          {/* Stacked bar: top users × model */}
          {filteredUsers.length > 0 && (
            <div className="chart-card chart-card-wide">
              <ChartTitle text={t("monitor.topUserModelChart")} infoKey="mon_topUserModelChart" />
              <ResponsiveContainer width="100%" height={Math.max(240, Math.min(filteredUsers.length, 20) * 28)}>
                <BarChart data={filteredUsers.slice(0, 20).map((u: any) => ({
                  user: u.user,
                  ...Object.fromEntries(all_models.map((m: string) => [shortModel(m), u[m] ?? 0])),
                }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="user" type="category" width={120} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {all_models.map((m: string, i: number) => (
                    <Bar key={m} dataKey={shortModel(m)} stackId="1"
                      fill={COLORS[i % COLORS.length]} radius={i === all_models.length - 1 ? [0, 4, 4, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Section>

      {/* ── Language × Model ──────────────────────────────────────────────── */}
      <Section sectionKey="langModel" title={t("monitor.sectionLangModel")} infoKey="mon_langModel" defaultOpen={false}>
        <div className="dashboard-charts">
          <div className="chart-card chart-card-wide">
            <ChartTitle text={t("monitor.langModelChart")} infoKey="mon_langModelChart" />
            {model_language.length > 0 ? (
              (() => {
                // top 15 languages
                const langTotals: Record<string, number> = {};
                for (const row of model_language) {
                  langTotals[row.language] = (langTotals[row.language] ?? 0) + row.code_gen;
                }
                const topLangs = Object.entries(langTotals)
                  .sort(([, a], [, b]) => b - a).slice(0, 15).map(([l]) => l);
                const chartData = topLangs.map(lang => {
                  const entry: any = { lang };
                  for (const row of model_language) {
                    if (row.language === lang) {
                      entry[shortModel(row.model)] = (entry[shortModel(row.model)] ?? 0) + row.code_gen;
                    }
                  }
                  return entry;
                });
                const modelNames = [...new Set<string>(model_language.map((r: any) => shortModel(r.model)))];
                return (
                  <ResponsiveContainer width="100%" height={Math.max(200, topLangs.length * 30)}>
                    <BarChart data={chartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <YAxis dataKey="lang" type="category" width={90} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {modelNames.map((m, i) => (
                        <Bar key={m} dataKey={m} stackId="1" fill={COLORS[i % COLORS.length]}
                          radius={i === modelNames.length - 1 ? [0, 4, 4, 0] : undefined} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()
            ) : <div className="chart-empty">{t("dashboard.noData")}</div>}
          </div>
        </div>
      </Section>

    </div>
  );
}
