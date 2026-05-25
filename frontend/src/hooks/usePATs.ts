import { useState, useEffect, useCallback } from "react";

export interface SyncSettings {
  auto_sync_on_startup: boolean;
  sync_cron: string;
}

export function usePATs() {
  const [settings, setSettings] = useState<SyncSettings>({
    auto_sync_on_startup: true,
    sync_cron: "",
  });

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data);
    } catch {
      // keep defaults
    }
  }, []);

  const updateSettings = useCallback(async (updates: Partial<SyncSettings>) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // PAT management is done via GITHUB_PAT in .env — no runtime CRUD needed.
  // Expose empty pats array for backward compatibility with any remaining callers.
  const pats: never[] = [];

  return { pats, settings, updateSettings };
}

