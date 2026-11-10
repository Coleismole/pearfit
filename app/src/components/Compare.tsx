// The pieces of a compare screen: the two cards at the top and the table of measurements.
import type { ReactNode } from "react";
import { compareRows, diffText } from "../lib/compare.ts";
import { DIM_LABELS, formatCm } from "../lib/format.ts";
import type { Measurements } from "../lib/types.ts";
import { Thumb } from "./Thumb.tsx";

export function CompareCard({ first, tag, seed, name, detail }: { first?: boolean; tag: string; seed: string; name: string; detail: ReactNode }) {
  return (
    <div className={first ? "compare-card compare-card--first" : "compare-card"}>
      <div className="compare-card__tag">{tag}</div>
      <Thumb seed={seed} variant="compare" />
      <div className="compare-card__name">{name}</div>
      <div className="tiny muted">{detail}</div>
    </div>
  );
}

interface TableProps {
  first: Measurements; // shown in the first column
  second: Measurements;
  headers: [string, string, string]; // column titles: first, second, difference
  words?: boolean; // write "looser" / "shorter" after the difference
}

// The difference is always first minus second. A measurement missing on either side is shown as "—" and gets no
// number: it is never counted as 0.
export function CompareTable({ first, second, headers, words }: TableProps) {
  const rows = compareRows(second, first);
  return (
    <div className="card card--flush">
      <div className="compare__head" aria-hidden="true">
        <span>{headers[0]}</span>
        <span>{headers[1]}</span>
        <span className="right">{headers[2]}</span>
      </div>
      {rows.map((row) => (
        <div className="compare__row" key={row.dim}>
          <div className="small muted">{DIM_LABELS[row.dim]}</div>
          <div className="compare__values">
            <div className="compare__first">
              <span className="sr-only">{headers[0]}: </span>
              {formatCm(row.b)}
            </div>
            <div className="compare__second">
              <span className="sr-only">{headers[1]}: </span>
              {formatCm(row.a)}
            </div>
            <div className="compare__diff">
              <span className={row.diff === null ? "diff-chip diff-chip--none" : "diff-chip"}>
                <span className="sr-only">{headers[2]}: </span>
                {diffText(row, words)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
