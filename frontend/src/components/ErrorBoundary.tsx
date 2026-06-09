import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border border-border bg-surface text-center">
          <AlertTriangle size={20} className="text-negative" />
          <div>
            <p className="text-sm font-medium text-white mb-0.5">
              {this.props.label ?? "Something went wrong"}
            </p>
            <p className="text-xs text-muted">{this.state.error.message}</p>
          </div>
          <button
            onClick={this.reset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover text-xs text-muted hover:text-white transition-colors"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
