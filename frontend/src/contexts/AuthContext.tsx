import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export interface GroupInfo {
  id: number;
  name: string;
  description: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface CurrentUser {
  username: string;
  role: "super_admin" | "manager";
  groups: GroupInfo[];
}

interface AuthContextValue {
  currentUser: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  currentUser: null,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          setCurrentUser(data as CurrentUser);
          return;
        }
      }
    } catch {
      // ignore
    }
    setCurrentUser(null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ currentUser, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useCurrentUser() {
  return useContext(AuthContext);
}
