"use client";

import { Component, Fragment } from "react";
import type { ReactNode } from "react";
import { ErrorRecovery } from "@/components/ErrorRecovery";

export class AppErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  { error: Error | null; attempt: number }
> {
  state: { error: Error | null; attempt: number } = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  private retry = () => {
    this.props.onRetry?.();
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorRecovery
          onRetry={this.retry}
          onReload={() => window.location.reload()}
          detail={this.state.error.message}
        />
      );
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
