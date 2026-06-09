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
    const token = localStorage.getItem("token");
    if (!token) { setLoading(false); return; }
    getMe()
      .then(setUser)
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { access_token } = await apiLogin(email, password);
    localStorage.setItem("token", access_token);
    try {
      const me = await getMe();
      setUser(me);
    } catch {
      localStorage.removeItem("token");
      throw new Error("Failed to load user profile");
    }
  };

  const register = async (email: string, password: string, acceptedTerms: boolean) => {
    const { access_token } = await apiRegister(email, password, acceptedTerms);
    localStorage.setItem("token", access_token);
    try {
      const me = await getMe();
      setUser(me);
    } catch {
      localStorage.removeItem("token");
      throw new Error("Failed to load user profile");
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
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
