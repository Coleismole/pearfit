// The three measurements of one shirt, as a list.
import { DIM_LABELS, formatCm } from "../lib/format.ts";
import { DIMS } from "../lib/types.ts";
import type { Measurements } from "../lib/types.ts";

export function MeasurementList({ measurements }: { measurements: Measurements }) {
  return (
    <dl className="card card--flush rows">
      {DIMS.map((dim) => (
        <div key={dim}>
          <dt>{DIM_LABELS[dim]}</dt>
          <dd>{formatCm(measurements[dim])}</dd>
        </div>
      ))}
    </dl>
  );
}
