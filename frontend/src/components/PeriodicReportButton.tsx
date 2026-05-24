import { useState } from "react";
import { useI18n } from "../contexts/I18nContext";

const MONTHS = [
  "jan","feb","mar","apr","may","jun",
  "jul","aug","sep","oct","nov","dec",
] as const;

const QUARTERS = ["q1","q2","q3","q4"] as const;

type ReportFormat = "html" | "csv" | "xlsx";

interface Props {
  selectedOrgs?: string[];
}

export function PeriodicReportButton({ selectedOrgs }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<ReportFormat | null>(null);
  const [periodType, setPeriodType] = useState<"monthly" | "quarterly">("monthly");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(() => new Date().getMonth() + 1); // 1-based

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const handleDownload = async (fmt: ReportFormat) => {
    setDownloading(fmt);
    try {
      const params = new URLSearchParams({
        period_type: periodType,
        year: String(year),
        period: String(period),
        format: fmt,
      });
      if (selectedOrgs && selectedOrgs.length > 0) {
        params.set("orgs", selectedOrgs.join(","));
      }
      const res = await fetch(`/api/data/periodic-report?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        alert(`Report generation failed: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const label = periodType === "monthly"
        ? `${year}-M${String(period).padStart(2, "0")}`
        : `${year}-Q${period}`;
      a.href = url;
      a.download = `periodic-report-${label}.${fmt === "xlsx" ? "xlsx" : fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setDownloading(null);
    }
  };

  const busy = downloading !== null;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        className="btn btn-small cc-download-btn"
        onClick={() => setOpen((o) => !o)}
        title={t("periodicReport.title")}
      >
        📅 {t("periodicReport.title")}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "16px",
            zIndex: 200,
            minWidth: 300,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "var(--text-primary)" }}>
            {t("periodicReport.title")}
          </div>

          {/* Selected org scope indicator */}
          {selectedOrgs && selectedOrgs.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10,
                          background: "var(--bg-tertiary)", borderRadius: 4, padding: "4px 8px" }}>
              🔎 {t("periodicReport.scopeOrgs")}: {selectedOrgs.length === 1
                ? selectedOrgs[0]
                : `${selectedOrgs.length} orgs`}
            </div>
          )}

          {/* Period Type Toggle */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              {t("periodicReport.monthly")} / {t("periodicReport.quarterly")}
            </div>
            <div className="view-toggle">
              <button
                className={`btn btn-small btn-toggle ${periodType === "monthly" ? "btn-toggle-active" : ""}`}
                onClick={() => { setPeriodType("monthly"); setPeriod(new Date().getMonth() + 1); }}
              >
                {t("periodicReport.monthly")}
              </button>
              <button
                className={`btn btn-small btn-toggle ${periodType === "quarterly" ? "btn-toggle-active" : ""}`}
                onClick={() => { setPeriodType("quarterly"); setPeriod(1); }}
              >
                {t("periodicReport.quarterly")}
              </button>
            </div>
          </div>

          {/* Year */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              {t("periodicReport.year")}
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-primary)",
                padding: "4px 8px",
                width: "100%",
                fontSize: 13,
              }}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Month or Quarter */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              {periodType === "monthly" ? t("periodicReport.month") : t("periodicReport.quarter")}
            </label>
            <select
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-primary)",
                padding: "4px 8px",
                width: "100%",
                fontSize: 13,
              }}
            >
              {periodType === "monthly"
                ? MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {i + 1} — {t(`periodicReport.${m}` as any)}
                    </option>
                  ))
                : QUARTERS.map((q, i) => (
                    <option key={q} value={i + 1}>
                      {t(`periodicReport.${q}` as any)}
                    </option>
                  ))}
            </select>
          </div>

          {/* Format + Actions */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              {t("periodicReport.format")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-small cc-download-btn"
                style={{ flex: 1 }}
                onClick={() => handleDownload("html")}
                disabled={busy}
              >
                {downloading === "html" ? t("periodicReport.downloading") : "🌐 HTML"}
              </button>
              <button
                className="btn btn-small"
                style={{ flex: 1, background: "var(--bg-tertiary)" }}
                onClick={() => handleDownload("csv")}
                disabled={busy}
              >
                {downloading === "csv" ? t("periodicReport.downloading") : "📊 CSV"}
              </button>
              <button
                className="btn btn-small"
                style={{ flex: 1, background: "var(--bg-tertiary)" }}
                onClick={() => handleDownload("xlsx")}
                disabled={busy}
              >
                {downloading === "xlsx" ? t("periodicReport.downloading") : "📑 Excel"}
              </button>
              <button
                className="btn btn-small"
                onClick={() => setOpen(false)}
                disabled={busy}
                style={{ flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
