import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/sentry";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Last-resort boundary around the whole app: reports the render crash to
 * Sentry and shows a reload screen instead of a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, {
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="grid h-dvh place-items-center bg-background px-6 text-center"
      >
        <div className="flex max-w-sm flex-col items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <Button
            data-analytics-name="Reload after crash"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
