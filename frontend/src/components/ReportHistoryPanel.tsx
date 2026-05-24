import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../contexts/I18nContext";

interface ReportEntry {
  id: string;
  period_type: "monthly" | "quarterly";
  year: number;
  period: number;
  format: "html" | "csv" | "xlsx";
  orgs: string[];
  filename: string;
  size: number;
  created_at: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const FORMAT_ICON: Record<string, string> = {
  html: "🌐",
  csv: "📄",
  xlsx: "📑",
};

export function ReportHistoryPanel() {
  const { t } = useI18n();
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/data/report-history")
      .then((r) => r.json())
      .then((d) => setReports(d.reports || []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDownload = async (report: ReportEntry) => {
    setDownloading(report.id);
    try {
      const r = await fetch(`/api/data/report-history/${report.id}`);
      if (!r.ok) { alert("Download failed"); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = report.filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (report: ReportEntry) => {
    if (!confirm(t("reportHistory.deleteConfirm"))) return;
    setDeleting(report.id);
    try {
      await fetch(`/api/data/report-history/${report.id}`, { method: "DELETE" });
      refresh();
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <div className="report-history loading">{t("loading")}</div>;

  return (
    <div className="report-history">
      {reports.length === 0 ? (
        <div className="panel-empty-state">
          <div className="panel-empty-icon">📊</div>
          <p className="panel-empty-title">{t("reportHistory.empty")}</p>
          <p className="panel-empty-hint">{t("reportHistory.emptyHint")}</p>
        </div>
      ) : (
        <table className="report-history-table">
          <thead>
            <tr>
              <th>{t("reportHistory.format")}</th>
              <th>Period</th>
              <th>{t("reportHistory.orgs")}</th>
              <th>{t("reportHistory.size")}</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td>
                  <span title={r.format}>{FORMAT_ICON[r.format] || r.format}</span>
                  {" "}
                  <span className="report-format-label">{r.format.toUpperCase()}</span>
                </td>
                <td>
                  {r.period_type === "monthly"
                    ? `${r.year}-M${String(r.period).padStart(2, "0")}`
                    : `${r.year}-Q${r.period}`}
                </td>
                <td>
                  {r.orgs && r.orgs.length > 0
                    ? r.orgs.slice(0, 2).join(", ") + (r.orgs.length > 2 ? ` +${r.orgs.length - 2}` : "")
                    : t("reportHistory.allOrgs")}
                </td>
                <td>{formatSize(r.size)}</td>
                <td title={r.created_at}>{formatDate(r.created_at)}</td>
                <td className="report-history-actions">
                  <button
                    className="btn btn-small"
                    onClick={() => handleDownload(r)}
                    disabled={downloading === r.id}
                    title={t("reportHistory.download")}
                  >
                    {downloading === r.id ? "..." : "⬇"}
                  </button>
                  <button
                    className="btn btn-small btn-ghost"
                    onClick={() => handleDelete(r)}
                    disabled={deleting === r.id}
                    title={t("reportHistory.delete")}
                  >
                    {deleting === r.id ? "..." : "🗑"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
