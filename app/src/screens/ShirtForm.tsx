// Typing in a shirt you own by hand, and editing one that is already in the wardrobe.
import { useState } from "react";
import type { FormEvent } from "react";
import { ErrorPanel, Notice } from "../components/Messages.tsx";
import { SubScreen } from "../components/Screen.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { DIM_LABELS, GARMENT_NAMES } from "../lib/format.ts";
import { link } from "../lib/router.ts";
import { DIMS, GARMENT_TYPES } from "../lib/types.ts";
import type { Dim, FitLabel, GarmentType, Measurements, OwnedShirt } from "../lib/types.ts";
import { fromCm, parseMeasurementInput } from "../lib/units.ts";
import type { Unit } from "../lib/units.ts";
import { CIRCUMFERENCE_SUSPECT_CM, displayName, garmentTypeOf, hasAnyMeasurement, makeShirt, slugify } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";
import { go } from "../useRoute.ts";
import { FIT_OPTIONS } from "./AddShirt.tsx";

// How to take each measurement. The same definitions as engine/src/types.ts.
const DIM_HELP: Record<Dim, string> = {
  chest_cm: "Pit to pit, straight across, with the shirt laid flat. This is half of the full circumference.",
  length_cm: "From the highest point of the shoulder straight down to the bottom hem.",
  sleeve_cm: "From the shoulder seam to the end of the sleeve.",
};

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: "cm", label: "cm" },
  { value: "in", label: "inches" },
];

type Boxes = Record<Dim, string>;

function boxesFor(m: Measurements, unit: Unit): Boxes {
  const text = (dim: Dim) => (m[dim] === null ? "" : String(fromCm(m[dim], unit)));
  return { chest_cm: text("chest_cm"), length_cm: text("length_cm"), sleeve_cm: text("sleeve_cm") };
}

// `editId` is the shirt being edited. Without it the form adds a new shirt, of kind `startType` if given.
export function ShirtForm({ editId, startType }: { editId?: string; startType?: GarmentType }) {
  const { wardrobe } = useStore();
  const editing = editId === undefined ? undefined : wardrobe.find((s) => s.id === editId);

  if (editId !== undefined && !editing) {
    return (
      <SubScreen title="Edit shirt" back={link("wardrobe")} backLabel="Back to wardrobe">
        <Notice title="This shirt is not in your wardrobe">
          <p className="notice__text">Nothing in your wardrobe has the id “{editId}”.</p>
        </Notice>
      </SubScreen>
    );
  }
  return editing ? (
    <SubScreen title="Edit shirt" back={link("owned", editing.id)} backLabel="Back to the shirt">
      <Form editing={editing} />
    </SubScreen>
  ) : (
    <SubScreen title="Add a shirt" back={link("add")} backLabel="Back to add to wardrobe">
      <Form startType={startType} />
    </SubScreen>
  );
}

