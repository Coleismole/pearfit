// The app's own data: the wardrobe, the "planning to buy" list and whether the welcome screen was seen.
// It lives in React state and is saved on the device (src/lib/storage.ts). Nothing here calls the API.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { STORAGE_KEYS, loadOnboarded, loadPlanned, loadWardrobe, saveOnboarded, savePlanned, saveWardrobe } from "./lib/storage.ts";
import type { KeyValueStore } from "./lib/storage.ts";
import type { OwnedShirt, PlannedItem } from "./lib/types.ts";

interface Store {
  wardrobe: OwnedShirt[];
  planned: PlannedItem[];
  onboarded: boolean;
  // Adds a shirt, or replaces the one whose id is `replacesId` (the id itself may change when it is renamed).
  saveShirt(shirt: OwnedShirt, replacesId?: string): void;
  removeShirt(id: string): void;
  replaceWardrobe(wardrobe: OwnedShirt[]): void;
  // Adds a planned shirt, or replaces the one already saved for the same candidate.
  savePlannedItem(item: PlannedItem): void;
  // Rebuilds the planned shirt of this candidate from its saved copy. Does nothing when it is not saved.
  refreshPlannedItem(candidateId: string, build: (previous: PlannedItem) => PlannedItem): void;
  removePlannedItem(candidateId: string): void;
  finishOnboarding(): void;
  resetAll(): void;
}

const StoreContext = createContext<Store | null>(null);

// Reading window.localStorage can itself throw when storage is blocked.
function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const storage = useMemo(browserStorage, []);
  const [wardrobe, setWardrobe] = useState(() => loadWardrobe(storage));
  const [planned, setPlanned] = useState(() => loadPlanned(storage));
  const [onboarded, setOnboarded] = useState(() => loadOnboarded(storage));

  useEffect(() => {
    saveWardrobe(storage, wardrobe);
  }, [storage, wardrobe]);
  useEffect(() => {
    savePlanned(storage, planned);
  }, [storage, planned]);
  useEffect(() => {
    saveOnboarded(storage, onboarded);
  }, [storage, onboarded]);

  // Another tab changed the saved data: pick it up, so the two tabs do not overwrite each other.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEYS.wardrobe) setWardrobe(loadWardrobe(storage));
      if (e.key === STORAGE_KEYS.planned) setPlanned(loadPlanned(storage));
      if (e.key === STORAGE_KEYS.onboarded) setOnboarded(loadOnboarded(storage));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage]);

  // The actions only call the state setters, so they are created once and never change.
  const actions = useMemo(
    () => ({
      saveShirt(shirt: OwnedShirt, replacesId?: string) {
        setWardrobe((list) =>
          replacesId !== undefined && list.some((s) => s.id === replacesId)
            ? list.map((s) => (s.id === replacesId ? shirt : s))
            : [...list, shirt],
        );
      },
      removeShirt(id: string) {
        setWardrobe((list) => list.filter((s) => s.id !== id));
      },
      replaceWardrobe(next: OwnedShirt[]) {
        setWardrobe(next);
      },
      savePlannedItem(item: PlannedItem) {
        setPlanned((list) =>
          list.some((p) => p.candidateId === item.candidateId)
            ? list.map((p) => (p.candidateId === item.candidateId ? item : p))
            : [...list, item],
        );
      },
      refreshPlannedItem(candidateId: string, build: (previous: PlannedItem) => PlannedItem) {
        setPlanned((list) =>
          list.some((p) => p.candidateId === candidateId) ? list.map((p) => (p.candidateId === candidateId ? build(p) : p)) : list,
        );
      },
      removePlannedItem(candidateId: string) {
        setPlanned((list) => list.filter((p) => p.candidateId !== candidateId));
      },
      finishOnboarding() {
        setOnboarded(true);
      },
      resetAll() {
        setWardrobe([]);
        setPlanned([]);
        setOnboarded(false);
      },
    }),
    [],
  );

  const store = useMemo<Store>(() => ({ wardrobe, planned, onboarded, ...actions }), [wardrobe, planned, onboarded, actions]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}
