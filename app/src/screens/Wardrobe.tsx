// Screens 4 and 10 of the design: the wardrobe, with its "Owned" and "Planning to buy" tabs.
import { EntryTile } from "../components/Entries.tsx";
import { PlusIcon } from "../components/Icons.tsx";
import { TabScreen } from "../components/Screen.tsx";
import { GARMENT_NAMES } from "../lib/format.ts";
import { ownedEntry, plannedEntry } from "../lib/items.ts";
import { link } from "../lib/router.ts";
import { GARMENT_TYPES } from "../lib/types.ts";
import { useStore } from "../store.tsx";

export function Wardrobe({ tab }: { tab: "owned" | "planned" }) {
  const { wardrobe, planned } = useStore();
  const owned = wardrobe.map(ownedEntry);
  const plannedEntries = planned.map(plannedEntry);
  const shown = tab === "owned" ? owned : plannedEntries;
  const all = [...owned, ...plannedEntries];
  // Only the kinds that have something in them.
  const types = GARMENT_TYPES.filter((type) => all.some((e) => e.garmentType === type));

  return (
    <TabScreen active="wardrobe">
      <div className="row row--between">
        <h1 className="display">Wardrobe</h1>
        <a className="btn btn--outline btn--small" href={link("add")}>
          <PlusIcon />
          Add
        </a>
      </div>

      <nav className="segmented" aria-label="Wardrobe lists">
        <a href={link("wardrobe")} aria-current={tab === "owned" ? "page" : undefined}>
          Owned · {owned.length}
        </a>
        <a href={link("wardrobe", "planned")} aria-current={tab === "planned" ? "page" : undefined}>
          Planning to buy · {plannedEntries.length}
        </a>
      </nav>

      {types.length > 0 && (
        <div className="stack stack--tight">
          <div className="label">Categories</div>
          <div className="chips">
            {types.map((type) => (
              <a className="chip" key={type} href={link("type", type)}>
                {GARMENT_NAMES[type].many} <span className="muted">{all.filter((e) => e.garmentType === type).length}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty stack stack--loose">
          <div>Nothing here yet.</div>
          {tab === "owned" ? (
            <a className="btn btn--primary" href={link("add")}>
              Add a shirt you own
            </a>
          ) : (
            <div>Check a shirt on the Home tab, then save it here.</div>
          )}
        </div>
      ) : (
        <div className="grid-2">
          {shown.map((entry) => (
            <EntryTile key={entry.ref} entry={entry} />
          ))}
        </div>
      )}
    </TabScreen>
  );
}
