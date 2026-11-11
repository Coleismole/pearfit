// The "Compare with" sheet on an item page: the other shirts of the same kind that have measurements.
// It is a native <dialog> opened as a modal, so the browser keeps keyboard focus inside it, makes the page
// behind it inactive and closes it on Escape.
import { useEffect, useRef, useState } from "react";
import { comparableEntries } from "../lib/items.ts";
import type { EntryKind, WardrobeEntry } from "../lib/items.ts";
import { GARMENT_NAMES } from "../lib/format.ts";
import { link } from "../lib/router.ts";
import { useStore } from "../store.tsx";
import { go } from "../useRoute.ts";
import { CloseIcon } from "./Icons.tsx";
import { Thumb } from "./Thumb.tsx";

type Filter = "all" | EntryKind;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "owned", label: "Owned" },
  { value: "planned", label: "Planning to buy" },
];

// `closeHref` is the item page without the sheet.
export function ComparePicker({ entry, closeHref }: { entry: WardrobeEntry; closeHref: string }) {
  const { wardrobe, planned } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const dialog = useRef<HTMLDialogElement>(null);

  const others = comparableEntries(entry, wardrobe, planned);
  const shown = others.filter((o) => filter === "all" || o.kind === filter);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    // The page behind the sheet must not scroll while it is open.
    document.body.classList.add("sheet-open");
    return () => document.body.classList.remove("sheet-open");
  }, []);

  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-label="Compare with"
      onClose={() => go(closeHref)} // Escape
      onClick={(e) => {
        if (e.target === dialog.current) go(closeHref); // a click on the dimmed area outside the sheet
      }}
    >
      <div className="sheet__grip" />
      <div className="row row--between row--top">
        <div className="stack stack--tight">
          <h2 className="title">Compare with</h2>
          <div className="small muted">Other {GARMENT_NAMES[entry.garmentType].text} in your wardrobe</div>
        </div>
        <a className="icon-button icon-button--round" href={closeHref} aria-label="Close">
          <CloseIcon />
        </a>
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label} · {f.value === "all" ? others.length : others.filter((o) => o.kind === f.value).length}
          </button>
        ))}
      </div>
      <div className="sheet__body">
        {shown.length === 0 ? (
          <div className="empty">Nothing else to compare with here yet. Add another shirt, or save one you plan to buy.</div>
        ) : (
          <div className="grid-2">
            {shown.map((other) => (
              <a key={other.ref} className="tile" href={link("compare", { a: entry.ref, b: other.ref })}>
                <Thumb seed={other.key} variant="tile">
                  <span className={other.kind === "owned" ? "tile__status" : "tile__status tile__status--planned"}>
                    {other.kind === "owned" ? "Owned" : "Planning to buy"}
                  </span>
                </Thumb>
                <span className="tile__name">{other.title}</span>
                <span className="tiny muted">{other.detail}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
