// Unit handling for the measurement boxes. Everything is stored in centimetres, rounded to 1 decimal.
// Inches are converted here, at input, and never anywhere else (AGENTS.md, "Data format").

export type Unit = "cm" | "in";
export const CM_PER_INCH = 2.54;
const MAX_CM = 150;

// Same rounding as the engine's round(): Math.round on the scaled value.
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function toCm(value: number, unit: Unit): number {
  return round1(unit === "in" ? value * CM_PER_INCH : value);
}

// For showing a stored value in the chosen unit. Inches keep 2 decimals so that switching back to cm gives the
// same number again.
export function fromCm(cm: number, unit: Unit): number {
  return unit === "in" ? Math.round((cm / CM_PER_INCH) * 100) / 100 : cm;
}

export type MeasurementInput = { ok: true; cm: number | null } | { ok: false; error: string };

// Reads what was typed in a measurement box. An empty box means "not measured" and gives null: it is never
// replaced with a guess. A comma is accepted as the decimal mark ("54,5").
export function parseMeasurementInput(text: string, unit: Unit): MeasurementInput {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, cm: null };
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return { ok: false, error: "Enter a number, or leave it empty." };
  const cm = toCm(Number(trimmed.replace(",", ".")), unit);
  // A value that rounds to 0.0 cm is not a measurement, and the API only accepts positive numbers.
  if (cm <= 0) return { ok: false, error: "Enter a number above 0, or leave it empty." };
  // Same limits as the website demo: above these it is a wrong number or a wrong unit.
  if (cm > MAX_CM) return { ok: false, error: `${cm} cm is more than a shirt can be. Check the number and the unit.` };
  return { ok: true, cm };
}
