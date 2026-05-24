import { useEffect, useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";
import { useI18n } from "../contexts/I18nContext";
import { exportCSV } from "../utils/export";

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f778ba"];
const TOOLTIP_STYLE = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

interface UserTimeline {
  username: string;
  has_data: boolean;
  kpi: { total_interactions: number; total_code_gen: number; total_code_accept: number; acceptance_rate: number; active_days: number };
  timeline: { day: string; interactions: number; code_gen: number; code_accept: number; loc_suggested: number; loc_accepted: number }[];
  features: { feature: string; interactions: number; code_gen: number; code_accept: number }[];
  models: { model: string; interactions: number; code_gen: number }[];
  ides: { ide: string; interactions: number; code_gen: number }[];
}

interface Props {
  username: string;
  orgs?: string[];
  groupId?: number | null;
  onClose: () => void;
}

const FEATURE_MAP: Record<string, string> = {
  chat_panel_agent_mode: "Chat – Agent",
  chat_panel_ask_mode: "Chat – Ask",
  chat_panel_plan_mode: "Chat – Plan",
  chat_panel_custom_mode: "Chat – Custom",
  chat_panel_default: "Chat – Default",
  chat_panel_unknown_mode: "Chat – Unknown",
  chat_inline: "Chat – Inline",
  copilot_cli: "Copilot CLI",
  code_completion: "Code Completions",
  code_completions: "Code Completions",
  agent_edit: "Agent Edit",
};

export function UserDetailModal({ username, orgs, groupId, onClose }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<UserTimeline | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qp = new URLSearchParams({ username });
      if (orgs && orgs.length > 0) qp.set("orgs", orgs.join(","));
      if (groupId) qp.set("group_id", String(groupId));
      const res = await fetch(`/api/data/user-timeline?${qp}`);
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [username, orgs?.join(","), groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleExport = () => {
    if (!data?.timeline) return;
    exportCSV(`user-timeline-${username}`, data.timeline);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel user-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            👤 {username}
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-small" onClick={handleExport} title="Export CSV">⬇ CSV</button>
            <button className="modal-close" onClick={onClose} title={t("console.close") || "Close"}>✕</button>
          </div>
        </div>

        {loading && <div className="dashboard-loading" style={{ padding: 32 }}>{t("loading")}</div>}
        {!loading && (!data || !data.has_data) && (
          <div className="chart-empty" style={{ padding: 32 }}>{t("dashboard.noData")}</div>
        )}

        {!loading && data?.has_data && (
          <div className="user-detail-body">
            {/* KPI Row */}
            <div className="user-detail-kpi">
              <div className="user-detail-kpi-item">
                <span className="kpi-label">{t("monitor.interactions") || "Interactions"}</span>
                <span className="kpi-value">{data.kpi.total_interactions.toLocaleString()}</span>
              </div>
              <div className="user-detail-kpi-item">
                <span className="kpi-label">Code Gen</span>
                <span className="kpi-value">{data.kpi.total_code_gen.toLocaleString()}</span>
              </div>
              <div className="user-detail-kpi-item">
                <span className="kpi-label">Accepted</span>
                <span className="kpi-value">{data.kpi.total_code_accept.toLocaleString()}</span>
              </div>
              <div className="user-detail-kpi-item">
                <span className="kpi-label">Accept Rate</span>
                <span className="kpi-value accent">{data.kpi.acceptance_rate}%</span>
              </div>
              <div className="user-detail-kpi-item">
                <span className="kpi-label">Active Days</span>
                <span className="kpi-value">{data.kpi.active_days}</span>
              </div>
            </div>

            {/* Daily Timeline Chart */}
            {data.timeline.length > 0 && (
              <div className="user-detail-section">
                <h4 className="user-detail-section-title">Daily Activity</h4>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={data.timeline} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={36} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="code_gen" name="Code Gen" stroke="#58a6ff" fill="rgba(88,166,255,0.2)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="code_accept" name="Accepted" stroke="#3fb950" fill="rgba(63,185,80,0.15)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="interactions" name="Interactions" stroke="#d29922" fill="rgba(210,153,34,0.1)" strokeWidth={1} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="user-detail-row">
              {/* Feature breakdown */}
              {data.features.length > 0 && (
                <div className="user-detail-section user-detail-half">
                  <h4 className="user-detail-section-title">Features</h4>
                  <div className="user-detail-table-wrap">
                    <table className="dashboard-table">
                      <thead><tr><th>Feature</th><th>Interact.</th><th>Code Gen</th><th>Accept</th></tr></thead>
                      <tbody>
                        {data.features.slice(0, 8).map((f) => (
                          <tr key={f.feature}>
                            <td style={{ fontSize: 11 }}>{FEATURE_MAP[f.feature] || f.feature}</td>
                            <td>{f.interactions.toLocaleString()}</td>
                            <td>{f.code_gen.toLocaleString()}</td>
                            <td>{f.code_accept.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Model breakdown */}
              {data.models.length > 0 && (
                <div className="user-detail-section user-detail-half">
                  <h4 className="user-detail-section-title">Models Used</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={data.models.slice(0, 8)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                      <YAxis dataKey="model" type="category" width={80} tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                        tickFormatter={(v) => v.split("-").slice(-1)[0] || v} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      {data.models.slice(0, 8).map((_, i) => (
                        <Bar key={i} dataKey="interactions" fill={COLORS[i % COLORS.length]} radius={[0, 4, 4, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
