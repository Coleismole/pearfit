// Screens 7 and 15 of the design: a new shirt next to one you own, and any two wardrobe shirts side by side.
import { useCatalog } from "../catalog.tsx";
import { CompareCard, CompareTable } from "../components/Compare.tsx";
import { entryHref } from "../components/Entries.tsx";
import { ApiErrorPanel, Loading, Notice } from "../components/Messages.tsx";
import { SaveToPlanned } from "../components/SaveToPlanned.tsx";
import { BackLink, SubScreen } from "../components/Screen.tsx";
import { biggestDifference, compareRows } from "../lib/compare.ts";
import { FIT_NAMES, GARMENT_NAMES, formatPercent } from "../lib/format.ts";
import { findEntry, ownedEntry, plannedFrom } from "../lib/items.ts";
import { link } from "../lib/router.ts";
import type { PickerCandidate, RecommendResponse } from "../lib/types.ts";
import { garmentTypeOf, hasAnyMeasurement } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";
import { useRecommendation } from "../useRecommendation.ts";
import { swap } from "../useRoute.ts";

// `size` and `withId` come from the address: which size of the new shirt, and which owned shirt to put next to it.
export function CompareNew({ candidateId, size, withId }: { candidateId: string; size?: string; withId?: string }) {
  const { state, reload } = useRecommendation(candidateId);
  const catalog = useCatalog();
  const candidate = catalog.find(candidateId);

  let body;
  if (catalog.state.status === "error") {
    body = <ApiErrorPanel title="Couldn't load the catalog" error={catalog.state.error} onRetry={catalog.reload} />;
  } else if (state.status === "error") {
    body = <ApiErrorPanel title="Couldn't check this shirt" error={state.error} onRetry={reload} />;
  } else if (state.status === "no-wardrobe") {
    body = (
      <Notice title="Add a shirt you own first">
        <p className="notice__text">There is nothing in your wardrobe to compare this shirt with.</p>
        <a className="btn btn--primary btn--small" href={link("add")}>
          Add a shirt
        </a>
      </Notice>
    );
  } else if (catalog.state.status === "loading" || state.status === "loading") {
    body = <Loading>Loading the comparison…</Loading>;
  } else if (!candidate) {
    body = (
      <Notice title="This shirt is not in the catalog">
        <p className="notice__text">Its size chart is not available, so there is nothing to put side by side.</p>
      </Notice>
    );
  } else {
    body = <NewVersusOwned candidate={candidate} result={state.result} sizeParam={size} withId={withId} />;
  }

  return (
    <SubScreen title="Compare fit" back={link("check", candidateId)} backLabel="Back to the analysis">
      {body}
    </SubScreen>
  );
}

function NewVersusOwned({ candidate, result, sizeParam, withId }: { candidate: PickerCandidate; result: RecommendResponse; sizeParam?: string; withId?: string }) {
  const { wardrobe, planned } = useStore();
  const sizes = Object.keys(candidate.sizes);
  const size = sizeParam !== undefined && sizes.includes(sizeParam) ? sizeParam : (result.size ?? sizes[0]);
  // Only shirts of the same kind are compared, the same rule the engine uses.
  const comparable = wardrobe.filter((s) => garmentTypeOf(s) === candidate.garmentType && hasAnyMeasurement(s.measurements));
  const shirt = comparable.find((s) => s.id === withId) ?? comparable.find((s) => s.id === result.fitsLike) ?? comparable[0];
  const kind = GARMENT_NAMES[candidate.garmentType];

  if (!shirt || size === undefined) {
    return (
      <Notice title="Nothing to compare with">
        <p className="notice__text">Your wardrobe has no {kind.text} with measurements.</p>
        <a className="btn btn--primary btn--small" href={link("add")}>
          Add a shirt
        </a>
      </Notice>
    );
  }

  const entry = ownedEntry(shirt);
  const suggested = size === result.size;
  const here = (next: { size?: string; with?: string }) =>
    link("check", candidate.id, "compare", { size: next.size ?? sizeParam, with: next.with ?? withId });
  const saved = planned.find((p) => p.candidateId === candidate.id);

  return (
    <>
      <div className="compare-cards">
        <CompareCard
          first
          tag={`New · size ${size}`}
          seed={candidate.id}
          name={candidate.name}
          detail={suggested ? `Suggested size · ${formatPercent(result.matchPercent)} match` : "Not the suggested size"}
        />
        <CompareCard tag={`You own · ${FIT_NAMES[shirt.label].badge}`} seed={shirt.id} name={entry.title} detail={entry.detail} />
      </div>

      <div className="field">
        <div className="label" id="compare-size">
          Size of the new shirt
        </div>
        <div className="sizes" role="group" aria-labelledby="compare-size">
          {sizes.map((s) => (
            <button key={s} type="button" className="size" aria-pressed={s === size} onClick={() => swap(here({ size: s }))}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {comparable.length > 1 && (
        <div className="field">
          <label className="label" htmlFor="compare-with">
            Your shirt
          </label>
          <select id="compare-with" className="input" value={shirt.id} onChange={(e) => swap(here({ with: e.target.value }))}>
            {comparable.map((s) => (
              <option key={s.id} value={s.id}>
                {ownedEntry(s).title} ({FIT_NAMES[s.label].badge})
              </option>
            ))}
          </select>
        </div>
      )}

      <CompareTable first={candidate.sizes[size]} second={shirt.measurements} headers={["New", "Yours", "New vs yours"]} words />

      {/* The words come from the API. The app only adds which size is on screen. */}
      <div className="tip">
        {result.size !== null && !suggested ? `Size ${size} is not the suggested size. ` : ""}
        {result.verdict}
      </div>

      <div className="spacer" />
      <SaveToPlanned item={plannedFrom({ candidateId: candidate.id, name: candidate.name, result, candidate, previous: saved, now: new Date() })} />
    </>
  );
}

// `a` and `b` are entry references from the address, like "owned:blue-tee" and "planned:e465187-000".
export function CompareItems({ a: aRef, b: bRef }: { a?: string; b?: string }) {
  const { wardrobe, planned } = useStore();
  const a = aRef === undefined ? null : findEntry(aRef, wardrobe, planned);
  const b = bRef === undefined ? null : findEntry(bRef, wardrobe, planned);

  if (!a || !b || a.measurements === null || b.measurements === null || a.garmentType !== b.garmentType) {
    return (
      <main className="screen">
        <BackLink href={a ? entryHref(a) : link("wardrobe")}>{a ? "Back to item" : "Wardrobe"}</BackLink>
        <Notice title="These two can't be compared">
          <p className="notice__text">
            {a && b && a.garmentType !== b.garmentType
              ? "Only shirts of the same kind are compared."
              : "One of them is no longer in your wardrobe, or has no measurements."}
          </p>
        </Notice>
      </main>
    );
  }

  return (
    <main className="screen">
      <BackLink href={entryHref(a)}>Back to item</BackLink>
      <h1 className="title title--item">Compare fit</h1>
      <div className="compare-cards">
        <CompareCard first tag={`A · ${a.status}`} seed={a.key} name={a.title} detail={a.detail} />
        <CompareCard tag={`B · ${b.status}`} seed={b.key} name={b.title} detail={b.detail} />
      </div>
      <CompareTable first={a.measurements} second={b.measurements} headers={["A", "B", "A vs B"]} />
      <div className="tip">{biggestDifference(compareRows(b.measurements, a.measurements), "A", "B")}</div>
      <a className="btn btn--outline-strong" href={link(a.kind, a.key, { pick: "1" })}>
        Compare with something else
      </a>
    </main>
  );
}
