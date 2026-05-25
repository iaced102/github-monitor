import { useEffect } from "react";
import { useI18n } from "../contexts/I18nContext";
import { usePATs } from "../hooks/usePATs";

interface Props {
  onClose: () => void;
  onPATChange?: () => void;
}

const CRON_PRESETS = [
  { label: "30min", cron: "*/30 * * * *" },
  { label: "1h", cron: "0 */1 * * *" },
  { label: "6h", cron: "0 */6 * * *" },
  { label: "24h", cron: "0 0 * * *" },
  { label: "Off", cron: "" },
];

function describeCron(cron: string): string {
  if (!cron.trim()) return "";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "";
  const [minute, hour, dom, , ] = parts;
  const stepMin = minute.match(/^\*\/(\d+)$/);
  if (stepMin && hour === "*" && dom === "*") {
    const n = parseInt(stepMin[1]);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  const stepHr = hour.match(/^\*\/(\d+)$/);
  if (minute === "0" && stepHr && dom === "*") {
    const n = parseInt(stepHr[1]);
    return n === 1 ? "Every hour" : `Every ${n} hours`;
  }
  if (minute === "0" && hour === "0" && dom === "*") return "Daily";
  const stepDay = dom.match(/^\*\/(\d+)$/);
  if (minute === "0" && hour === "0" && stepDay) {
    return `Every ${stepDay[1]} days`;
  }
  return "";
}

export function PATSettingsModal({ onClose, onPATChange: _onPATChange }: Props) {
  const { t } = useI18n();
  const { pats, settings, updateSettings } = usePATs();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>{t("settings.title")}</h2>
          <button className="settings-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-modal-body">
          {/* Connected accounts — read-only, configured via .env */}
          {pats.length > 0 && (
            <>
              <h3>{t("settings.pats")}</h3>
              <div className="pat-list">
                {pats.map((pat) => (
                  <div key={pat.id} className="pat-item">
                    <div className="pat-item-left">
                      {pat.user_avatar && (
                        <img src={pat.user_avatar} alt={pat.user_login} className="pat-avatar" />
                      )}
                      <div className="pat-item-info">
                        <div className="pat-item-user">
                          <strong>{pat.user_login || "Validating..."}</strong>
                          {(pat.orgs?.length > 0 || !pat.enterprise_slugs?.length) && (
                            <span className="pat-item-orgs">{pat.orgs?.length || 0} orgs</span>
                          )}
                          {pat.enterprise_slugs?.length > 0 && (
                            <span className="pat-item-enterprise">{pat.enterprise_slugs.join(", ")}</span>
                          )}
                        </div>
                        <div className="pat-item-meta">{pat.label} &middot; {pat.token_masked}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="pat-form-hint">
                Cấu hình GitHub PAT qua biến môi trường <code>GITHUB_PAT</code> trong file <code>.env</code>.
              </p>
            </>
          )}

          {/* Sync Settings */}
          <div className="sync-settings">
            <h3>{t("settings.syncSettings")}</h3>

            <div className="sync-setting-row">
              <span className="sync-setting-label">{t("settings.autoSync")}</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.auto_sync_on_startup}
                  onChange={(e) => updateSettings({ auto_sync_on_startup: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="sync-setting-row">
              <span className="sync-setting-label">{t("settings.syncCron")}</span>
              <div className="sync-cron-input-group">
                <input
                  type="text"
                  className="sync-cron-input"
                  value={settings.sync_cron}
                  onChange={(e) => updateSettings({ sync_cron: e.target.value })}
                  placeholder="e.g. 0 */6 * * *"
                />
                {describeCron(settings.sync_cron) && (
                  <span className="sync-cron-desc">{describeCron(settings.sync_cron)}</span>
                )}
              </div>
            </div>

            <div className="sync-cron-presets">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`btn btn-small btn-preset ${settings.sync_cron === p.cron ? "btn-preset-active" : ""}`}
                  onClick={() => updateSettings({ sync_cron: p.cron })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="pat-form-hint">{t("settings.cronHint")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
