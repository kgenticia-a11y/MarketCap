import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart2,
  TrendingUp,
  CandlestickChart,
  Briefcase,
  Settings,
  History,
  MessageSquare,
  LogOut,
  LogIn,
  ScanSearch,
  FileText,
  FlaskConical,
  Moon,
  Sun,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { clsx } from "clsx";

// Primary nav: the six daily-driver flows. Anything used rarely or only
// from a specific drill-down belongs in `tools` or `more` below so it
// doesn't compete with these for attention.
const menu = [
  { label: "Dashboard",      icon: LayoutDashboard, to: "/" },
  { label: "Market Update",  icon: TrendingUp,      to: "/market" },
  { label: "Stock Screener", icon: ScanSearch,      to: "/screener" },
  { label: "Portfolio",      icon: Briefcase,       to: "/portfolio" },
];

// Tools: separate, deeper workflows. Grouping them under their own header
// keeps the primary nav scannable and signals "these are auxiliary".
const tools = [
  { label: "Paper Trading",    icon: FlaskConical,     to: "/paper-trading" },
  { label: "Income Estimator", icon: BarChart2,        to: "/income" },
  { label: "Analyst Report",    icon: FileText,          to: "/analyst-report" },
  { label: "Interactive Chart", icon: CandlestickChart, to: "/chart" },
];

const account = [
  { label: "Settings", icon: Settings, to: "/settings" },
  { label: "History",  icon: History,  to: "/history" },
];

const more = [
  { label: "Feedback", icon: MessageSquare, to: "/feedback" },
];

function NavItem({
  to,
  icon: Icon,
  label,
  dot,
  badge,
  collapsed,
  onClick,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  dot?: boolean;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-lg text-sm transition-all group relative",
          collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
          isActive
            ? "bg-accent/10 text-white font-medium border-l-2 border-accent"
            : "text-muted hover:text-white hover:bg-surface-hover",
          isActive && !collapsed && "pl-[10px]"
        )
      }
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {dot && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
          {badge && (
            <span className="text-[10px] font-bold bg-positive text-black px-1.5 py-0.5 rounded-full leading-none">
              {badge}
            </span>
          )}
        </>
      )}
      {collapsed && dot && (
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
      )}
    </NavLink>
  );
}

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({ mobileOpen, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const sidebarContent = (forceExpanded = false) => {
    const isCollapsed = !forceExpanded && collapsed;
    return (
      <aside
        className={clsx(
          "shrink-0 bg-sidebar flex flex-col h-full border-r border-border transition-all duration-200",
          isCollapsed ? "w-14" : "w-56"
        )}
      >
        {/* Logo */}
        <div className={clsx(
          "py-5 border-b border-border flex items-center",
          isCollapsed ? "justify-center px-2" : "justify-between px-4"
        )}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
              <CandlestickChart size={14} className="text-white" />
            </div>
            {!isCollapsed && (
              <span className="font-semibold text-white text-sm tracking-wide">MarketCap</span>
            )}
          </div>
          {!isCollapsed && onClose && (
            <button onClick={onClose} className="md:hidden text-muted hover:text-white transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className={clsx("flex-1 overflow-y-auto py-4 space-y-6", isCollapsed ? "px-1" : "px-3")}>
          <div>
            {!isCollapsed && (
              <p className="text-[10px] font-semibold text-muted uppercase tracking-widest px-3 mb-2">Menu</p>
            )}
            <div className="space-y-0.5">
              {menu.map((item) => (
                <NavItem key={item.to} {...item} collapsed={isCollapsed} onClick={onClose} />
              ))}
            </div>
          </div>

          <div>
            {!isCollapsed && (
              <p className="text-[10px] font-semibold text-muted uppercase tracking-widest px-3 mb-2">Tools</p>
            )}
            <div className="space-y-0.5">
              {tools.map((item) => (
                <NavItem key={item.to} {...item} collapsed={isCollapsed} onClick={onClose} />
              ))}
            </div>
          </div>

          <div>
            {!isCollapsed && (
              <p className="text-[10px] font-semibold text-muted uppercase tracking-widest px-3 mb-2">Account</p>
            )}
            <div className="space-y-0.5">
              {account.map((item) => (
                <NavItem key={item.to} {...item} collapsed={isCollapsed} onClick={onClose} />
              ))}
            </div>
          </div>

          <div>
            {!isCollapsed && (
              <p className="text-[10px] font-semibold text-muted uppercase tracking-widest px-3 mb-2">More</p>
            )}
            <div className="space-y-0.5">
              {more.map((item) => (
                <NavItem key={item.to} {...item} collapsed={isCollapsed} onClick={onClose} />
              ))}
            </div>
          </div>
        </nav>

        {/* Theme toggle */}
        <div className={clsx("pb-1", isCollapsed ? "px-1" : "px-3")}>
          <button
            onClick={toggle}
            title={isCollapsed ? (theme === "dark" ? "Light mode" : "Dark mode") : undefined}
            className={clsx(
              "w-full flex items-center gap-3 rounded-lg text-sm text-muted hover:text-white hover:bg-surface-hover transition-all",
              isCollapsed ? "justify-center px-2 py-2" : "px-3 py-2"
            )}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {!isCollapsed && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
          </button>
        </div>

        {/* Collapse toggle — desktop only */}
        {onToggleCollapse && (
          <div className={clsx("pb-1", isCollapsed ? "px-1" : "px-3")}>
            <button
              onClick={onToggleCollapse}
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={clsx(
                "w-full flex items-center gap-3 rounded-lg text-sm text-muted hover:text-white hover:bg-surface-hover transition-all",
                isCollapsed ? "justify-center px-2 py-2" : "px-3 py-2"
              )}
            >
              {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              {!isCollapsed && <span className="text-xs">Collapse</span>}
            </button>
          </div>
        )}

        {/* Auth */}
        <div className={clsx("py-4 border-t border-border", isCollapsed ? "px-1" : "px-3")}>
          {user ? (
            <div className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 py-2 text-xs text-muted truncate">{user.email}</div>
              )}
              <button
                onClick={() => { logout(); navigate("/"); onClose?.(); }}
                title={isCollapsed ? "Sign out" : undefined}
                className={clsx(
                  "w-full flex items-center gap-3 rounded-lg text-sm text-muted hover:text-white hover:bg-surface-hover transition-all",
                  isCollapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
                )}
              >
                <LogOut size={16} />
                {!isCollapsed && "Sign out"}
              </button>
            </div>
          ) : (
            <NavLink
              to="/login"
              onClick={onClose}
              title={isCollapsed ? "Sign in" : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-lg text-sm text-muted hover:text-white hover:bg-surface-hover transition-all",
                isCollapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
              )}
            >
              <LogIn size={16} />
              {!isCollapsed && "Sign in"}
            </NavLink>
          )}
        </div>
      </aside>
    );
  };

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <div className="hidden md:flex h-screen sticky top-0">
        {sidebarContent()}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={onClose}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden flex h-screen">
            {sidebarContent(true)}
          </div>
        </>
      )}
    </>
  );
}
