import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "../contexts/AuthContext";
import { useUIState } from "../contexts/UIStateContext";
import { useI18n } from "../contexts/I18nContext";

interface GroupInfo { id: number; name: string; member_count: number; }

/**
 * GroupFilter – dropdown to select which user group to scope dashboard data to.
 *
 * Behaviour by role:
 * - super_admin: sees "All Users" + all groups (fetched from /api/groups)
 * - manager: sees only their assigned groups (no "All" option)
 *   If they have exactly one group it is auto-selected but still shown.
 */
export function GroupFilter() {
  const { currentUser } = useCurrentUser();
  const ui = useUIState();
  const { t } = useI18n();

  const selectedGroupId = ui.selectedGroupId;
  const setGroupId = useCallback(
    (id: number | null) => ui.patch({ selectedGroupId: id }),
    [ui.patch],
  );

  // For super_admin: load all groups from API
  const [allGroups, setAllGroups] = useState<GroupInfo[]>([]);
  useEffect(() => {
    if (currentUser?.role !== "super_admin") return;
    fetch("/api/groups")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.groups ?? []);
        setAllGroups(list);
      })
      .catch(() => {});
  }, [currentUser?.role]);

  if (!currentUser) return null;

  const isSuperAdmin = currentUser.role === "super_admin";
  const groups: GroupInfo[] = isSuperAdmin ? allGroups : currentUser.groups;

  // Manager with no assigned groups — show nothing
  if (!isSuperAdmin && groups.length === 0) return null;

  // Auto-select for manager with single group (but still render for visibility)
  if (!isSuperAdmin && groups.length === 1 && selectedGroupId === null) {
    // Defer to avoid React state-during-render warning
    setTimeout(() => setGroupId(groups[0].id), 0);
  }

  return (
    <div className="group-filter">
      <label className="group-filter-label">{t("groups.filterLabel")}</label>
      <select
        className="group-filter-select"
        value={selectedGroupId ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          setGroupId(val === "" ? null : Number(val));
        }}
      >
        {isSuperAdmin && (
          <option value="">{t("groups.allUsers")}</option>
        )}
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.member_count})
          </option>
        ))}
      </select>
    </div>
  );
}