function Form({ editing, startType }: { editing?: OwnedShirt; startType?: GarmentType }) {
  const { wardrobe, saveShirt } = useStore();
  const [name, setName] = useState(editing ? displayName(editing.id) : "");
  const [type, setType] = useState<GarmentType>(editing ? garmentTypeOf(editing) : (startType ?? "tee"));
  const [label, setLabel] = useState<FitLabel | null>(editing?.label ?? null);
  const [unit, setUnit] = useState<Unit>("cm");
  const [boxes, setBoxes] = useState<Boxes>(() =>
    editing ? boxesFor(editing.measurements, "cm") : { chest_cm: "", length_cm: "", sleeve_cm: "" },
  );
  const [brand, setBrand] = useState(editing?.brand ?? "");
  const [size, setSize] = useState(editing?.size ?? "");
  const [tried, setTried] = useState(false);

  const id = slugify(name);
  const parsed = {
    chest_cm: parseMeasurementInput(boxes.chest_cm, unit),
    length_cm: parseMeasurementInput(boxes.length_cm, unit),
    sleeve_cm: parseMeasurementInput(boxes.sleeve_cm, unit),
  };
  const allParsed = DIMS.every((dim) => parsed[dim].ok);
  const measurements: Measurements = {
    chest_cm: parsed.chest_cm.ok ? parsed.chest_cm.cm : null,
    length_cm: parsed.length_cm.ok ? parsed.length_cm.cm : null,
    sleeve_cm: parsed.sleeve_cm.ok ? parsed.sleeve_cm.cm : null,
  };

  const nameError =
    id === ""
      ? "Use at least one letter or number in the name."
      : wardrobe.some((s) => s.id === id && s.id !== editing?.id)
        ? "You already have a shirt with this name."
        : null;
  const labelError = label === null ? "Choose how it fits you." : null;
  const noneError = allParsed && !hasAnyMeasurement(measurements) ? "Enter at least one measurement. Chest width is the one Pearfit relies on most." : null;
  const valid = nameError === null && labelError === null && allParsed && noneError === null;

  // The engine only warns about this, so the form does too: it does not block saving.
  const chest = measurements.chest_cm;
  const chestWarning =
    chest !== null && chest > CIRCUMFERENCE_SUSPECT_CM
      ? `${chest} cm looks like the full circumference. Pearfit needs the width laid flat, which is half of that.`
      : null;

  // Switching the unit converts what is already typed, so 54 cm becomes 21.26 in rather than 54 in.
  function changeUnit(next: Unit) {
    if (next === unit) return;
    setBoxes(boxesFor(measurements, next));
    setUnit(next);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!valid || label === null) return;
    saveShirt(makeShirt({ id, label, garmentType: type, measurements, brand, size, sku: editing?.sku }), editing?.id);
    go(editing ? link("owned", id) : link("wardrobe"));
  }

  return (
    <form className="stack stack--loose" onSubmit={onSubmit} noValidate>
      {tried && !valid && <ErrorPanel title="Some things need fixing">Check the fields marked below, then save again.</ErrorPanel>}

      <div className="field">
        <label className="field__label" htmlFor="shirt-name">
          Name
        </label>
        <input
          id="shirt-name"
          className="input"
          type="text"
          autoComplete="off"
          placeholder="e.g. Blue Uniqlo oxford"
          value={name}
          aria-invalid={tried && nameError !== null}
          onChange={(e) => setName(e.target.value)}
        />
        {tried && nameError ? (
          <div className="field__error">{nameError}</div>
        ) : (
          <div className="field__hint">{id === "" ? "Pearfit uses this name when it says what a new shirt fits like." : `Saved as ${id}`}</div>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="shirt-type">
          Kind of shirt
        </label>
        <select id="shirt-type" className="input" value={type} onChange={(e) => setType(e.target.value as GarmentType)}>
          {GARMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {GARMENT_NAMES[t].one}
            </option>
          ))}
        </select>
        <div className="field__hint">A new shirt is only compared with shirts of the same kind.</div>
      </div>

      <div className="field">
        <div className="field__label">How does it fit you?</div>
        <Segmented label="How does it fit you?" options={FIT_OPTIONS} value={label} onChange={(value) => setLabel(value)} />
        {tried && labelError && <div className="field__error">{labelError}</div>}
      </div>

      <div className="card card--roomy stack stack--loose">
        <div className="row row--between">
          <div className="field__label">Measurements</div>
          <div className="unit-switch">
            <Segmented label="Unit" options={UNIT_OPTIONS} value={unit} onChange={changeUnit} small />
          </div>
        </div>
        <div className="field__hint">Lay the shirt flat. Leave a box empty if you have not measured it: Pearfit never guesses a number.</div>

        {DIMS.map((dim) => {
          const result = parsed[dim];
          return (
            <div className="field" key={dim}>
              <label className="field__label field__label--small" htmlFor={`shirt-${dim}`}>
                {DIM_LABELS[dim]}
              </label>
              <div className="input-unit">
                <input
                  id={`shirt-${dim}`}
                  className="input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={boxes[dim]}
                  aria-invalid={!result.ok}
                  aria-describedby={`shirt-${dim}-help`}
                  onChange={(e) => setBoxes({ ...boxes, [dim]: e.target.value })}
                />
                <span className="input-unit__unit">{unit}</span>
              </div>
              {!result.ok && <div className="field__error">{result.error}</div>}
              {dim === "chest_cm" && chestWarning && <div className="field__error">{chestWarning}</div>}
              <div className="field__hint" id={`shirt-${dim}-help`}>
                {DIM_HELP[dim]}
              </div>
            </div>
          );
        })}
        {tried && noneError && <div className="field__error">{noneError}</div>}
        {unit === "in" && <div className="field__hint">Inches are saved as centimetres (× 2.54, rounded to 1 decimal).</div>}
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="field__label field__label--small" htmlFor="shirt-brand">
            Brand (optional)
          </label>
          <input id="shirt-brand" className="input" type="text" autoComplete="off" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label field__label--small" htmlFor="shirt-size">
            Size (optional)
          </label>
          <input id="shirt-size" className="input" type="text" autoComplete="off" value={size} onChange={(e) => setSize(e.target.value)} />
        </div>
      </div>

      <button type="submit" className="btn btn--primary">
        {editing ? "Save changes" : "Save to wardrobe"}
      </button>
    </form>
  );
}
