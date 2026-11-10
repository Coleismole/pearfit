// Adding a shirt you own from the catalog. This takes the place of the design's tag scanner (screen 3, "Tag
// scanned"): there is no camera step, the shirt is found by its name or by the SKU printed on the tag.
import { useState } from "react";
import type { FormEvent } from "react";
import { useCatalog } from "../catalog.tsx";
import { CatalogSearch } from "../components/CatalogSearch.tsx";
import { CheckIcon } from "../components/Icons.tsx";
import { MeasurementList } from "../components/Measurements.tsx";
import { ApiErrorPanel, Loading, Notice } from "../components/Messages.tsx";
import { SubScreen } from "../components/Screen.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { Thumb } from "../components/Thumb.tsx";
import { FIT_NAMES, GARMENT_NAMES } from "../lib/format.ts";
import { link } from "../lib/router.ts";
import type { FitLabel, PickerCandidate } from "../lib/types.ts";
import { hasAnyMeasurement, makeShirt, slugify } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";
import { go } from "../useRoute.ts";

export const FIT_OPTIONS: { value: FitLabel; label: string }[] = [
  { value: "tight", label: FIT_NAMES.tight.choice },
  { value: "great", label: FIT_NAMES.great.choice },
  { value: "loose", label: FIT_NAMES.loose.choice },
];

// Step 1: find the shirt.
export function AddFromCatalog() {
  return (
    <SubScreen title="Add to wardrobe" back={link("wardrobe")} backLabel="Back to wardrobe">
      <div className="card card--roomy">
        <CatalogSearch label="Find a shirt you own" hrefFor={(c) => link("add", "item", c.id)} browse />
      </div>
      <div className="stack">
        <p className="small muted center">Not in the catalog? Measure the shirt laid flat and type the numbers in.</p>
        <a className="btn btn--outline" href={link("add", "by-hand")}>
          Enter measurements
        </a>
      </div>
    </SubScreen>
  );
}

// Step 2: say which size you own and how it fits.
export function AddFound({ candidateId }: { candidateId: string }) {
  const { state, reload, find } = useCatalog();
  const candidate = find(candidateId);
  return (
    <SubScreen title="Shirt found" back={link("add")} backLabel="Back to the catalog">
      {state.status === "loading" && <Loading>Loading the catalog…</Loading>}
      {state.status === "error" && <ApiErrorPanel title="Couldn't load the catalog" error={state.error} onRetry={reload} />}
      {state.status === "ready" && !candidate && (
        <Notice title="This shirt is not in the catalog">
          <p className="notice__text">Nothing in the catalog has the id “{candidateId}”.</p>
          <a className="btn btn--outline btn--small" href={link("add")}>
            Search the catalog
          </a>
        </Notice>
      )}
      {candidate && <FoundForm candidate={candidate} />}
    </SubScreen>
  );
}

function FoundForm({ candidate }: { candidate: PickerCandidate }) {
  const { wardrobe, saveShirt, removePlannedItem } = useStore();
  const sizes = Object.keys(candidate.sizes);
  const [size, setSize] = useState<string | null>(sizes.length === 1 ? sizes[0] : null);
  const [label, setLabel] = useState<FitLabel | null>(null);
  // The name starts as "<product name> <size>" and follows the size until the person types their own.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const name = typedName ?? (size === null ? candidate.name : `${candidate.name} ${size}`);
  const id = slugify(name);
  const row = size === null ? null : candidate.sizes[size];

  const errors = {
    size: size === null ? "Choose the size you own." : null,
    // A chart row with no numbers cannot be used as a reference, and no numbers are made up for it.
    chart: row !== null && !hasAnyMeasurement(row) ? "The catalog has no measurements for this size. Pick another size, or enter the measurements yourself." : null,
    name: id === "" ? "Use at least one letter or number in the name." : wardrobe.some((s) => s.id === id) ? "You already have a shirt with this name." : null,
    label: label === null ? "Choose how it fits you." : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!valid || size === null || label === null || row === null) return;
    // The numbers are the catalog's chart row for that size, copied as they are. A missing one stays missing.
    saveShirt(makeShirt({ id, label, garmentType: candidate.garmentType, measurements: row, sku: candidate.id, size }));
    removePlannedItem(candidate.id); // it is owned now, so it leaves "Planning to buy"
    go(link("wardrobe"));
  }

  return (
    <form className="stack stack--loose grow" onSubmit={onSubmit} noValidate>
      <div className="card card--roomy stack stack--loose">
        <div className="row found-flag">
          <CheckIcon />
          Found in the catalog
        </div>
        <div className="row row--wide">
          <Thumb seed={candidate.id} variant="head" />
          <div className="stack stack--tight min0">
            <div className="heading heading--product">{candidate.name}</div>
            <div className="small muted">
              {GARMENT_NAMES[candidate.garmentType].one} · SKU {candidate.id}
            </div>
          </div>
        </div>

        <div className="field">
          <div className="field__label field__label--small" id="size-label">
            Which size do you own?
          </div>
          <div className="sizes" role="group" aria-labelledby="size-label">
            {sizes.map((s) => (
              <button key={s} type="button" className="size" aria-pressed={s === size} onClick={() => setSize(s)}>
                {s}
              </button>
            ))}
          </div>
          {tried && errors.size && <div className="field__error">{errors.size}</div>}
          {errors.chart && <div className="field__error">{errors.chart}</div>}
        </div>

        {row !== null && hasAnyMeasurement(row) && (
          <div className="field">
            <div className="field__label field__label--small">Size {size} in the catalog's size chart</div>
            <MeasurementList measurements={row} />
          </div>
        )}

        <div className="field">
          <label className="field__label field__label--small" htmlFor="found-name">
            Name in your wardrobe
          </label>
          <input
            id="found-name"
            className="input"
            type="text"
            autoComplete="off"
            value={name}
            aria-invalid={tried && errors.name !== null}
            onChange={(e) => setTypedName(e.target.value)}
          />
          {tried && errors.name ? <div className="field__error">{errors.name}</div> : id !== "" && <div className="field__hint">Saved as {id}</div>}
        </div>
      </div>

      <div className="card card--roomy stack">
        <div className="search-label">How does it fit you?</div>
        <Segmented label="How does it fit you?" options={FIT_OPTIONS} value={label} onChange={(value) => setLabel(value)} />
        <div className="field__hint">New clothes are sized against the shirts that fit you great.</div>
        {tried && errors.label && <div className="field__error">{errors.label}</div>}
      </div>

      <div className="spacer" />

      <div className="stack stack--tight">
        <div className="search-label">Save to wardrobe as</div>
        <div className="row">
          <button type="submit" className="btn btn--primary btn--grow">
            I own it
          </button>
          <a className="btn btn--outline-strong btn--grow" href={link("check", candidate.id)}>
            Planning to buy
          </a>
        </div>
      </div>
    </form>
  );
}
