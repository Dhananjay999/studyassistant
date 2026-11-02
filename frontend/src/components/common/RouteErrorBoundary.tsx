import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { reportRenderCrash } from "@/components/common/ErrorBoundary";

interface Props {
  children: ReactNode;
  /** Changing this (the route path) clears a caught error automatically. */
  resetKey: string;
}

interface State {
  failed: boolean;
  resetKey: string;
}

/**
 * Boundary around the routed page only: a crash inside one screen (a
 * translated text node React can no longer find, a bad render) shows a
 * compact "try again" card where the page was, instead of blanking the whole
 * app behind the reload-only screen. "Try again" re-mounts the page in place
 * and navigating away clears the error; the app boundary in `main.tsx` stays
 * as the last resort.
 */
class RouteErrorBoundaryInner extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { failed: false, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportRenderCrash(error, info, "route");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="grid min-h-[60dvh] place-items-center px-6 text-center"
      >
        <div className="flex max-w-sm flex-col items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            This page hit a snag
          </h2>
          <p className="text-sm text-muted-foreground">
            Nothing you did was lost. Try again, or reload if it happens
            twice.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              className="min-h-11"
              data-analytics-name="Route crash try again"
              onClick={() => this.setState({ failed: false })}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              data-analytics-name="Reload after crash"
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/** `RouteErrorBoundaryInner` keyed by the current path (needs the router). */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundaryInner resetKey={pathname}>
      {children}
    </RouteErrorBoundaryInner>
  );
}
