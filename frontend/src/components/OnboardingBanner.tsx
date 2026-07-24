import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Star, NotebookPen, ScanSearch } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const STORAGE_KEY = "mc_onboarding_dismissed";
const NEW_USER_DAYS = 7;

function isNewUser(createdAt: string): boolean {
  try {
    const created = new Date(createdAt).getTime();
    const now = Date.now();
    return now - created < NEW_USER_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export default function OnboardingBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(STORAGE_KEY) === "1"
  );

  if (!user || dismissed || !isNewUser(user.created_at)) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  };

  const actions = [
    {
      icon: Star,
      title: "Add to watchlist",
      description: "Track your favourite tickers on the dashboard.",
      onClick: () => navigate("/?tab=watchlist"),
    },
    {
      icon: NotebookPen,
      title: "Write your first memo",
      description: "Document an investment thesis and let AI grade it.",
      onClick: () => navigate("/memos/new"),
    },
    {
      icon: ScanSearch,
      title: "Browse the screener",
      description: "Filter 2,000+ stocks by growth, value, and dividend metrics.",
      onClick: () => navigate("/screener"),
    },
  ];

  return (
    <div className="mx-4 sm:mx-6 mt-4 bg-accent/10 border border-accent/30 rounded-xl p-4 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-muted hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      <p className="text-sm font-semibold text-white mb-3">Welcome to MarketCap — get started in 3 steps</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {actions.map(({ icon: Icon, title, description, onClick }) => (
          <button
            key={title}
            onClick={onClick}
            className="flex items-start gap-3 text-left bg-surface rounded-xl border border-border p-3 hover:border-accent/50 hover:bg-surface-hover transition-all group"
          >
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0 group-hover:bg-accent/30 transition-colors">
              <Icon size={14} className="text-accent" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">{title}</p>
              <p className="text-[11px] text-muted mt-0.5 leading-snug">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
