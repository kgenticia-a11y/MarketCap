import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { CandlestickChart, ExternalLink } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Send user back to the page they were trying to reach, or dashboard
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? "/";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try { await login(email, password); navigate(from, { replace: true }); }
    catch { setError("Invalid email or password."); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-sidebar flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center">
            <CandlestickChart size={16} className="text-white" />
          </div>
          <span className="text-white font-semibold text-lg">MarketCap</span>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-8">
          <h2 className="text-lg font-semibold text-white mb-6">Sign in</h2>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-muted mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full bg-sidebar border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full bg-sidebar border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors" />
            </div>
            {error && <p className="text-negative text-xs">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium transition-all shadow-lg shadow-accent/20">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="text-center text-xs text-muted mt-4">
            No account?{" "}
            <Link to="/register" className="text-accent-light hover:text-accent">Register</Link>
          </p>
          <p className="text-center text-xs text-muted/60 mt-3">
            <Link to="/terms" target="_blank" className="hover:text-muted flex items-center justify-center gap-1 transition-colors">
              Terms of Service & Privacy Policy <ExternalLink size={10} />
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
