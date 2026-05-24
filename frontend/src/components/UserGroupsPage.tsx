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
  const [newNames, setNewNames] = useState("");
  const [saving, setSaving] = useState(false);

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

  const handleAdd = async () => {
    const names = newNames.split(",").map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    setSaving(true);
    await apiPost(`/api/groups/${groupId}/members`, { usernames: names });
    setNewNames("");
    await loadMembers();
    setSaving(false);
  };

  const handleRemove = async (username: string) => {
    await apiDelete(`/api/groups/${groupId}/members/${username}`);
    await loadMembers();
  };

  return (
    <div className="groups-modal-overlay" onClick={onClose}>
      <div className="groups-modal" onClick={(e) => e.stopPropagation()}>
        <div className="groups-modal-header">
          <h3>{t("groups.members")}</h3>
          <button className="groups-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="groups-modal-body">
          <div className="groups-add-member">
            <input
              className="groups-input"
              value={newNames}
              onChange={(e) => setNewNames(e.target.value)}
              placeholder={t("groups.addMember")}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button className="btn btn-small btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? "…" : "+"}
            </button>
          </div>
          <div className="groups-member-list">
            {members.length === 0 ? (
              <div className="groups-empty-hint">No members</div>
            ) : (
              members.map((m) => (
                <div key={m} className="groups-member-row">
                  <span className="groups-member-name">@{m}</span>
                  <button
                    className="btn btn-tiny btn-danger"
                    onClick={() => handleRemove(m)}
                    title={t("groups.removeMember")}
                  >
                    ✕
                  </button>
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

type SubTab = "groups" | "managers" | "import";

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

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadGroups = useCallback(async () => {
    const data = await apiGet("/api/groups");
    setGroups(data.groups || []);
  }, []);

  const loadManagers = useCallback(async () => {
    const data = await apiGet("/api/managers");
    setManagers(data.managers || []);
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { if (subTab === "managers") loadManagers(); }, [subTab, loadManagers]);

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

  // ── CSV Import ───────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", importFile);
    const res = await fetch("/api/groups/import-csv", { method: "POST", body: formData });
    const result = await res.json();
    setImportResult(result);
    setImporting(false);
    if (result.ok) {
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
          {(["groups", "managers", "import"] as SubTab[]).map((tab) => (
            <button
              key={tab}
              className={`btn btn-small btn-toggle ${subTab === tab ? "btn-toggle-active" : ""}`}
              onClick={() => setSubTab(tab)}
            >
              {t(`groups.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}` as any)}
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
        </div>
      )}

      {/* ── Import CSV tab ── */}
      {subTab === "import" && (
        <div className="groups-section">
          <div className="groups-import-card">
            <h3>{t("groups.importTitle")}</h3>
            <p className="groups-import-hint">{t("groups.importHint")}</p>
            <div className="groups-import-format">
              <code>username,group</code><br />
              <code>alice,Team-A</code><br />
              <code>bob,Team-A</code><br />
              <code>charlie,Team-B</code>
            </div>

            <div className="groups-import-controls">
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
              <button
                className="btn btn-small"
                onClick={() => fileInputRef.current?.click()}
              >
                {importFile ? importFile.name : "Choose CSV file"}
              </button>
              <button
                className="btn btn-small btn-primary"
                onClick={handleImport}
                disabled={!importFile || importing}
              >
                {importing ? "Importing…" : t("groups.importBtn")}
              </button>
            </div>

            {importResult && (
              <div className={`groups-import-result ${importResult.ok ? "groups-import-ok" : "groups-import-error"}`}>
                {importResult.ok ? (
                  <>
                    <div>✅ {t("groups.importSuccess")}</div>
                    <div>
                      {importResult.groups_created} {t("groups.groupsCreated")},&nbsp;
                      {importResult.members_added} {t("groups.membersAdded")}
                    </div>
                    {importResult.preview && importResult.preview.length > 0 && (
                      <table className="groups-import-preview">
                        <thead><tr><th>Group</th><th>Members</th></tr></thead>
                        <tbody>
                          {importResult.preview.map((p: any) => (
                            <tr key={p.group}><td>{p.group}</td><td>{p.count}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {importResult.row_errors?.length > 0 && (
                      <div className="groups-import-warnings">
                        {importResult.row_errors.map((e: string, i: number) => (
                          <div key={i}>⚠️ {e}</div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div>❌ {importResult.error}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
