"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";

type Props = {
  children: ReactNode;
  /** Optional label for nested boundaries */
  name?: string;
};

type State = {
  error: Error | null;
  info: string | null;
};

/**
 * Catches render errors so a single panel failure does not blank the whole harness.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? null });
    console.error(`[spok] UI error in ${this.props.name ?? "app"}`, error, info);
    try {
      const key = "spok.crashLog";
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as unknown[];
      const entry = {
        at: new Date().toISOString(),
        name: this.props.name ?? "app",
        message: error.message,
        stack: error.stack?.slice(0, 2000),
        componentStack: info.componentStack?.slice(0, 2000),
      };
      localStorage.setItem(key, JSON.stringify([entry, ...prev].slice(0, 20)));
    } catch {
      /* ignore */
    }
  }

  reset = () => this.setState({ error: null, info: null });

  copy = async () => {
    const { error, info } = this.state;
    const text = [
      `Spok UI error (${this.props.name ?? "app"})`,
      error?.message,
      error?.stack,
      info,
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex h-full min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-phosphor-red/40 bg-phosphor-red/10">
          <AlertTriangle className="h-6 w-6 text-phosphor-red" />
        </div>
        <div>
          <h2 className="font-mono text-sm text-phosphor-green">
            Something went wrong
            {this.props.name ? ` · ${this.props.name}` : ""}
          </h2>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-phosphor-green/55">
            {error.message || "An unexpected UI error occurred."}
          </p>
          <p className="mt-1 max-w-md text-[11px] text-phosphor-green/35">
            Your sessions on disk are safe. Try reloading this panel or exporting
            diagnostics from Settings → Diagnostics.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={this.reset}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
          <Button size="sm" variant="secondary" onClick={() => this.copy()}>
            <Copy className="h-3.5 w-3.5" />
            Copy error
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Reload app
          </Button>
        </div>
      </div>
    );
  }
}
