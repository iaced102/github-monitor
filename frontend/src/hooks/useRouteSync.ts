import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUIState } from "../contexts/UIStateContext";

type DashTab = "metrics" | "premium" | "usage" | "costcenter" | "monitor" | "roi" | "groups";

const VALID_TABS: DashTab[] = ["metrics", "premium", "usage", "costcenter", "monitor", "roi", "groups"];

export function useRouteSync() {
  const ui = useUIState();
  const navigate = useNavigate();
  const location = useLocation();
  const skipNextUrlEffect = useRef(false);

  // URL → State: hydrate UIState from URL on mount and on popstate/navigation
  useEffect(() => {
    if (skipNextUrlEffect.current) {
      skipNextUrlEffect.current = false;
      return;
    }

    const path = location.pathname;
    const search = new URLSearchParams(location.search);

    if (path === "/chat") {
      if (ui.currentView !== "chat") {
        ui.patch({ currentView: "chat" });
      }
      return;
    }

    const tabMatch = path.match(/^\/dashboard\/([a-z]+)$/);
    if (tabMatch) {
      const tab = tabMatch[1] as DashTab;
      if (VALID_TABS.includes(tab)) {
        const patches: Record<string, any> = {};

        if (ui.currentView !== "dashboard") patches.currentView = "dashboard";
        if (ui.dashboardTab !== tab) patches.dashboardTab = tab;

        const month = search.get("month");
        if (month !== null && month !== ui.dashboardDateFrom) {
          patches.dashboardDateFrom = month;
          patches.dashboardDateTo = "";
        }

        const group = search.get("group");
        if (group !== null) {
          const gid = Number(group);
          if (!isNaN(gid) && gid !== ui.selectedGroupId) {
            patches.selectedGroupId = gid;
          }
        } else if (group === null && ui.selectedGroupId !== null && !search.has("group")) {
          // Don't clear group from URL absence on every nav — only on explicit clear
        }

        const orgs = search.get("orgs");
        if (orgs !== null) {
          const orgList = orgs.split(",").filter(Boolean);
          patches.dashboardSelectedOrgs = orgList.length > 0 ? orgList : null;
        }

        if (Object.keys(patches).length > 0) {
          ui.patch(patches);
        }
      }
    }
  }, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // State → URL: push URL when UIState changes
  useEffect(() => {
    const targetPath = buildPath(ui.currentView, ui.dashboardTab as DashTab);
    const targetSearch = ui.currentView === "dashboard" && ui.dashboardTab !== "groups"
      ? buildSearch(ui.dashboardDateFrom, ui.selectedGroupId, ui.dashboardSelectedOrgs)
      : "";

    const currentFull = location.pathname + location.search;
    const targetFull = targetPath + targetSearch;

    if (currentFull !== targetFull) {
      skipNextUrlEffect.current = true;
      navigate(targetFull, { replace: true });
    }
  }, [ui.currentView, ui.dashboardTab, ui.dashboardDateFrom, ui.selectedGroupId, ui.dashboardSelectedOrgs, location.pathname, location.search, navigate]); // eslint-disable-line react-hooks/exhaustive-deps
}

function buildPath(view: string, tab: DashTab): string {
  if (view === "chat") return "/chat";
  return `/dashboard/${tab || "metrics"}`;
}

function buildSearch(month: string, groupId: number | null, orgs: string[] | null): string {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (groupId !== null) params.set("group", String(groupId));
  if (orgs && orgs.length > 0) params.set("orgs", orgs.join(","));
  const str = params.toString();
  return str ? `?${str}` : "";
}
