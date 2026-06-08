import { useCallback, useEffect } from "react";
import { useI18n } from "../contexts/I18nContext";
import { useUIState } from "../contexts/UIStateContext";
import { useCurrentUser } from "../contexts/AuthContext";
import { Dashboard } from "./Dashboard";
import { CsvDashboard } from "./CsvDashboard";
import { CostCenterDashboard } from "./CostCenterDashboard";
import { UsageMonitorDashboard } from "./UsageMonitorDashboard";
import { UserGroupsPage } from "./UserGroupsPage";
import { GroupFilter } from "./GroupFilter";
import { RoiDashboard } from "./RoiDashboard";

type DashTab = "metrics" | "premium" | "usage" | "costcenter" | "monitor" | "roi" | "groups";

interface Props {
  refreshKey: number;
}

export function UnifiedDashboard({ refreshKey }: Props) {
  const { t } = useI18n();
  const ui = useUIState();
  const { currentUser } = useCurrentUser();
  const tab = (ui.dashboardTab ?? "metrics") as DashTab;
  const setTab = useCallback(
    (v: DashTab) => ui.patch({ dashboardTab: v as any }),
    [ui.patch],
  );

  const selectedOrgs = ui.dashboardSelectedOrgs ?? [];
  const isSuperAdmin = currentUser?.role === "super_admin";
  const dateFrom = ui.dashboardDateFrom;
  const dateTo = ui.dashboardDateTo;

  // Redirect managers away from the groups-admin tab
  useEffect(() => {
    if (!isSuperAdmin && tab === "groups") {
      ui.patch({ dashboardTab: "metrics" });
    }
  }, [isSuperAdmin, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="unified-dashboard">
      <div className="dashboard-tab-bar">
        <div className="view-toggle">
          <button className={`btn btn-small btn-toggle ${tab === "metrics" ? "btn-toggle-active" : ""}`} onClick={() => setTab("metrics")}>
            {t("nav.dashMetrics")}
          </button>
          <button className={`btn btn-small btn-toggle ${tab === "premium" ? "btn-toggle-active" : ""}`} onClick={() => setTab("premium")}>
            {t("csvDash.tabs.premium")}
          </button>
          <button className={`btn btn-small btn-toggle ${tab === "usage" ? "btn-toggle-active" : ""}`} onClick={() => setTab("usage")}>
            {t("csvDash.tabs.usage")}
          </button>
          <button className={`btn btn-small btn-toggle ${tab === "costcenter" ? "btn-toggle-active" : ""}`} onClick={() => setTab("costcenter")}>
            {t("ccDash.tab")}
          </button>
          <button className={`btn btn-small btn-toggle ${tab === "monitor" ? "btn-toggle-active" : ""}`} onClick={() => setTab("monitor")}>
            {t("monitor.tab")}
          </button>
          <button className={`btn btn-small btn-toggle ${tab === "roi" ? "btn-toggle-active" : ""}`} onClick={() => setTab("roi")}>
            ROI
          </button>
          {isSuperAdmin && (
            <button className={`btn btn-small btn-toggle ${tab === "groups" ? "btn-toggle-active" : ""}`} onClick={() => setTab("groups")}>
              {t("groups.tab")}
            </button>
          )}
        </div>
        {/* Group scope filter — shown on all data tabs */}
        {tab !== "groups" && <GroupFilter />}
      </div>

      {/* Date range filter — shown on all data tabs */}
      {tab !== "groups" && (
        <div className="dashboard-filters" style={{ marginBottom: 8 }}>
          <div className="dashboard-filter-group">
            <input type="date" className="dashboard-date-input" value={dateFrom} onChange={(e) => ui.patch({ dashboardDateFrom: e.target.value })} />
            <span className="dashboard-date-sep">—</span>
            <input type="date" className="dashboard-date-input" value={dateTo} onChange={(e) => ui.patch({ dashboardDateTo: e.target.value })} />
            {(dateFrom || dateTo) && (
              <button onClick={() => ui.patch({ dashboardDateFrom: "", dashboardDateTo: "" })} style={{ marginLeft: 6, fontSize: 11, cursor: "pointer", background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px" }}>
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {tab !== "groups" && ui.selectedGroupId !== null && (
        <div className="scope-banner">
          🔍 {t("groups.scopeBanner")}: <strong>{ui.selectedGroupName || t("groups.filtered")}</strong>
        </div>
      )}

      {tab === "metrics" ? (
        <Dashboard refreshKey={refreshKey} />
      ) : tab === "costcenter" ? (
        <CostCenterDashboard refreshKey={refreshKey} />
      ) : tab === "monitor" ? (
        <UsageMonitorDashboard refreshKey={refreshKey} selectedOrgs={selectedOrgs} />
      ) : tab === "roi" ? (
        <RoiDashboard refreshKey={refreshKey} />
      ) : tab === "groups" ? (
        <UserGroupsPage />
      ) : (
        <CsvDashboard refreshKey={refreshKey} tab={tab as "premium" | "usage"} />
      )}
    </div>
  );
}
