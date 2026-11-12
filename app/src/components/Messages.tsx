// The two kinds of message box. A Notice is information (for example "no size could be suggested, and here is
// why"). An ErrorPanel is for something that went wrong, like a failed request.
import type { ReactNode } from "react";
import type { ApiError } from "../lib/api.ts";
import { AlertIcon, InfoIcon } from "./Icons.tsx";

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="notice" role="status">
      <span className="notice__icon">
        <InfoIcon />
      </span>
      <div className="stack">
        <div className="notice__title">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function ErrorPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <span className="alert__icon">
        <AlertIcon />
      </span>
      <div className="stack stack--tight">
        <div className="alert__title">{title}</div>
        <div className="alert__text">{children}</div>
      </div>
    </div>
  );
}

// A failed API call, with what to try next.
export function ApiErrorPanel({ title, error, onRetry }: { title: string; error: ApiError; onRetry(): void }) {
  return (
    <div className="stack stack--loose">
      <ErrorPanel title={title}>{error.message}</ErrorPanel>
      {error.kind === "network" && (
        <ul className="hints">
          <li className="hints__title">Try this:</li>
          <li>· Check your internet connection</li>
          <li>· Open the app on pearfit.app, or on localhost when you run it yourself. The API refuses requests from any other address.</li>
        </ul>
      )}
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="muted" role="status">
      {children}
    </p>
  );
}
