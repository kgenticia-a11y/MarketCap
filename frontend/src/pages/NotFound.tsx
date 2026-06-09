import { Link } from "react-router-dom";
import { CandlestickChart } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-sidebar flex flex-col items-center justify-center text-center px-4">
      <CandlestickChart size={44} className="text-muted mb-4" />
      <h1 className="text-4xl font-bold text-white mb-2">404</h1>
      <p className="text-sm text-muted mb-5">Page not found.</p>
      <Link to="/" className="text-accent-light hover:text-accent text-sm">Back to Dashboard</Link>
    </div>
  );
}
