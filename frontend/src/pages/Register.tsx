import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CandlestickChart } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!/[A-Z]/.test(password)) { setError("Password must contain at least one uppercase letter."); return; }
    if (!/\d/.test(password)) { setError("Password must contain at least one number."); return; }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) { setError("Password must contain at least one special character."); return; }
    if (!acceptedTerms) { setError("You must agree to the Terms of Service."); return; }
    setLoading(true);
    try { await register(email, password, acceptedTerms); navigate("/"); }
    catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const retryAfter = (err as { retryAfterSeconds?: number })?.retryAfterSeconds;
      if (status === 429) {
        setError(`Too many attempts. Please wait ${retryAfter ?? 60} seconds and try again.`);
      } else {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(msg ?? "Registration failed.");
      }
    } finally { setLoading(false); }
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
          <h2 className="text-lg font-semibold text-white mb-6">Create account</h2>
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
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-border accent-accent bg-sidebar shrink-0"
              />
              <span className="text-xs text-muted leading-snug">
                I agree to the{" "}
                <Link to="/terms" target="_blank" className="text-accent-light hover:text-accent underline">
                  Terms of Service & Privacy Policy
                </Link>
                , including that MarketCap does not provide investment advice.
              </span>
            </label>
            {error && <p className="text-negative text-xs">{error}</p>}
            <button type="submit" disabled={loading || !acceptedTerms}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium transition-all shadow-lg shadow-accent/20">
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>
          <p className="text-center text-xs text-muted mt-4">
            Already have an account?{" "}
            <Link to="/login" className="text-accent-light hover:text-accent">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
