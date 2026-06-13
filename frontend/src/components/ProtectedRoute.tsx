import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { CandlestickChart } from "lucide-react";
import { useAuth } from "../context/AuthContext";

/**
 * Wraps any route that requires authentication.
 * - While auth state is resolving (loading=true) → shows a centered spinner
 *   so there's no flash of the login page for already-logged-in users.
 * - Unauthenticated → redirects to /login, preserving the attempted path in
 *   `state.from` so Login can send the user back after a successful sign-in.
 * - Authenticated → renders children normally.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center animate-pulse">
            <CandlestickChart size={20} className="text-white" />
          </div>
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/**
 * Wraps public-only routes (login, register).
 * If the user is already authenticated, bounce them straight to the dashboard
 * (or wherever they were originally trying to go).
 */
export function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? "/";

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    return <Navigate to={from} replace />;
  }

  return <>{children}</>;
}
