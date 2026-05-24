import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../contexts/I18nContext";

interface Alert {
  id: string;
  type: string;
  level: "critical" | "warning";
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  created_at: string;
}

interface AlertsData {
  alerts: Alert[];
  count: number;
  critical: number;
  warning: number;
}

interface ThresholdConfig {
  enabled: boolean;
  warn: number;
  critical: number;
  description: string;
}

interface AlertConfig {
  enabled: boolean;
  thresholds: Record<string, ThresholdConfig>;
}

// Badge shown in StatusBar — exported for use outside this file
export function AlertBadge({ onClick }: { onClick: () => void }) {
  const [data, setData] = useState<AlertsData | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/alerts/active")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!data || data.count === 0) return null;

  const cls = data.critical > 0 ? "alert-badge critical" : "alert-badge warning";
  return (
    <button className={`btn btn-small ${cls}`} onClick={onClick} title="View alerts">
      {data.critical > 0 ? "🔴" : "🟡"} {data.count}
    </button>
  );
}

export function AlertPanel() {
  const { t } = useI18n();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [draftConfig, setDraftConfig] = useState<AlertConfig | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/alerts/active").then((r) => r.json()),
      fetch("/api/alerts/config").then((r) => r.json()),
    ])
      .then(([alertsData, cfgData]) => {
        setAlerts(alertsData.alerts || []);
        setDraftConfig(JSON.parse(JSON.stringify(cfgData)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveConfig = async () => {
    if (!draftConfig) return;
    setSaving(true);
    try {
      const r = await fetch("/api/alerts/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftConfig),
      });
      const d = await r.json();
      if (d.ok) {
        setSavedMsg(t("alerts.saved"));
        setTimeout(() => setSavedMsg(""), 2000);
        await refresh();
        setConfigOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (key: string, field: string, value: unknown) => {
    setDraftConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        thresholds: {
          ...prev.thresholds,
          [key]: { ...prev.thresholds[key], [field]: value },
        },
      };
    });
  };

  const THRESHOLD_META: Record<string, { label: string; higherIsBad: boolean; unit: string }> = {
    inactive_rate: { label: t("alerts.inactiveRate"), higherIsBad: true, unit: "%" },
    cost_waste_pct: { label: t("alerts.costWastePct"), higherIsBad: true, unit: "%" },
    acceptance_rate: { label: t("alerts.acceptanceRate"), higherIsBad: false, unit: "%" },
    no_active_days: { label: t("alerts.noActiveDays"), higherIsBad: true, unit: "days" },
  };

  if (loading) return <div className="alert-panel loading">{t("loading")}</div>;

  return (
    <div className="alert-panel">
      <div className="alert-panel-header">
        <span className="alert-panel-title">
          {alerts.length > 0
            ? `${alerts.filter((a) => a.level === "critical").length > 0 ? "🔴" : "🟡"} ${alerts.length} ${t("alerts.title")}`
            : `✅ ${t("alerts.title")}`}
        </span>
        <button
          className="btn btn-small btn-toggle"
          onClick={() => { setConfigOpen(!configOpen); }}
        >
          ⚙ {t("alerts.configure")}
        </button>
      </div>

      {alerts.length === 0 ? (
        <div className="panel-empty-state panel-empty-state-sm">
          <div className="panel-empty-icon">✅</div>
          <p className="panel-empty-title">{t("alerts.noAlerts")}</p>
          <p className="panel-empty-hint">{t("alerts.noAlertsHint")}</p>
        </div>
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <div key={alert.id} className={`alert-item alert-${alert.level}`}>
              <div className="alert-item-header">
                <span className="alert-level-badge">
                  {alert.level === "critical" ? t("alerts.critical") : t("alerts.warning")}
                </span>
                <span className="alert-title">{alert.title}</span>
              </div>
              <div className="alert-message">{alert.message}</div>
            </div>
          ))}
        </div>
      )}

      {configOpen && draftConfig && (
        <div className="alert-config">
          <div className="alert-config-row">
            <label>
              <input
                type="checkbox"
                checked={draftConfig.enabled}
                onChange={(e) => setDraftConfig((p) => p ? { ...p, enabled: e.target.checked } : p)}
              />
              {" "}{t("alerts.enabled")}
            </label>
          </div>
          {Object.entries(draftConfig.thresholds).map(([key, thresh]) => {
            const meta = THRESHOLD_META[key];
            if (!meta) return null;
            return (
              <div key={key} className="alert-config-section">
                <div className="alert-config-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={thresh.enabled}
                      onChange={(e) => updateDraft(key, "enabled", e.target.checked)}
                    />
                    {" "}{meta.label}
                  </label>
                </div>
                <div className="alert-config-inputs">
                  <label>
                    {t("alerts.warnLevel")} ({meta.higherIsBad ? t("alerts.higherIsBad") : t("alerts.lowerIsBad")} {thresh.warn}{meta.unit})
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={thresh.warn}
                      onChange={(e) => updateDraft(key, "warn", parseFloat(e.target.value))}
                    />
                  </label>
                  <label>
                    {t("alerts.criticalLevel")} ({meta.higherIsBad ? t("alerts.higherIsBad") : t("alerts.lowerIsBad")} {thresh.critical}{meta.unit})
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={thresh.critical}
                      onChange={(e) => updateDraft(key, "critical", parseFloat(e.target.value))}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <div className="alert-config-actions">
            {savedMsg && <span className="alert-saved-msg">{savedMsg}</span>}
            <button className="btn btn-small" onClick={saveConfig} disabled={saving}>
              {saving ? "..." : t("alerts.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
