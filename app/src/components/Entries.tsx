// How a wardrobe entry (an owned shirt or a planned one) is drawn in a grid and in a list.
import { link } from "../lib/router.ts";
import type { WardrobeEntry } from "../lib/items.ts";
import { Thumb } from "./Thumb.tsx";

// The page of an entry: the owned shirt, or the planned catalog shirt.
export function entryHref(entry: WardrobeEntry): string {
  return link(entry.kind, entry.key);
}

export function EntryTile({ entry }: { entry: WardrobeEntry }) {
  return (
    <a className="tile" href={entryHref(entry)}>
      <Thumb seed={entry.key} variant="tile">
        <span className="tile__badge">{entry.badge}</span>
      </Thumb>
      <span className="tile__name">{entry.title}</span>
      <span className="tiny muted">{entry.detail}</span>
    </a>
  );
}

export function EntryRow({ entry }: { entry: WardrobeEntry }) {
  return (
    <a className="list-row" href={entryHref(entry)}>
      <Thumb seed={entry.key} variant="row" />
      <span className="list-row__text">
        <span className="list-row__name">{entry.title}</span>
        <span className="small muted">{entry.detail}</span>
      </span>
      <span className="list-row__badge">{entry.badge}</span>
    </a>
  );
}
