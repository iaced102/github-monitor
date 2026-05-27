import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../contexts/I18nContext";
import { useCurrentUser } from "../contexts/AuthContext";
import type { GroupInfo } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiGet(path: string) {
  const res = await fetch(path);
  return res.json();
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiPut(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiDelete(path: string) {
  const res = await fetch(path, { method: "DELETE" });
  return res.json();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ManagerInfo {
  username: string;
  role: string;
  created_at: string;
  groups: GroupInfo[];
}

interface MemberListProps {
  groupId: number;
  onClose: () => void;
}

function MemberList({ groupId, onClose }: MemberListProps) {
  const { t } = useI18n();
  const [members, setMembers] = useState<string[]>([]);

  const loadMembers = useCallback(async () => {
    const data = await apiGet(`/api/groups/${groupId}/members`);
    setMembers(data.members || []);
  }, [groupId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="groups-modal-overlay" onClick={onClose}>
      <div className="groups-modal" onClick={(e) => e.stopPropagation()}>
        <div className="groups-modal-header">
          <h3>{t("groups.members")}</h3>
          <button className="groups-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="groups-modal-body">
          <div className="groups-member-list">
            {members.length === 0 ? (
              <div className="groups-empty-hint">No members</div>
            ) : (
              members.map((m) => (
                <div key={m} className="groups-member-row">
                  <span className="groups-member-name">@{m.startsWith("@") ? m.slice(1) : m}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ManagerGroupsEditorProps {
  manager: ManagerInfo;
  allGroups: GroupInfo[];
  onSave: () => void;
  onClose: () => void;
}

function ManagerGroupsEditor({ manager, allGroups, onSave, onClose }: ManagerGroupsEditorProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<number>>(new Set(manager.groups.map((g) => g.id)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    await apiPut(`/api/managers/${manager.username}/groups`, { group_ids: Array.from(selected) });
    await onSave();
    setSaving(false);
    onClose();
  };

  return (
    <div className="groups-modal-overlay" onClick={onClose}>
      <div className="groups-modal" onClick={(e) => e.stopPropagation()}>
        <div className="groups-modal-header">
          <h3>{t("groups.editManagerGroups")} — @{manager.username}</h3>
          <button className="groups-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="groups-modal-body">
          {allGroups.length === 0 ? (
            <div className="groups-empty-hint">{t("groups.noGroups")}</div>
          ) : (
            allGroups.map((g) => (
              <label key={g.id} className="groups-checkbox-row">
                <input
                  type="checkbox"
                  checked={selected.has(g.id)}
                  onChange={() => toggle(g.id)}
                />
                <span>{g.name}</span>
                <span className="groups-member-count">({g.member_count} {t("groups.memberCount")})</span>
              </label>
            ))
          )}
          <div className="groups-modal-actions">
            <button className="btn btn-small btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "…" : t("groups.save")}
            </button>
            <button className="btn btn-small" onClick={onClose}>{t("groups.cancel")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type SubTab = "groups" | "managers" | "users";

export function UserGroupsPage() {
  const { t } = useI18n();
  const { currentUser, refresh: refreshUser } = useCurrentUser();
  const [subTab, setSubTab] = useState<SubTab>("groups");

  // Groups state
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [membersGroupId, setMembersGroupId] = useState<number | null>(null);

  // Managers state
  const [managers, setManagers] = useState<ManagerInfo[]>([]);
  const [editingManager, setEditingManager] = useState<ManagerInfo | null>(null);
  const [showNewManager, setShowNewManager] = useState(false);
  const [newMgrUsername, setNewMgrUsername] = useState("");
  const [newMgrPassword, setNewMgrPassword] = useState("");
  const [newMgrGroups, setNewMgrGroups] = useState<Set<number>>(new Set());
  const [mgrSaving, setMgrSaving] = useState(false);
  const [resetPasswordFor, setResetPasswordFor] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordSaving, setResetPasswordSaving] = useState(false);

  // Users (all app users) state
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"super_admin" | "manager">("manager");
  const [newUserGroups, setNewUserGroups] = useState<Set<number>>(new Set());
  const [userSaving, setUserSaving] = useState(false);
  const [userResetFor, setUserResetFor] = useState<string | null>(null);
  const [userResetPassword, setUserResetPassword] = useState("");
  const [userResetSaving, setUserResetSaving] = useState(false);

  // Import state (removed — groups are now synced from GitHub Enterprise teams only)

  // Sync-from-GitHub-Teams state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any | null>(null);

  const loadGroups = useCallback(async () => {
    const data = await apiGet("/api/groups");
    setGroups(data.groups || []);
  }, []);

  const loadManagers = useCallback(async () => {
    const data = await apiGet("/api/managers");
    setManagers(data.managers || []);
  }, []);

  const loadAllUsers = useCallback(async () => {
    const data = await apiGet("/api/users");
    setAllUsers(data.users || []);
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { if (subTab === "managers") loadManagers(); }, [subTab, loadManagers]);
  useEffect(() => { if (subTab === "users") loadAllUsers(); }, [subTab, loadAllUsers]);

  // Escape key closes Reset Password modal
  useEffect(() => {
    if (!resetPasswordFor && !userResetFor) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setResetPasswordFor(null); setResetPasswordValue("");
        setUserResetFor(null); setUserResetPassword("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [resetPasswordFor, userResetFor]);

  // ── Groups CRUD ──────────────────────────────────────────────────────────

  const handleSyncTeams = async () => {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/groups/sync-teams", { method: "POST" });
    const result = await res.json();
    setSyncResult(result);
    setSyncing(false);
    if (result.ok) {
      await loadGroups();
      await refreshUser();
    }
  };

  // ── Managers CRUD ────────────────────────────────────────────────────────

  const handleCreateManager = async () => {
    if (!newMgrUsername.trim() || !newMgrPassword.trim()) return;
    setMgrSaving(true);
    await apiPost("/api/managers", {
      username: newMgrUsername.trim(),
      password: newMgrPassword.trim(),
      group_ids: Array.from(newMgrGroups),
    });
    setNewMgrUsername(""); setNewMgrPassword(""); setNewMgrGroups(new Set()); setShowNewManager(false);
    await loadManagers();
    setMgrSaving(false);
  };

  const handleDeleteManager = async (username: string) => {
    if (!confirm(t("groups.deleteManagerConfirm"))) return;
    await apiDelete(`/api/managers/${username}`);
    await loadManagers();
  };

  const handleResetPassword = async () => {
    if (!resetPasswordFor || !resetPasswordValue.trim()) return;
    setResetPasswordSaving(true);
    await apiPut(`/api/managers/${resetPasswordFor}/password`, { password: resetPasswordValue.trim() });
    setResetPasswordFor(null);
    setResetPasswordValue("");
    setResetPasswordSaving(false);
  };

  // ── All Users CRUD ──────────────────────────────────────────────────────

  const handleCreateUser = async () => {
    if (!newUserUsername.trim() || !newUserPassword.trim()) return;
    setUserSaving(true);
    const res = await apiPost("/api/users", {
      username: newUserUsername.trim(),
      password: newUserPassword.trim(),
      role: newUserRole,
      group_ids: newUserRole === "manager" ? Array.from(newUserGroups) : [],
    });
    if (!res.error) {
      setNewUserUsername(""); setNewUserPassword(""); setNewUserRole("manager");
      setNewUserGroups(new Set()); setShowNewUser(false);
      await loadAllUsers();
    }
    setUserSaving(false);
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`Delete user @${username}?`)) return;
    await apiDelete(`/api/users/${username}`);
    await loadAllUsers();
  };

  const handleResetUserPassword = async () => {
    if (!userResetFor || !userResetPassword.trim()) return;
    setUserResetSaving(true);
    await apiPut(`/api/users/${userResetFor}/password`, { password: userResetPassword.trim() });
    setUserResetFor(null); setUserResetPassword("");
    setUserResetSaving(false);
  };

  // ── CSV Import ─────────────────────────────────────────────────────────── (removed)

  if (currentUser?.role !== "super_admin") {
    return <div className="dashboard-empty">Access restricted to super admins.</div>;
  }

  return (
    <div className="dashboard user-groups-page">
      {/* Sub-tabs */}
      <div className="dashboard-tab-bar" style={{ marginBottom: 16 }}>
        <div className="view-toggle">
          {(["groups", "managers", "users"] as SubTab[]).map((tab) => (
            <button
              key={tab}
              className={`btn btn-small btn-toggle ${subTab === tab ? "btn-toggle-active" : ""}`}
              onClick={() => setSubTab(tab)}
            >
              {tab === "users" ? `👤 ${t("groups.allUsers")}` : t(`groups.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}` as any)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Groups tab ── */}
      {subTab === "groups" && (
        <div className="groups-section">
          <div className="groups-toolbar">
            <button
              className="btn btn-small btn-secondary"
              onClick={handleSyncTeams}
              disabled={syncing}
              title={t("groups.syncTeamsHint")}
            >
              {syncing ? "⏳ " + t("groups.syncingTeams") : "🔄 " + t("groups.syncTeams")}
            </button>
          </div>

          {syncResult && (
            <div className={`groups-sync-result ${syncResult.ok ? "groups-sync-ok" : "groups-sync-err"}`}>
              {syncResult.error ? (
                <span>❌ {syncResult.error}</span>
              ) : (
                <>
                  <span>✅ {t("groups.syncDone")}: </span>
                  <strong>{syncResult.groups_created}</strong> {t("groups.syncCreated")}, <strong>{syncResult.groups_updated}</strong> {t("groups.syncUpdated")}, <strong>{syncResult.members_synced}</strong> {t("groups.syncMembers")}
                  {syncResult.errors?.length > 0 && (
                    <div className="groups-sync-warnings">
                      {syncResult.errors.map((e: string, i: number) => <div key={i}>⚠️ {e}</div>)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {groups.length === 0 ? (
            <div className="groups-empty">{t("groups.noGroups")}</div>
          ) : (
            <div className="groups-list">
              {groups.map((g) => (
                <div key={g.id} className="groups-card">
                  <div className="groups-card-info">
                    <span className="groups-card-name">{g.name}</span>
                    <span className="groups-card-count">{g.member_count} {t("groups.memberCount")}</span>
                    {g.description && <span className="groups-card-desc">{g.description}</span>}
                  </div>
                  <div className="groups-card-actions">
                    <button className="btn btn-tiny" onClick={() => setMembersGroupId(g.id)}>
                      👥 {t("groups.members")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {membersGroupId !== null && (
            <MemberList groupId={membersGroupId} onClose={() => { setMembersGroupId(null); loadGroups(); }} />
          )}
        </div>
      )}

      {/* ── Managers tab ── */}
      {subTab === "managers" && (
        <div className="groups-section">
          <div className="groups-toolbar">
            <button className="btn btn-small btn-primary" onClick={() => setShowNewManager(true)}>
              + {t("groups.createManager")}
            </button>
          </div>

          {showNewManager && (
            <div className="groups-form-card">
              <input
                className="groups-input"
                placeholder={t("groups.managerUsername")}
                value={newMgrUsername}
                onChange={(e) => setNewMgrUsername(e.target.value)}
              />
              <input
                type="password"
                className="groups-input"
                placeholder={t("groups.managerPassword")}
                value={newMgrPassword}
                onChange={(e) => setNewMgrPassword(e.target.value)}
              />
              <div className="groups-assign-groups">
                <div className="groups-assign-label">{t("groups.assignGroups")}</div>
                {groups.map((g) => (
                  <label key={g.id} className="groups-checkbox-row">
                    <input
                      type="checkbox"
                      checked={newMgrGroups.has(g.id)}
                      onChange={() => {
                        setNewMgrGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                          return next;
                        });
                      }}
                    />
                    <span>{g.name}</span>
                    <span className="groups-member-count">({g.member_count})</span>
                  </label>
                ))}
              </div>
              <div className="groups-form-actions">
                <button className="btn btn-small btn-primary" onClick={handleCreateManager} disabled={mgrSaving}>
                  {mgrSaving ? "…" : t("groups.save")}
                </button>
                <button className="btn btn-small" onClick={() => setShowNewManager(false)}>{t("groups.cancel")}</button>
              </div>
            </div>
          )}

          {managers.length === 0 ? (
            <div className="groups-empty">{t("groups.noManagers")}</div>
          ) : (
            <div className="groups-list">
              {managers.map((m) => (
                <div key={m.username} className="groups-card">
                  <div className="groups-card-info">
                    <span className="groups-card-name">@{m.username}</span>
                    <div className="groups-card-tags">
                      {m.groups.length === 0 ? (
                        <span className="groups-tag-empty">No groups</span>
                      ) : (
                        m.groups.map((g) => (
                          <span key={g.id} className="groups-tag">{g.name}</span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="groups-card-actions">
                    <button className="btn btn-tiny" onClick={() => setEditingManager(m)}>
                      ✏️ {t("groups.editManagerGroups")}
                    </button>
                    <button className="btn btn-tiny" onClick={() => { setResetPasswordFor(m.username); setResetPasswordValue(""); }}>
                      🔑 {t("groups.resetPassword")}
                    </button>
                    <button className="btn btn-tiny btn-danger" onClick={() => handleDeleteManager(m.username)}>
                      {t("groups.deleteManager")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {editingManager && (
            <ManagerGroupsEditor
              manager={editingManager}
              allGroups={groups}
              onSave={loadManagers}
              onClose={() => setEditingManager(null)}
            />
          )}

          {resetPasswordFor && (
            <div className="groups-modal-overlay" onClick={() => setResetPasswordFor(null)}>
              <div className="groups-modal" onClick={(e) => e.stopPropagation()}>
                <div className="groups-modal-header">
                  <h3>{t("groups.resetPassword")} @{resetPasswordFor}</h3>
                  <button className="groups-modal-close" onClick={() => setResetPasswordFor(null)}>✕</button>
                </div>
                <div className="groups-modal-body">
                  <input
                    className="groups-input"
                    type="password"
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder={t("groups.newPassword")}
                    onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
                    autoFocus
                  />
                </div>
                <div className="groups-modal-actions">
                  <button className="btn btn-small btn-primary" onClick={handleResetPassword} disabled={resetPasswordSaving || !resetPasswordValue.trim()}>
                    {resetPasswordSaving ? "…" : t("groups.save")}
                  </button>
                  <button className="btn btn-small" onClick={() => setResetPasswordFor(null)}>{t("groups.cancel")}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── All Users tab ── */}
      {subTab === "users" && (
        <div className="groups-section">
          <div className="groups-toolbar">
            <button className="btn btn-small btn-primary" onClick={() => setShowNewUser(true)}>
              + New User
            </button>
          </div>

          {showNewUser && (
            <div className="groups-form-card">
              <input
                className="groups-input"
                placeholder="Username"
                value={newUserUsername}
                onChange={(e) => setNewUserUsername(e.target.value)}
                autoFocus
              />
              <input
                type="password"
                className="groups-input"
                placeholder="Password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Role:</span>
                <select
                  className="lifecycle-select"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as "super_admin" | "manager")}
                >
                  <option value="manager">Manager</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              {newUserRole === "manager" && groups.length > 0 && (
                <div className="groups-assign-groups">
                  <div className="groups-assign-label">Assign Groups</div>
                  {groups.map((g) => (
                    <label key={g.id} className="groups-checkbox-row">
                      <input
                        type="checkbox"
                        checked={newUserGroups.has(g.id)}
                        onChange={() => {
                          setNewUserGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                            return next;
                          });
                        }}
                      />
                      <span>{g.name}</span>
                      <span className="groups-member-count">({g.member_count})</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="groups-form-actions">
                <button className="btn btn-small btn-primary" onClick={handleCreateUser} disabled={userSaving || !newUserUsername.trim() || !newUserPassword.trim()}>
                  {userSaving ? "…" : "Create"}
                </button>
                <button className="btn btn-small" onClick={() => { setShowNewUser(false); setNewUserUsername(""); setNewUserPassword(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {allUsers.length === 0 ? (
            <div className="groups-empty">No users found</div>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Groups</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((u, i) => (
                    <tr key={u.username}>
                      <td className="rank">{i + 1}</td>
                      <td className="user-name">
                        @{u.username}
                        {u.username === currentUser?.username && (
                          <span className="dash-badge dash-badge-muted" style={{ marginLeft: 6 }}>you</span>
                        )}
                      </td>
                      <td>
                        <span className={`dash-status-badge ${u.role === "super_admin" ? "success" : ""}`}>
                          {u.role === "super_admin" ? "🔑 Super Admin" : "👔 Manager"}
                        </span>
                      </td>
                      <td>
                        {u.groups?.length > 0
                          ? u.groups.map((g: any) => <span key={g.id} className="groups-tag" style={{ marginRight: 4 }}>{g.name}</span>)
                          : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="btn btn-tiny"
                            onClick={() => { setUserResetFor(u.username); setUserResetPassword(""); }}
                          >
                            🔑 Reset PW
                          </button>
                          {u.username !== currentUser?.username && (
                            <button
                              className="btn btn-tiny btn-danger"
                              onClick={() => handleDeleteUser(u.username)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Reset Password Modal */}
          {userResetFor && (
            <div className="groups-modal-overlay" onClick={() => setUserResetFor(null)}>
              <div className="groups-modal" onClick={(e) => e.stopPropagation()}>
                <div className="groups-modal-header">
                  <h3>Reset Password — @{userResetFor}</h3>
                  <button className="groups-modal-close" onClick={() => setUserResetFor(null)}>✕</button>
                </div>
                <div className="groups-modal-body">
                  <input
                    className="groups-input"
                    type="password"
                    value={userResetPassword}
                    onChange={(e) => setUserResetPassword(e.target.value)}
                    placeholder="New password"
                    onKeyDown={(e) => e.key === "Enter" && handleResetUserPassword()}
                    autoFocus
                  />
                </div>
                <div className="groups-modal-actions">
                  <button
                    className="btn btn-small btn-primary"
                    onClick={handleResetUserPassword}
                    disabled={userResetSaving || !userResetPassword.trim()}
                  >
                    {userResetSaving ? "…" : "Save"}
                  </button>
                  <button className="btn btn-small" onClick={() => setUserResetFor(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
