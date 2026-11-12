// Catches a crash while a screen renders and shows a message with a way out, instead of a blank page.
// Reporting is not done here: main.tsx already sends every error React catches to Sentry (onCaughtError).
import { Component } from "react";
import type { ReactNode } from "react";
import { link } from "../lib/router.ts";
import { ErrorPanel } from "./Messages.tsx";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="screen">
        <div className="stack stack--loose">
          <h1 className="title">Something went wrong</h1>
          <ErrorPanel title="This screen could not be shown">
            Your wardrobe is still saved on this device. Reload the page, or go back to Home.
          </ErrorPanel>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a className="btn btn--outline" href={link()}>
            Go to Home
          </a>
        </div>
      </main>
    );
  }
}
