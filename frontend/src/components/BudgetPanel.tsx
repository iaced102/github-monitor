import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../contexts/I18nContext";

interface BudgetEntry {
  org: string;
  monthly_budget_usd: number | null;
  current_cost_usd: number;
  utilization_pct: number | null;
  status: "critical" | "warning" | "ok" | "unset";
  note: string;
}

const STATUS_COLOR: Record<string, string> = {
  critical: "#e74c3c",
  warning: "#f39c12",
  ok: "#27ae60",
  unset: "#888",
};

function UtilBar({ pct, status }: { pct: number | null; status: string }) {
  if (pct === null) return <span style={{ color: "#888", fontSize: "0.8em" }}>—</span>;
  const clamp = Math.min(pct, 100);
  return (
    <div className="budget-bar-wrap">
      <div className="budget-bar-bg">
        <div
          className="budget-bar-fill"
          style={{ width: `${clamp}%`, background: STATUS_COLOR[status] || "#888" }}
        />
      </div>
      <span className="budget-bar-label" style={{ color: STATUS_COLOR[status] }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

export function BudgetPanel() {
  const { t } = useI18n();
  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ budget: string; note: string }>({ budget: "", note: "" });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/budgets")
      .then((r) => r.json())
      .then((d) => setBudgets(d.budgets || []))
      .catch(() => setBudgets([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startEdit = (entry: BudgetEntry) => {
    setEditing(entry.org);
    setDraft({
      budget: entry.monthly_budget_usd != null ? String(entry.monthly_budget_usd) : "",
      note: entry.note || "",
    });
  };

  const saveBudget = async (org: string) => {
    const val = parseFloat(draft.budget);
    if (!val || val <= 0) { alert(t("budget.monthly") + " must be > 0"); return; }
    setSaving(true);
    try {
      await fetch(`/api/budgets/${encodeURIComponent(org)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_budget_usd: val, note: draft.note }),
      });
      setEditing(null);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const deleteBudget = async (org: string) => {
    if (!confirm(t("budget.deleteConfirm"))) return;
    await fetch(`/api/budgets/${encodeURIComponent(org)}`, { method: "DELETE" });
    refresh();
  };

  if (loading) return <div className="budget-panel loading">{t("loading")}</div>;

  if (budgets.length === 0) {
    return (
      <div className="panel-empty-state">
        <div className="panel-empty-icon">💰</div>
        <p className="panel-empty-title">{t("budget.noBudgetOrgs")}</p>
        <p className="panel-empty-hint">{t("budget.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="budget-panel">
      <table className="budget-table">
        <thead>
          <tr>
            <th>Org</th>
            <th>{t("budget.monthly")}</th>
            <th>{t("budget.current")}</th>
            <th>{t("budget.utilization")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {budgets.map((entry) => (
            <tr key={entry.org}>
              <td className="budget-org">{entry.org}</td>
              <td>
                {editing === entry.org ? (
                  <input
                    type="number"
                    className="budget-input"
                    value={draft.budget}
                    onChange={(e) => setDraft((d) => ({ ...d, budget: e.target.value }))}
                    placeholder="e.g. 5000"
                    autoFocus
                  />
                ) : entry.monthly_budget_usd != null ? (
                  <span>${entry.monthly_budget_usd.toLocaleString()}</span>
                ) : (
                  <span style={{ color: "#888" }}>{t("budget.unset")}</span>
                )}
              </td>
              <td>${entry.current_cost_usd.toLocaleString()}</td>
              <td>
                <UtilBar pct={entry.utilization_pct} status={entry.status} />
              </td>
              <td className="budget-actions">
                {editing === entry.org ? (
                  <>
                    <input
                      type="text"
                      className="budget-note-input"
                      value={draft.note}
                      onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                      placeholder={t("budget.note")}
                    />
                    <button
                      className="btn btn-small"
                      onClick={() => saveBudget(entry.org)}
                      disabled={saving}
                    >
                      {saving ? "..." : t("budget.save")}
                    </button>
                    <button
                      className="btn btn-small btn-ghost"
                      onClick={() => setEditing(null)}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-small btn-toggle" onClick={() => startEdit(entry)}>
                      ✏
                    </button>
                    {entry.monthly_budget_usd != null && (
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() => deleteBudget(entry.org)}
                        title={t("budget.delete")}
                      >
                        🗑
                      </button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
