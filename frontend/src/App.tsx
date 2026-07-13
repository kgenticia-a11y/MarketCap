import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute, PublicRoute } from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Stock from "./pages/Stock";
import Portfolio from "./pages/Portfolio";
import Watchlist from "./pages/Watchlist";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";
import InteractiveChart from "./pages/InteractiveChart";
import IncomeEstimator from "./pages/IncomeEstimator";
import MarketUpdate from "./pages/MarketUpdate";
import History from "./pages/History";
import Settings from "./pages/Settings";
import FeedbackPage from "./pages/Feedback";
import Screener from "./pages/Screener";
import PaperTrading from "./pages/PaperTrading";
import Alerts from "./pages/Alerts";
import Terms from "./pages/Terms";
import AnalystReport from "./pages/AnalystReport";

/** Shorthand: wraps a page in both ProtectedRoute and Layout */
function Private({ title, fullHeight, children }: {
  title: string;
  fullHeight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <Layout title={title} fullHeight={fullHeight}>
        {children}
      </Layout>
    </ProtectedRoute>
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* ── Protected: requires sign-in ─────────────────────────────── */}
      <Route path="/"         element={<Private title="Dashboard"><Home /></Private>} />
      <Route path="/chart"    element={<Private title="Interactive Chart" fullHeight><InteractiveChart /></Private>} />
      <Route path="/stock/:ticker" element={<Private title="Stock Detail"><Stock /></Private>} />
      <Route path="/portfolio" element={<Private title="Portfolio"><Portfolio /></Private>} />
      <Route path="/watchlist" element={<Private title="Watchlist"><Watchlist /></Private>} />
      <Route path="/market"   element={<Private title="Market Update"><MarketUpdate /></Private>} />
      <Route path="/income"   element={<Private title="Income Estimator"><IncomeEstimator /></Private>} />
      <Route path="/settings" element={<Private title="Settings"><Settings /></Private>} />
      <Route path="/history"  element={<Private title="History"><History /></Private>} />
      <Route path="/feedback" element={<Private title="Feedback"><FeedbackPage /></Private>} />
      <Route path="/screener" element={<Private title="Stock Screener"><Screener /></Private>} />
      <Route path="/paper-trading" element={<Private title="Paper Trading"><PaperTrading /></Private>} />
      <Route path="/alerts"   element={<Private title="Alerts"><Alerts /></Private>} />
      <Route path="/analyst-report" element={<Private title="Analyst Report"><AnalystReport /></Private>} />

      {/* ── Public: redirect to dashboard if already signed in ───────── */}
      <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

      {/* ── Always public ────────────────────────────────────────────── */}
      <Route path="/terms"    element={<Terms />} />
      <Route path="*"         element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
