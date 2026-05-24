import { useState, useCallback } from "react";
import { useUIState } from "../contexts/UIStateContext";
import { useI18n } from "../contexts/I18nContext";
import { useLifecycleScan } from "../hooks/useData";
import { exportCSV } from "../utils/export";

interface Props {
  onRecommendationsCreated?: () => void;
}

export function LifecyclePanel({ onRecommendationsCreated }: Props) {
  const ui = useUIState();
  const { t } = useI18n();
  const [thresholdDays, setThresholdDays] = useState(30);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const { data, loading, scan } = useLifecycleScan(thresholdDays, ui.selectedGroupId);

  const toggleUser = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data?.users) return;
    setSelected(new Set(data.users.map((u: any) => `${u.org}::${u.user}`)));
  }, [data]);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  const createRecommendations = useCallback(async () => {
    if (!data?.users || selected.size === 0) return;
    setCreating(true);
    try {
      const users = data.users.filter((u: any) => selected.has(`${u.org}::${u.user}`));
      const res = await fetch("/api/data/lifecycle-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users }),
      });
      const result = await res.json();
      setDone(result.created ?? 0);
      setSelected(new Set());
      onRecommendationsCreated?.();
    } catch {
      setDone(0);
    } finally {
      setCreating(false);
    }
  }, [data, selected, onRecommendationsCreated]);

  const handleExport = useCallback(() => {
    if (!data?.users) return;
    exportCSV("inactive-seats", data.users);
  }, [data]);

  return (
    <div className="lifecycle-panel">
      <div className="lifecycle-controls">
        <label className="lifecycle-label">
          {t("lifecycle.inactiveThreshold")}
          <select
            className="lifecycle-select"
            value={thresholdDays}
            onChange={(e) => setThresholdDays(Number(e.target.value))}
          >
            <option value={14}>{t("lifecycle.days14")}</option>
            <option value={30}>{t("lifecycle.days30")}</option>
            <option value={60}>{t("lifecycle.days60")}</option>
            <option value={90}>{t("lifecycle.days90")}</option>
          </select>
        </label>
        <button className="btn btn-small btn-primary" onClick={scan} disabled={loading}>
          {loading ? t("lifecycle.scanning") : t("lifecycle.scan")}
        </button>
      </div>

      {data && (
        <>
          <div className="lifecycle-summary">
            <span className="lifecycle-badge danger">{data.inactive_count} inactive</span>
            <span className="lifecycle-badge">Waste: ${data.monthly_waste.toFixed(0)}/mo</span>
            <button className="btn btn-small" style={{ marginLeft: "auto" }} onClick={handleExport}>⬇ CSV</button>
          </div>

          {data.users.length > 0 && (
            <>
              <div className="lifecycle-actions">
                <button className="btn btn-small" onClick={selectAll}>{t("lifecycle.selectAll")}</button>
                <button className="btn btn-small" onClick={clearAll}>{t("lifecycle.clear")}</button>
                {selected.size > 0 && (
                  <button
                    className="btn btn-small btn-approve"
                    disabled={creating}
                    onClick={createRecommendations}
                  >
                    {creating ? t("lifecycle.creating") : `${t("lifecycle.recommend")} ${selected.size}`}
                  </button>
                )}
              </div>

              {done !== null && (
                <div className="lifecycle-done">✅ {done} {t("lifecycle.done")}</div>
              )}

              <div className="lifecycle-table-wrap">
                <table className="dashboard-table" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th>
                      <th>{t("lifecycle.colUser")}</th>
                      <th>{t("lifecycle.colOrg")}</th>
                      <th>{t("lifecycle.colLastActive")}</th>
                      <th>{t("lifecycle.colDays")}</th>
                      <th>{t("lifecycle.colCost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u: any) => {
                      const key = `${u.org}::${u.user}`;
                      return (
                        <tr key={key} className={selected.has(key) ? "lifecycle-row-selected" : ""}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(key)}
                              onChange={() => toggleUser(key)}
                            />
                          </td>
                          <td className="user-name">{u.user}</td>
                          <td>{u.org}</td>
                          <td>{u.last_activity_at ?? "Never"}</td>
                          <td>
                            <span className={`dash-status-badge ${u.days_inactive >= 90 ? "danger" : u.days_inactive >= 30 ? "warning" : ""}`}>
                              {u.days_inactive >= 999 ? "∞" : u.days_inactive}d
                            </span>
                          </td>
                          <td>${u.monthly_cost}/mo</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
