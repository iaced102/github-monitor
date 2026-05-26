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
  const isGroupFiltered = !!ui.selectedGroupId;
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

  const { kpi, model_totals, model_feature, model_language, daily_trend, all_models, user_model, user_feature,
          feature_totals = [], ide_totals = [], lang_totals = [], pr_totals = {}, cli_totals = {}, user_flags = [] } = data;

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

  // Build user_flags lookup map: login -> flags
  const userFlagsMap: Record<string, any> = {};
  for (const f of user_flags) userFlagsMap[f.user] = f;

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
          {kpi.report_start && kpi.report_end && (() => {
            const start = new Date(kpi.report_start);
            const end = new Date(kpi.report_end);
            const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, paddingLeft: 2 }}>
                📅 Kỳ báo cáo: {kpi.report_start} → {kpi.report_end} ({diffDays} ngày)
              </div>
            );
          })()}
          {/* Warning when group filter returns no matching users */}
          {isGroupFiltered && kpi.active_users === 0 && (
            <div style={{
              marginTop: 10, padding: "8px 12px", borderRadius: 6,
              background: "rgba(210, 153, 34, 0.12)", border: "1px solid var(--warning, #d29922)",
              color: "var(--warning, #d29922)", fontSize: 12,
            }}>
              ⚠️ Không tìm thấy dữ liệu usage cho bất kỳ thành viên nào trong nhóm này.
              Vui lòng kiểm tra lại GitHub username trong cấu hình nhóm (tab <strong>Nhóm người dùng</strong>).
            </div>
          )}
          {/* LOC + feature + IDE KPI row */}
          <div className="dashboard-kpi" style={{ marginTop: 12 }}>
            <div className="stat-card">
              <div className="stat-value">{(kpi.loc_suggested ?? 0).toLocaleString()}</div>
              <div className="stat-label" title="Dòng code Copilot gợi ý (Chat/Completion)">LOC ĐỀ XUẤT 📝</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{(kpi.loc_added ?? 0).toLocaleString()}</div>
              <div className="stat-label" title="Dòng code thực sự thêm vào (bao gồm CLI & Agent Edit)">LOC ĐƯỢC THÊM ✅</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {friendlyFeature(kpi.top_feature ?? "—")}
              </div>
              <div className="stat-label">TÍNH NĂNG PHỔ BIẾN NHẤT</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{kpi.top_ide ? kpi.top_ide.toUpperCase() : "—"}</div>
              <div className="stat-label">IDE PHỔ BIẾN NHẤT</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{kpi.users_with_agent ?? 0}</div>
              <div className="stat-label">DÙNG AGENT 🤖</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{kpi.users_with_cli ?? 0}</div>
              <div className="stat-label">DÙNG CLI 🖥️</div>
            </div>
          </div>
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
                      <th title="IDE đang dùng">IDE</th>
                      <th title="Có dùng Agent mode không">🤖 Agent</th>
                      <th title="Có dùng Chat không">💬 Chat</th>
                      <th title="Có dùng CLI không">🖥️ CLI</th>
                      <th title="Có dùng Copilot Coding Agent không">🏭 Coding Agent</th>
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
                    {filteredUsers.map((u: any, ri: number) => {
                      const flags = userFlagsMap[u.user] ?? {};
                      const ides: string[] = flags.ides ?? [];
                      return (
                        <tr key={u.user} className="clickable-row" style={{ background: ri % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)" }}
                          onClick={() => setDrilldownUser(u.user)}>
                          <td style={{ fontWeight: 500 }}><span className="user-link">{u.user}</span></td>
                          <td style={{ fontWeight: 600, color: "var(--accent)" }}>{(u.total ?? 0).toLocaleString()}</td>
                          <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{ides.length > 0 ? ides.join(", ").toUpperCase() : "—"}</td>
                          <td style={{ textAlign: "center" }}>{flags.used_agent ? "✅" : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                          <td style={{ textAlign: "center" }}>{flags.used_chat ? "✅" : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                          <td style={{ textAlign: "center" }}>{flags.used_cli ? "✅" : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                          <td style={{ textAlign: "center" }}>{flags.used_coding_agent ? "✅" : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                          {all_models.map((m: string) => {
                            const v = u[m] ?? 0;
                            return <td key={m}>{v > 0 ? v.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>;
                          })}
                        </tr>
                      );
                    })}
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

      {/* ── Feature Breakdown ────────────────────────────────────────────── */}
      <Section sectionKey="featureBreakdown" title="📊 Phân tích theo tính năng" infoKey="mon_featureBreakdown">
        <div className="dashboard-charts">
          {/* Feature horizontal bar chart */}
          <div className="chart-card">
            <ChartTitle text="Hoạt động theo tính năng" />
            {feature_totals.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(180, feature_totals.length * 36)}>
                <BarChart data={feature_totals.map((f: any) => ({
                  feature: friendlyFeature(f.feature),
                  "Chat/Interact": f.interactions,
                  "Code Gen": f.code_gen,
                }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="feature" type="category" width={160} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Chat/Interact" stackId="1" fill={COLORS[0]} />
                  <Bar dataKey="Code Gen" stackId="1" fill={COLORS[1]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">Không có dữ liệu</div>}
          </div>

          {/* Feature LOC table */}
          <div className="chart-card chart-card-wide">
            <ChartTitle text="Thống kê LOC theo tính năng" />
            {feature_totals.length > 0 ? (
              <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Tính năng</th>
                      <th title="Số lần chat/prompt">Interactions 💬</th>
                      <th title="Số lần sinh code">Code Gen ⌨️</th>
                      <th title="Số lần accept inline">Code Accept ✅</th>
                      <th title="Dòng code AI gợi ý">LOC Đề xuất 📝</th>
                      <th title="Dòng code thực sự được thêm">LOC Thêm vào ✅</th>
                      <th title="LOC Added / LOC Suggested">LOC Accept %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feature_totals.map((f: any, i: number) => {
                      const locRate = f.loc_suggested > 0 ? ((f.loc_added / f.loc_suggested) * 100).toFixed(1) : "—";
                      return (
                        <tr key={f.feature} style={{ background: i % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)" }}>
                          <td style={{ fontWeight: 500 }}>{friendlyFeature(f.feature)}</td>
                          <td>{f.interactions > 0 ? f.interactions.toLocaleString() : "—"}</td>
                          <td>{f.code_gen > 0 ? f.code_gen.toLocaleString() : "—"}</td>
                          <td>{f.code_accept > 0 ? f.code_accept.toLocaleString() : "—"}</td>
                          <td>{f.loc_suggested > 0 ? f.loc_suggested.toLocaleString() : "—"}</td>
                          <td>{f.loc_added > 0 ? f.loc_added.toLocaleString() : "—"}</td>
                          <td>{locRate}{locRate !== "—" ? "%" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="chart-empty">Không có dữ liệu</div>}
          </div>
        </div>
      </Section>

      {/* ── IDE & Language Breakdown ──────────────────────────────────────── */}
      <Section sectionKey="ideLang" title="🖥️ IDE & Ngôn ngữ lập trình">
        <div className="dashboard-charts">
          {/* IDE Pie */}
          <div className="chart-card">
            <ChartTitle text="IDE đang sử dụng" />
            {ide_totals.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={ide_totals.map((d: any) => ({ name: d.ide.toUpperCase(), value: d.interactions + d.code_gen }))}
                      dataKey="value" nameKey="name"
                      cx="50%" cy="50%" outerRadius={80}
                      label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                    >
                      {ide_totals.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dashboard-table-wrap" style={{ marginTop: 8 }}>
                  <table className="dashboard-table">
                    <thead>
                      <tr><th>IDE</th><th>Interactions</th><th>Code Gen</th><th>LOC Gợi ý</th><th>LOC Thêm</th></tr>
                    </thead>
                    <tbody>
                      {ide_totals.map((d: any, i: number) => (
                        <tr key={d.ide} style={{ background: i % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-tertiary)" }}>
                          <td style={{ fontWeight: 600 }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: COLORS[i % COLORS.length], marginRight: 6 }} />
                            {d.ide.toUpperCase()}
                          </td>
                          <td>{d.interactions.toLocaleString()}</td>
                          <td>{d.code_gen.toLocaleString()}</td>
                          <td>{d.loc_suggested.toLocaleString()}</td>
                          <td>{d.loc_added.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <div className="chart-empty">Không có dữ liệu</div>}
          </div>

          {/* Top Languages */}
          <div className="chart-card chart-card-wide">
            <ChartTitle text="Top ngôn ngữ lập trình (theo Code Gen)" />
            {lang_totals.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, lang_totals.length * 26)}>
                <BarChart data={lang_totals.map((l: any) => ({
                  lang: l.language,
                  "Code Gen": l.code_gen,
                  "Code Accept": l.code_accept,
                  "LOC Gợi ý": l.loc_suggested,
                }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis dataKey="lang" type="category" width={90} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Code Gen" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="chart-empty">Không có dữ liệu</div>}
          </div>
        </div>
      </Section>

      {/* ── Pull Requests & CLI ───────────────────────────────────────────── */}
      <Section sectionKey="prCli" title="🔀 Pull Requests & CLI" defaultOpen={false}>
        <div className="dashboard-charts">
          {/* PR stats */}
          <div className="chart-card">
            <ChartTitle text="Pull Request Copilot" />
            <div className="dashboard-kpi" style={{ flexWrap: "wrap", gap: 8 }}>
              {[
                { label: "PR Tạo bởi Copilot", key: "total_created_by_copilot", icon: "🤖" },
                { label: "PR Review bởi Copilot", key: "total_reviewed_by_copilot", icon: "👀" },
                { label: "PR đã Merge", key: "total_merged", icon: "✅" },
                { label: "Suggestions đề xuất", key: "total_copilot_suggestions", icon: "💡" },
                { label: "Suggestions được apply", key: "total_copilot_applied_suggestions", icon: "✔️" },
              ].map(({ label, key, icon }) => (
                <div className="stat-card" key={key} style={{ minWidth: 120 }}>
                  <div className="stat-value">{((pr_totals as any)[key] ?? 0).toLocaleString()}</div>
                  <div className="stat-label">{icon} {label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              * Số liệu PR là tổng toàn org, không lọc theo group
            </div>
          </div>

          {/* CLI stats */}
          <div className="chart-card">
            <ChartTitle text="Copilot CLI Usage" />
            <div className="dashboard-kpi" style={{ flexWrap: "wrap", gap: 8 }}>
              {[
                { label: "Sessions", key: "session_count", icon: "🖥️" },
                { label: "Requests", key: "request_count", icon: "📤" },
                { label: "Prompts", key: "prompt_count", icon: "💬" },
                { label: "Output Tokens", key: "output_tokens", icon: "📊" },
              ].map(({ label, key, icon }) => (
                <div className="stat-card" key={key} style={{ minWidth: 120 }}>
                  <div className="stat-value">{((cli_totals as any)[key] ?? 0).toLocaleString()}</div>
                  <div className="stat-label">{icon} {label}</div>
                </div>
              ))}
            </div>
            {(cli_totals as any).prompt_tokens > 0 && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
                📥 Prompt tokens: {((cli_totals as any).prompt_tokens ?? 0).toLocaleString()} &nbsp;
                (avg {(cli_totals as any).request_count > 0
                  ? Math.round(((cli_totals as any).prompt_tokens + (cli_totals as any).output_tokens) / (cli_totals as any).request_count).toLocaleString()
                  : 0} tokens/request)
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              * Số liệu CLI là tổng toàn org, không lọc theo group
            </div>
          </div>
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
