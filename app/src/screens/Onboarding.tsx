// Screen 1 of the design: the welcome screen. It explains the idea and shows how many shirts of each kind
// are in the wardrobe so far.
import { useCatalog } from "../catalog.tsx";
import { PlusIcon } from "../components/Icons.tsx";
import { GARMENT_NAMES, countOf } from "../lib/format.ts";
import { link } from "../lib/router.ts";
import { DEFAULT_GARMENT_TYPE, GARMENT_TYPES } from "../lib/types.ts";
import type { GarmentType } from "../lib/types.ts";
import { garmentTypeOf } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";
import { go } from "../useRoute.ts";

// The design asks for 1 to 3 shirts per category.
const TARGET = 3;

export function Onboarding() {
  const { wardrobe, finishOnboarding } = useStore();
  const { state } = useCatalog();
  const catalog = state.status === "ready" ? state.candidates : [];

  const inCatalog = (type: GarmentType) => catalog.filter((c) => c.garmentType === type).length;
  const owned = (type: GarmentType) => wardrobe.filter((s) => garmentTypeOf(s) === type).length;
  // A row for every kind the catalog can check right now, every kind already in the wardrobe, and tees.
  const types = GARMENT_TYPES.filter((t) => t === DEFAULT_GARMENT_TYPE || inCatalog(t) > 0 || owned(t) > 0);

  return (
    <main className="screen screen--welcome">
      <div className="stack">
        <div className="eyebrow">Step 1 of 1</div>
        <h1 className="display display--welcome">Teach Pearfit how clothes fit you</h1>
        <p className="lead">
          Add 1–{TARGET} shirts you own in each category and say how each one fits. New clothes are sized against them.
        </p>
      </div>

      <div className="stack">
        {types.map((type) => {
          const count = owned(type);
          const filled = Math.min(count, TARGET);
          return (
            <div className="card row row--wide" key={type}>
              <div className="stack stack--tight grow">
                <div className="heading heading--small">{GARMENT_NAMES[type].many}</div>
                <div className="bars" role="img" aria-label={`${filled} of ${TARGET} added`}>
                  {Array.from({ length: TARGET }, (_, i) => (
                    <span key={i} className={i < filled ? "bars__bar bars__bar--on" : "bars__bar"} />
                  ))}
                  <span className="small muted bars__count">
                    {filled} of {TARGET}
                  </span>
                </div>
                {inCatalog(type) > 0 && <div className="tiny muted">{countOf(inCatalog(type), "shirt", "shirts")} in the catalog to check</div>}
              </div>
              <a
                className="btn btn--outline btn--small"
                href={inCatalog(type) > 0 ? link("add") : link("add", "by-hand", { type })}
                aria-label={`Add to ${GARMENT_NAMES[type].many}`}
              >
                Add
              </a>
            </div>
          );
        })}

        <a className="btn btn--dashed" href={link("add", "by-hand")}>
          <PlusIcon />
          Add another kind of shirt
        </a>
      </div>

      <div className="tip">Tip: include one piece that fits perfectly and one that doesn't. Pearfit learns from both.</div>

      <div className="spacer" />

      <div className="stack">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            finishOnboarding();
            go(link());
          }}
        >
          Continue
        </button>
        <p className="small muted center">You need at least 1 shirt that fits great in a category to size new clothes in it.</p>
      </div>
    </main>
  );
}
