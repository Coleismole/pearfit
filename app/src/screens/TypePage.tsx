// Screen 11 of the design: one category (one garment type) with its reference shirts.
import { EntryRow } from "../components/Entries.tsx";
import { PlusIcon } from "../components/Icons.tsx";
import { BackLink, TabScreen } from "../components/Screen.tsx";
import { DIM_LABELS, GARMENT_NAMES } from "../lib/format.ts";
import { ownedEntry, plannedEntry } from "../lib/items.ts";
import { link } from "../lib/router.ts";
import { DIMS } from "../lib/types.ts";
import type { GarmentType } from "../lib/types.ts";
import { garmentTypeOf } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";

// The design asks for up to 3 reference shirts per category.
const TARGET = 3;

export function TypePage({ type }: { type: GarmentType }) {
  const { wardrobe, planned } = useStore();
  const names = GARMENT_NAMES[type];
  const many = names.text;
  const owned = wardrobe.filter((s) => garmentTypeOf(s) === type);
  const plannedHere = planned.filter((p) => p.garmentType === type);
  // New clothes are sized against the shirts marked as a great fit: those are the reference shirts.
  const great = owned.filter((s) => s.label === "great").length;
  const filled = Math.min(great, TARGET);

  let hint: string;
  if (owned.length === 0) hint = `Add 1–${TARGET} ${many} you own so Pearfit can size new ones.`;
  else if (great === 0) hint = `None of these is marked as a great fit. New ${many} are sized against shirts that fit you great, so add one.`;
  else if (great < TARGET) hint = `Add up to ${TARGET - great} more that fit you great to give Pearfit more to compare against.`;
  else hint = `New ${many} are sized against these.`;

  return (
    <TabScreen active="wardrobe">
      <BackLink href={link("wardrobe")}>Wardrobe</BackLink>
      <div className="stack stack--tight">
        <h1 className="display">{names.many}</h1>
        <div className="small muted">
          {owned.length} owned · {plannedHere.length} planning to buy
        </div>
      </div>

      <div className="card stack">
        <div className="row row--between">
          <div className="field__label">Reference shirts</div>
          <div className="small muted">
            {filled} of {TARGET}
          </div>
        </div>
        <div className="bars bars--wide" role="img" aria-label={`${filled} of ${TARGET} reference shirts`}>
          {Array.from({ length: TARGET }, (_, i) => (
            <span key={i} className={i < filled ? "bars__bar bars__bar--on" : "bars__bar"} />
          ))}
        </div>
        <div className="small muted">{hint}</div>
      </div>

      <div className="stack stack--tight">
        <div className="label">Measurements compared</div>
        <div className="chips chips--close">
          {DIMS.map((dim) => (
            <span className="chip chip--static" key={dim}>
              {DIM_LABELS[dim]}
            </span>
          ))}
        </div>
      </div>

      {owned.length > 0 && (
        <section className="stack stack--tight" aria-labelledby="owned-heading">
          <h2 className="heading heading--small" id="owned-heading">
            Owned
          </h2>
          {owned.map((s) => (
            <EntryRow key={s.id} entry={ownedEntry(s)} />
          ))}
        </section>
      )}

      {plannedHere.length > 0 && (
        <section className="stack stack--tight" aria-labelledby="planned-heading">
          <h2 className="heading heading--small" id="planned-heading">
            Planning to buy
          </h2>
          {plannedHere.map((p) => (
            <EntryRow key={p.candidateId} entry={plannedEntry(p)} />
          ))}
        </section>
      )}

      <a className="btn btn--primary" href={link("add")}>
        <PlusIcon size={20} />
        Add a shirt
      </a>
    </TabScreen>
  );
}
