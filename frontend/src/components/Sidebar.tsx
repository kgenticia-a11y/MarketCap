import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart2,
  TrendingUp,
  CandlestickChart,
  PieChart,
  Briefcase,
  Settings,
  History,
  Newspaper,
  MessageSquare,
  LogOut,
  LogIn,
  ScanSearch,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { clsx } from "clsx";

const menu = [
  { label: "Dashboard",        icon: LayoutDashboard,    to: "/" },
  { label: "Market Update",    icon: TrendingUp,          to: "/market" },
  { label: "Stock Screener",   icon: ScanSearch,          to: "/screener" },
  { label: "Income Estimator", icon: BarChart2,           to: "/income" },
  { label: "Interactive Chart",icon: CandlestickChart,    to: "/chart" },
  { label: "Mutual Funds",     icon: PieChart,            to: "/funds" },
];

const account = [
  { label: "Portfolio", icon: Briefcase, to: "/portfolio" },
  { label: "Settings",  icon: Settings,  to: "/settings",  dot: true },
  { label: "History",   icon: History,   to: "/history" },
];

const more = [
  { label: "News",     icon: Newspaper,     to: "/news",     badge: "NEW" },
  { label: "Feedback", icon: MessageSquare, to: "/feedback" },
];

function NavItem({
  to,
  icon: Icon,
  label,
  dot,
  badge,
  onClick,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  dot?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group relative",
          isActive
            ? "bg-accent/10 text-white font-medium border-l-2 border-accent pl-[10px]"
            : "text-muted hover:text-white hover:bg-surface-hover"
        )
      }
    >
      <Icon size={16} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
      {badge && (
        <span className="text-[10px] font-bold bg-positive text-black px-1.5 py-0.5 rounded-full leading-none">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const sidebarContent = (
    <aside className="w-56 shrink-0 bg-sidebar flex flex-col h-full border-r border-border">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <CandlestickChart size={14} className="text-white" />
          </div>
          <span className="font-semibold text-white text-sm tracking-wide">MarketCap</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden text-muted hover:text-white transition-colors">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div>
          <p className="text-[10px] font-semibold text-muted uppercase tracking-widest px-3 mb-2">Menu</p>
          <div className="space-y-0.5">
            {menu.map((item) => <NavItem key={item.to} {...item} onClick={onClose} />)}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-muted uppercase tracking-widest px-3 mb-2">Account</p>
          <div className="space-y-0.5">
            {account.map((item) => <NavItem key={item.to} {...item} onClick={onClose} />)}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-muted uppercase tracking-widest px-3 mb-2">More</p>
          <div className="space-y-0.5">
            {more.map((item) => <NavItem key={item.to} {...item} onClick={onClose} />)}
          </div>
        </div>
      </nav>

      {/* Theme toggle */}
      <div className="px-3 pb-1">
        <button
          onClick={toggle}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-white hover:bg-surface-hover transition-all"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>

      {/* Auth */}
      <div className="px-3 py-4 border-t border-border">
        {user ? (
          <div className="space-y-1">
            <div className="px-3 py-2 text-xs text-muted truncate">{user.email}</div>
            <button
              onClick={() => { logout(); navigate("/"); onClose?.(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted hover:text-white hover:bg-surface-hover transition-all"
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        ) : (
          <NavLink
            to="/login"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted hover:text-white hover:bg-surface-hover transition-all"
          >
            <LogIn size={16} />
            Sign in
          </NavLink>
        )}
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <div className="hidden md:flex h-screen sticky top-0">
        {sidebarContent}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={onClose}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden flex h-screen">
            {sidebarContent}
          </div>
        </>
      )}
    </>
  );
}
