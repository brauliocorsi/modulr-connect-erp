import { Component, ReactNode } from "react";

type Props = {
  name: string;
  children: ReactNode;
  /** Optional fallback. Defaults to rendering nothing so the widget hides silently. */
  fallback?: ReactNode;
};

type State = { hasError: boolean };

/**
 * Isolates failures of global widgets (chat dock, bells, search, etc.) so a
 * broken peripheral never blocks critical flows like sale confirmation,
 * picking, delivery or payments.
 *
 * Renders the optional fallback (default: nothing) when a child throws and
 * logs the error via console.warn — never via toast — per F25-GUARD.
 */
export class GlobalWidgetsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Diagnostic only — must not surface a toast or rethrow.
    // eslint-disable-next-line no-console
    console.warn(`[GlobalWidgetsErrorBoundary:${this.props.name}]`, error, info);
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

export default GlobalWidgetsErrorBoundary;
