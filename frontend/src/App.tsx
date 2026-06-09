import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Stock from "./pages/Stock";
import Portfolio from "./pages/Portfolio";
import Watchlist from "./pages/Watchlist";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";
import InteractiveChart from "./pages/InteractiveChart";
import NewsPage from "./pages/News";
import IncomeEstimator from "./pages/IncomeEstimator";
import MarketUpdate from "./pages/MarketUpdate";
import History from "./pages/History";
import Settings from "./pages/Settings";
import MutualFunds from "./pages/MutualFunds";
import FeedbackPage from "./pages/Feedback";
import Screener from "./pages/Screener";
import Terms from "./pages/Terms";

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={
        <Layout title="Dashboard">
          <Home />
        </Layout>
      } />
      <Route path="/chart" element={
        <Layout title="Interactive Chart" fullHeight>
          <InteractiveChart />
        </Layout>
      } />
      <Route path="/stock/:ticker" element={
        <Layout title="Stock Detail">
          <Stock />
        </Layout>
      } />
      <Route path="/portfolio" element={
        <Layout title="Portfolio">
          <Portfolio />
        </Layout>
      } />
      <Route path="/watchlist" element={
        <Layout title="Watchlist">
          <Watchlist />
        </Layout>
      } />
      <Route path="/market"   element={<Layout title="Market Update"><MarketUpdate /></Layout>} />
      <Route path="/income"   element={<Layout title="Income Estimator"><IncomeEstimator /></Layout>} />
      <Route path="/funds"    element={<Layout title="Mutual Funds"><MutualFunds /></Layout>} />
      <Route path="/settings" element={<Layout title="Settings"><Settings /></Layout>} />
      <Route path="/history"  element={<Layout title="History"><History /></Layout>} />
      <Route path="/news"     element={<Layout title="News"><NewsPage /></Layout>} />
      <Route path="/feedback" element={<Layout title="Feedback"><FeedbackPage /></Layout>} />
      <Route path="/screener" element={<Layout title="Stock Screener"><Screener /></Layout>} />
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />
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
