import { useCallback } from "react";
import { useI18n } from "../contexts/I18nContext";
import { useUIState } from "../contexts/UIStateContext";
import { useCurrentUser } from "../contexts/AuthContext";
import { Dashboard } from "./Dashboard";
import { CsvDashboard } from "./CsvDashboard";
import { CostCenterDashboard } from "./CostCenterDashboard";
import { UsageMonitorDashboard } from "./UsageMonitorDashboard";
import { UserGroupsPage } from "./UserGroupsPage";
import { GroupFilter } from "./GroupFilter";

interface Props {
  refreshKey: number;
}

export function UnifiedDashboard({ refreshKey }: Props) {
  const { t } = useI18n();
  const ui = useUIState();
  const { currentUser } = useCurrentUser();
  const tab = ui.dashboardTab ?? "metrics";
  const setTab = useCallback(
    (v: "metrics" | "premium" | "usage" | "costcenter" | "monitor" | "groups") =>
      ui.patch({ dashboardTab: v }),
    [ui.patch],
  );

  const selectedOrgs = ui.dashboardSelectedOrgs ?? [];
  const isSuperAdmin = currentUser?.role === "super_admin";

  return (
    <div className="unified-dashboard">
      <div className="dashboard-tab-bar">
        <div className="view-toggle">
          <button
            className={`btn btn-small btn-toggle ${tab === "metrics" ? "btn-toggle-active" : ""}`}
            onClick={() => setTab("metrics")}
          >
            {t("nav.dashMetrics")}
          </button>
          <button
            className={`btn btn-small btn-toggle ${tab === "premium" ? "btn-toggle-active" : ""}`}
            onClick={() => setTab("premium")}
          >
            {t("csvDash.tabs.premium")}
          </button>
          <button
            className={`btn btn-small btn-toggle ${tab === "usage" ? "btn-toggle-active" : ""}`}
            onClick={() => setTab("usage")}
          >
            {t("csvDash.tabs.usage")}
          </button>
          <button
            className={`btn btn-small btn-toggle ${tab === "costcenter" ? "btn-toggle-active" : ""}`}
            onClick={() => setTab("costcenter")}
          >
            {t("ccDash.tab")}
          </button>
          <button
            className={`btn btn-small btn-toggle ${tab === "monitor" ? "btn-toggle-active" : ""}`}
            onClick={() => setTab("monitor")}
          >
            {t("monitor.tab")}
          </button>
          {isSuperAdmin && (
            <button
              className={`btn btn-small btn-toggle ${tab === "groups" ? "btn-toggle-active" : ""}`}
              onClick={() => setTab("groups")}
            >
              {t("groups.tab")}
            </button>
          )}
        </div>
        {/* Group scope filter — shown on all data tabs */}
        {tab !== "groups" && <GroupFilter />}
      </div>

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
      ) : tab === "groups" ? (
        <UserGroupsPage />
      ) : (
        <CsvDashboard refreshKey={refreshKey} tab={tab as "premium" | "usage"} />
      )}
    </div>
  );
}
