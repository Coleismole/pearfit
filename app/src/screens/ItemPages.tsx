// Screens 12 and 5 of the design: the page of a shirt you own, and the page of a shirt you plan to buy.
// Screen 14, the "Compare with" sheet, opens on top of either one.
import { ComparePicker } from "../components/ComparePicker.tsx";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { entryHref } from "../components/Entries.tsx";
import { CompareIcon } from "../components/Icons.tsx";
import { MeasurementList } from "../components/Measurements.tsx";
import { Notice } from "../components/Messages.tsx";
import { BackLink } from "../components/Screen.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { Thumb } from "../components/Thumb.tsx";
import { GARMENT_NAMES, formatPercent } from "../lib/format.ts";
import { comparableEntries, ownedEntry, plannedEntry } from "../lib/items.ts";
import type { WardrobeEntry } from "../lib/items.ts";
import { link } from "../lib/router.ts";
import type { FitLabel } from "../lib/types.ts";
import { garmentTypeOf } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";
import { go } from "../useRoute.ts";
import { FIT_OPTIONS } from "./AddShirt.tsx";

function Missing({ what, back }: { what: string; back: string }) {
  return (
    <main className="screen">
      <BackLink href={back}>Wardrobe</BackLink>
      <Notice title={`This shirt is not in ${what}`}>
        <p className="notice__text">It may have been removed.</p>
      </Notice>
    </main>
  );
}

// The Compare button, and the sheet when the address says it is open (?pick=1).
function CompareAction({ entry, picking }: { entry: WardrobeEntry; picking: boolean }) {
  const { wardrobe, planned } = useStore();
  const others = comparableEntries(entry, wardrobe, planned);
  if (entry.measurements === null) return null;
  return (
    <>
      {others.length > 0 ? (
        <a className="btn btn--primary" href={link(entry.kind, entry.key, { pick: "1" })}>
          <CompareIcon />
          Compare
        </a>
      ) : (
        <p className="small muted center">You have no other {GARMENT_NAMES[entry.garmentType].text} to compare this one with.</p>
      )}
      {picking && <ComparePicker entry={entry} closeHref={entryHref(entry)} />}
    </>
  );
}

// What each fit label is used for. This is how the engine treats them.
function fitMeaning(label: FitLabel, many: string): string {
  if (label === "great") return `New ${many} are sized against this shirt.`;
  return `Pearfit warns you when a new shirt has nearly the same chest width as this one.`;
}

export function OwnedItem({ id, picking }: { id: string; picking: boolean }) {
  const { wardrobe, saveShirt, removeShirt } = useStore();
  const shirt = wardrobe.find((s) => s.id === id);
  if (!shirt) return <Missing what="your wardrobe" back={link("wardrobe")} />;

  const entry = ownedEntry(shirt);
  const many = GARMENT_NAMES[garmentTypeOf(shirt)].text;

  return (
    <main className="screen">
      <BackLink href={link("wardrobe")}>Wardrobe</BackLink>
      <Thumb seed={shirt.id} variant="hero" />
      <div className="stack stack--tight">
        <h1 className="title title--item">{entry.title}</h1>
        <div className="small muted">{entry.detail}</div>
      </div>

      <div className="card stack">
        <div className="label">How it fits you</div>
        <Segmented
          label="How it fits you"
          options={FIT_OPTIONS}
          value={shirt.label}
          onChange={(label) => saveShirt({ ...shirt, label }, shirt.id)}
        />
        <div className="tiny muted">{fitMeaning(shirt.label, many)}</div>
      </div>

      <CompareAction entry={entry} picking={picking} />

      <MeasurementList measurements={shirt.measurements} />
      <p className="tiny muted center">
        {shirt.sku && shirt.size ? `Added from the catalog: ${shirt.sku}, size ${shirt.size}` : "Measurements you entered"}
      </p>

      <a className="btn btn--outline" href={link("owned", shirt.id, "edit")}>
        Edit
      </a>
      <ConfirmButton
        label="Remove from wardrobe"
        question="Remove this shirt from your wardrobe?"
        confirmLabel="Remove"
        onConfirm={() => {
          removeShirt(shirt.id);
          go(link("wardrobe"));
        }}
      />
    </main>
  );
}

export function PlannedItemPage({ candidateId, picking }: { candidateId: string; picking: boolean }) {
  const { planned, removePlannedItem } = useStore();
  const item = planned.find((p) => p.candidateId === candidateId);
  if (!item) return <Missing what="Planning to buy" back={link("wardrobe", "planned")} />;

  const entry = plannedEntry(item);
  const { size, matchPercent, verdict } = item.result;
  const checked = new Date(item.savedAt);

  return (
    <main className="screen">
      <BackLink href={link("wardrobe", "planned")}>Wardrobe</BackLink>
      <Thumb seed={item.candidateId} variant="hero" />
      <div className="stack stack--tight">
        <h1 className="title title--item">{item.name}</h1>
        <div className="small muted">
          {entry.detail} · SKU {item.candidateId}
        </div>
      </div>

      <div className="card stack">
        <div className="row row--between">
          <div className="stack stack--tight">
            <div className="label">Predicted suitability</div>
            <div className="stat__value">{size === null ? "No size yet" : formatPercent(matchPercent)}</div>
          </div>
          <a className="btn btn--outline btn--small" href={link("check", item.candidateId)}>
            See analysis
          </a>
        </div>
        <div className="small">{verdict}</div>
        {!Number.isNaN(checked.getTime()) && <div className="tiny muted">Last checked on {checked.toLocaleDateString()}</div>}
      </div>

      <CompareAction entry={entry} picking={picking} />

      {entry.measurements !== null && (
        <>
          <MeasurementList measurements={entry.measurements} />
          <p className="tiny muted center">Size {size} in the catalog's size chart</p>
        </>
      )}

      <a className="btn btn--outline" href={link("add", "item", item.candidateId)}>
        I bought it
      </a>
      <ConfirmButton
        label="Remove from Planning to buy"
        question="Remove this shirt from Planning to buy?"
        confirmLabel="Remove"
        onConfirm={() => {
          removePlannedItem(item.candidateId);
          go(link("wardrobe", "planned"));
        }}
      />
    </main>
  );
}
