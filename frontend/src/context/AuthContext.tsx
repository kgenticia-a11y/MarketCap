import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getMe, login as apiLogin, register as apiRegister } from "../api/auth";

export interface User {
  id: number;
  email: string;
  name?: string | null;
  created_at: string;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, acceptedTerms: boolean) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem("token");
    if (!token) { setLoading(false); return; }
    getMe()
      .then(setUser)
      .catch(() => sessionStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { access_token } = await apiLogin(email, password);
    sessionStorage.setItem("token", access_token);
    try {
      const me = await getMe();
      setUser(me);
    } catch (err) {
      // Only discard the token if the server explicitly rejected it (401).
      // A transient network error should not silently log the user out.
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        sessionStorage.removeItem("token");
      }
      throw new Error("Failed to load user profile");
    }
  };

  const register = async (email: string, password: string, acceptedTerms: boolean) => {
    const { access_token } = await apiRegister(email, password, acceptedTerms);
    sessionStorage.setItem("token", access_token);
    try {
      const me = await getMe();
      setUser(me);
    } catch (err) {
      // Same as login: only remove token on explicit 401, not network errors.
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        sessionStorage.removeItem("token");
      }
      throw new Error("Failed to load user profile");
    }
  };

  const logout = () => {
    sessionStorage.removeItem("token");
    setUser(null);
  };

  const refreshUser = async () => {
    const me = await getMe();
    setUser(me);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
