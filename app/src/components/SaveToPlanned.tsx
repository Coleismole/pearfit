// The "Save to Planning to buy" control on the analysis and compare screens.
import type { PlannedItem } from "../lib/types.ts";
import { link } from "../lib/router.ts";
import { useStore } from "../store.tsx";
import { CheckIcon } from "./Icons.tsx";

// `item` is what gets saved when the button is pressed.
export function SaveToPlanned({ item }: { item: PlannedItem }) {
  const { planned, savePlannedItem, removePlannedItem } = useStore();
  const saved = planned.some((p) => p.candidateId === item.candidateId);
  if (!saved) {
    return (
      <button type="button" className="btn btn--primary" onClick={() => savePlannedItem(item)}>
        Save to Planning to buy
      </button>
    );
  }
  return (
    <div className="stack">
      <div className="tip row" role="status">
        <CheckIcon />
        Saved to Planning to buy
      </div>
      <div className="row">
        <a className="btn btn--outline btn--grow" href={link("wardrobe", "planned")}>
          View the list
        </a>
        <button type="button" className="btn btn--outline btn--grow" onClick={() => removePlannedItem(item.candidateId)}>
          Remove
        </button>
      </div>
    </div>
  );
}
