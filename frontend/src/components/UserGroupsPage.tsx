import { useState, useEffect, useCallback, useRef } from "react";
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
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // Autocomplete state
  const [query, setQuery] = useState("");
  const [allUsers, setAllUsers] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadMembers = useCallback(async () => {
    const data = await apiGet(`/api/groups/${groupId}/members`);
    setMembers(data.members || []);
  }, [groupId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => {
    apiGet("/api/groups/available-users").then((d) => setAllUsers(d.users || []));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Filter suggestions based on query, excluding already-added members
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setSuggestions([]); setShowDropdown(false); return; }
    const filtered = allUsers.filter(
      (u) => u.toLowerCase().includes(q) && !members.includes(u)
    ).slice(0, 10);
    setSuggestions(filtered);
    setShowDropdown(filtered.length > 0);
    setHighlightIdx(0);
  }, [query, allUsers, members]);

  const handleAdd = async (username?: string) => {
    // Strip leading @ if present to avoid storing "@username" when display adds @ prefix
    const raw = (username ?? query).trim().toLowerCase();
    const name = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!name) return;
    setSaving(true);
    await apiPost(`/api/groups/${groupId}/members`, { usernames: [name] });
    setQuery("");
    setSuggestions([]);
    setShowDropdown(false);
    await loadMembers();
    setSaving(false);
    inputRef.current?.focus();
  };

  const handleRemove = async (username: string) => {
    await apiDelete(`/api/groups/${groupId}/members/${username}`);
    setConfirmRemove(null);
    await loadMembers();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) {
      if (e.key === "Enter") handleAdd();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); handleAdd(suggestions[highlightIdx]); }
    else if (e.key === "Escape") { setShowDropdown(false); }
  };

  return (
    <div className="groups-modal-overlay" onClick={onClose}>
      <div className="groups-modal" onClick={(e) => e.stopPropagation()}>
        <div className="groups-modal-header">
          <h3>{t("groups.members")}</h3>
          <button className="groups-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="groups-modal-body">
          <div className="groups-add-member" style={{ position: "relative" }}>
            <input
              ref={inputRef}
              className="groups-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("groups.addMember")}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onFocus={() => query && suggestions.length > 0 && setShowDropdown(true)}
              autoComplete="off"
            />
            <button className="btn btn-small btn-primary" onClick={() => handleAdd()} disabled={saving || !query.trim()}>
              {saving ? "…" : "+"}
            </button>
            {showDropdown && (
              <div ref={dropdownRef} className="member-autocomplete-dropdown">
                {suggestions.map((u, i) => (
                  <div
                    key={u}
                    className={`member-autocomplete-item${i === highlightIdx ? " highlighted" : ""}`}
                    onMouseDown={() => handleAdd(u)}
                    onMouseEnter={() => setHighlightIdx(i)}
                  >
                    <span className="member-autocomplete-avatar">
                      <img
                        src={`https://github.com/${u}.png?size=24`}
                        alt=""
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </span>
                    <span className="member-autocomplete-login">@{u}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="groups-member-list">
            {members.length === 0 ? (
              <div className="groups-empty-hint">No members</div>
            ) : (
              members.map((m) => (
                <div key={m} className="groups-member-row">
                  <span className="groups-member-name">@{m.startsWith("@") ? m.slice(1) : m}</span>
                  {confirmRemove === m ? (
                    <span className="groups-remove-confirm">
                      <span className="groups-remove-confirm-label">{t("groups.confirmRemove")}</span>
                      <button className="btn btn-tiny btn-danger" onClick={() => handleRemove(m)}>{t("groups.yes")}</button>
                      <button className="btn btn-tiny" onClick={() => setConfirmRemove(null)}>{t("groups.no")}</button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-tiny btn-danger"
                      onClick={() => setConfirmRemove(m)}
                      title={t("groups.removeMember")}
                    >
                      ✕
                    </button>
                  )}
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

type SubTab = "groups" | "managers" | "users" | "import";

export function UserGroupsPage() {
  const { t } = useI18n();
  const { currentUser, refresh: refreshUser } = useCurrentUser();
  const [subTab, setSubTab] = useState<SubTab>("groups");

  // Groups state
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [editingGroup, setEditingGroup] = useState<GroupInfo | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [membersGroupId, setMembersGroupId] = useState<number | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);

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

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import validation state
  type ImportRow = { username: string; group: string; valid: boolean; originalUsername: string };
  const [importStep, setImportStep] = useState<"select" | "preview" | "done">("select");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [availableUsers, setAvailableUsers] = useState<string[]>([]);
  // Per-row autocomplete state: rowIdx → {query, suggestions, open, highlightIdx}
  const [rowAC, setRowAC] = useState<Record<number, { query: string; suggestions: string[]; open: boolean; hi: number }>>({});

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

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setGroupSaving(true);
    await apiPost("/api/groups", { name: newGroupName.trim(), description: newGroupDesc.trim() });
    setNewGroupName(""); setNewGroupDesc(""); setShowNewGroup(false);
    await loadGroups(); await refreshUser();
    setGroupSaving(false);
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup) return;
    setGroupSaving(true);
    await apiPut(`/api/groups/${editingGroup.id}`, {
      name: editingGroup.name, description: editingGroup.description,
    });
    setEditingGroup(null);
    await loadGroups(); await refreshUser();
    setGroupSaving(false);
  };

  const handleDeleteGroup = async (id: number) => {
    if (!confirm(t("groups.deleteConfirm"))) return;
    await apiDelete(`/api/groups/${id}`);
    await loadGroups(); await refreshUser();
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

  // ── CSV Import ───────────────────────────────────────────────────────────

  // Parse CSV text → [{username, group}]
  const parseCSV = (text: string): { username: string; group: string }[] => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
    const uIdx = headers.findIndex((h) => ["username", "login", "user"].includes(h));
    const gIdx = headers.findIndex((h) => ["group", "group_name", "team"].includes(h));
    if (uIdx < 0 || gIdx < 0) return [];
    const rows: { username: string; group: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const username = (cols[uIdx] || "").toLowerCase();
      const group = cols[gIdx] || "";
      if (username && group) rows.push({ username, group });
    }
    return rows;
  };

  const handleFileChange = async (file: File | null) => {
    setImportFile(file);
    setImportResult(null);
    setImportStep("select");
    setImportRows([]);
    if (!file) return;

    // Read file and parse
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) return;

    // Fetch available users (with cache)
    let avail = availableUsers;
    if (!avail.length) {
      const d = await apiGet("/api/groups/available-users");
      avail = d.users || [];
      setAvailableUsers(avail);
    }
    const availSet = new Set(avail.map((u: string) => u.toLowerCase()));

    const rows = parsed.map((r) => ({
      username: r.username,
      group: r.group,
      valid: availSet.has(r.username.toLowerCase()),
      originalUsername: r.username,
    }));
    setImportRows(rows);
    setRowAC({});
    setImportStep("preview");
  };

  const updateRowUsername = (idx: number, newUsername: string) => {
    setImportRows((prev) => {
      const next = [...prev];
      const availSet = new Set(availableUsers.map((u) => u.toLowerCase()));
      next[idx] = { ...next[idx], username: newUsername, valid: availSet.has(newUsername.toLowerCase()) };
      return next;
    });
  };

  const removeRow = (idx: number) => {
    setImportRows((prev) => prev.filter((_, i) => i !== idx));
    setRowAC((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const updateRowAC = (idx: number, patch: Partial<{ query: string; suggestions: string[]; open: boolean; hi: number }>) => {
    setRowAC((prev) => {
      const defaults = { query: "", suggestions: [] as string[], open: false, hi: 0 };
      const current = prev[idx] ?? defaults;
      return { ...prev, [idx]: { ...current, ...patch } };
    });
  };

  const handleACQuery = (idx: number, q: string) => {
    updateRowUsername(idx, q);
    const filtered = availableUsers.filter((u) => u.toLowerCase().includes(q.toLowerCase()) && u.toLowerCase() !== q.toLowerCase()).slice(0, 8);
    updateRowAC(idx, { query: q, suggestions: filtered, open: filtered.length > 0, hi: 0 });
  };

  const handleACSelect = (idx: number, username: string) => {
    updateRowUsername(idx, username);
    updateRowAC(idx, { query: username, suggestions: [], open: false });
  };

  const handleImport = async () => {
    if (!importRows.length) return;
    setImporting(true);
    setImportResult(null);
    const rows = importRows.map((r) => ({ username: r.username, group: r.group }));
    const res = await fetch("/api/groups/import-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    const result = await res.json();
    setImportResult(result);
    setImporting(false);
    if (result.ok) {
      setImportStep("done");
      await loadGroups();
      await refreshUser();
    }
  };

  if (currentUser?.role !== "super_admin") {
    return <div className="dashboard-empty">Access restricted to super admins.</div>;
  }

  return (
    <div className="dashboard user-groups-page">
      {/* Sub-tabs */}
      <div className="dashboard-tab-bar" style={{ marginBottom: 16 }}>
        <div className="view-toggle">
          {(["groups", "managers", "users", "import"] as SubTab[]).map((tab) => (
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
            <button className="btn btn-small btn-primary" onClick={() => setShowNewGroup(true)}>
              + {t("groups.createGroup")}
            </button>
          </div>

          {showNewGroup && (
            <div className="groups-form-card">
              <input
                className="groups-input"
                placeholder={t("groups.groupName")}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
              <input
                className="groups-input"
                placeholder={t("groups.description")}
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
              />
              <div className="groups-form-actions">
                <button className="btn btn-small btn-primary" onClick={handleCreateGroup} disabled={groupSaving}>
                  {groupSaving ? "…" : t("groups.save")}
                </button>
                <button className="btn btn-small" onClick={() => setShowNewGroup(false)}>{t("groups.cancel")}</button>
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <div className="groups-empty">{t("groups.noGroups")}</div>
          ) : (
            <div className="groups-list">
              {groups.map((g) => (
                <div key={g.id} className="groups-card">
                  {editingGroup?.id === g.id ? (
                    <div className="groups-form-card">
                      <input
                        className="groups-input"
                        value={editingGroup.name}
                        onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                      />
                      <input
                        className="groups-input"
                        value={editingGroup.description}
                        onChange={(e) => setEditingGroup({ ...editingGroup, description: e.target.value })}
                      />
                      <div className="groups-form-actions">
                        <button className="btn btn-small btn-primary" onClick={handleUpdateGroup} disabled={groupSaving}>
                          {groupSaving ? "…" : t("groups.save")}
                        </button>
                        <button className="btn btn-small" onClick={() => setEditingGroup(null)}>{t("groups.cancel")}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="groups-card-info">
                        <span className="groups-card-name">{g.name}</span>
                        <span className="groups-card-count">{g.member_count} {t("groups.memberCount")}</span>
                        {g.description && <span className="groups-card-desc">{g.description}</span>}
                      </div>
                      <div className="groups-card-actions">
                        <button className="btn btn-tiny" onClick={() => setMembersGroupId(g.id)}>
                          👥 {t("groups.members")}
                        </button>
                        <button className="btn btn-tiny" onClick={() => setEditingGroup(g)}>
                          ✏️
                        </button>
                        <button className="btn btn-tiny btn-danger" onClick={() => handleDeleteGroup(g.id)}>
                          {t("groups.delete")}
                        </button>
                      </div>
                    </>
                  )}
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

      {/* ── Import CSV tab ── */}      {subTab === "import" && (
        <div className="groups-section">
          <div className="groups-import-card">
            <h3>{t("groups.importTitle")}</h3>
            <p className="groups-import-hint">{t("groups.importHint")}</p>
            <div className="groups-import-format">
              <code>username,group</code><br />
              <code>alice,Team-A</code><br />
              <code>bob,Team-A</code>
            </div>

            {/* Step 1: Choose file */}
            <div className="groups-import-controls">
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              />
              <button className="btn btn-small" onClick={() => fileInputRef.current?.click()}>
                {importFile ? importFile.name : "Choose CSV file"}
              </button>
              {importStep !== "select" && (
                <button className="btn btn-small" onClick={() => { setImportFile(null); setImportStep("select"); setImportRows([]); setImportResult(null); fileInputRef.current && (fileInputRef.current.value = ""); }}>
                  ✕ Clear
                </button>
              )}
            </div>

            {/* Step 2: Validate & edit */}
            {importStep === "preview" && importRows.length > 0 && (
              <div className="import-preview-section">
                <div className="import-preview-summary">
                  <span className="import-count-valid">✅ {importRows.filter((r) => r.valid).length} valid</span>
                  {importRows.filter((r) => !r.valid).length > 0 && (
                    <span className="import-count-invalid">⚠️ {importRows.filter((r) => !r.valid).length} not found in Copilot seat data</span>
                  )}
                  <span className="import-count-total">{importRows.length} rows total</span>
                </div>

                <div className="import-preview-table-wrap">
                  <table className="import-preview-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Username</th>
                        <th>Group</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.map((row, idx) => {
                        const ac = rowAC[idx] || { query: "", suggestions: [], open: false, hi: 0 };
                        return (
                          <tr key={idx} className={row.valid ? "import-row-valid" : "import-row-invalid"}>
                            <td className="import-row-num">{idx + 1}</td>
                            <td className="import-row-user">
                              {row.valid ? (
                                <span className="import-username-valid">
                                  <img src={`https://github.com/${row.username}.png?size=20`} alt="" className="import-user-avatar" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  @{row.username}
                                </span>
                              ) : (
                                <div className="import-ac-wrap" style={{ position: "relative" }}>
                                  <input
                                    className="groups-input import-ac-input"
                                    value={ac.query !== "" ? ac.query : row.username}
                                    onChange={(e) => handleACQuery(idx, e.target.value)}
                                    onBlur={() => setTimeout(() => updateRowAC(idx, { open: false }), 150)}
                                    onFocus={() => { if (ac.suggestions.length > 0) updateRowAC(idx, { open: true }); }}
                                    onKeyDown={(e) => {
                                      if (!ac.open) return;
                                      if (e.key === "ArrowDown") { e.preventDefault(); updateRowAC(idx, { hi: Math.min(ac.hi + 1, ac.suggestions.length - 1) }); }
                                      else if (e.key === "ArrowUp") { e.preventDefault(); updateRowAC(idx, { hi: Math.max(ac.hi - 1, 0) }); }
                                      else if (e.key === "Enter") { e.preventDefault(); handleACSelect(idx, ac.suggestions[ac.hi]); }
                                      else if (e.key === "Escape") { updateRowAC(idx, { open: false }); }
                                    }}
                                    placeholder="Fix username…"
                                    autoComplete="off"
                                  />
                                  {ac.open && ac.suggestions.length > 0 && (
                                    <div className="member-autocomplete-dropdown" style={{ right: 0 }}>
                                      {ac.suggestions.map((u, i) => (
                                        <div
                                          key={u}
                                          className={`member-autocomplete-item${i === ac.hi ? " highlighted" : ""}`}
                                          onMouseDown={() => handleACSelect(idx, u)}
                                          onMouseEnter={() => updateRowAC(idx, { hi: i })}
                                        >
                                          <span className="member-autocomplete-avatar">
                                            <img src={`https://github.com/${u}.png?size=24`} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                          </span>
                                          <span className="member-autocomplete-login">@{u}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="import-row-group">{row.group}</td>
                            <td className="import-row-status">
                              {row.valid
                                ? <span className="import-badge-valid">✅ valid</span>
                                : <span className="import-badge-invalid">⚠️ not found</span>
                              }
                            </td>
                            <td>
                              <button className="btn btn-tiny btn-danger" onClick={() => removeRow(idx)} title="Remove row">✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="import-preview-actions">
                  {importRows.some((r) => !r.valid) && (
                    <span className="import-warn-text">⚠️ Invalid users will still be imported — fix or remove them first.</span>
                  )}
                  <button
                    className="btn btn-primary"
                    onClick={handleImport}
                    disabled={importing || importRows.length === 0}
                  >
                    {importing ? "Importing…" : `✅ Confirm Import (${importRows.length} rows)`}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Done */}
            {importStep === "done" && importResult?.ok && (
              <div className="groups-import-result groups-import-ok">
                <div>✅ {t("groups.importSuccess")}</div>
                <div>{importResult.groups_created} {t("groups.groupsCreated")}, {importResult.members_added} {t("groups.membersAdded")}</div>
                {importResult.preview?.length > 0 && (
                  <table className="groups-import-preview">
                    <thead><tr><th>Group</th><th>Members</th></tr></thead>
                    <tbody>{importResult.preview.map((p: any) => <tr key={p.group}><td>{p.group}</td><td>{p.count}</td></tr>)}</tbody>
                  </table>
                )}
                <button className="btn btn-small" onClick={() => { setImportStep("select"); setImportFile(null); setImportRows([]); setImportResult(null); }}>Import another</button>
              </div>
            )}

            {importResult && !importResult.ok && (
              <div className="groups-import-result groups-import-error">❌ {importResult.error}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
