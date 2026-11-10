// A button for something that cannot be undone. The first press asks, the second one does it.
import { useState } from "react";

interface Props {
  label: string;
  question: string; // "Remove this shirt from your wardrobe?"
  confirmLabel: string; // "Remove"
  onConfirm(): void;
  className?: string;
}

export function ConfirmButton({ label, question, confirmLabel, onConfirm, className = "btn btn--danger" }: Props) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="card stack" role="group" aria-label={question}>
      <div className="heading heading--small">{question}</div>
      <div className="row">
        <button type="button" className="btn btn--outline btn--small btn--grow" onClick={() => setAsking(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger btn--small btn--grow"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
