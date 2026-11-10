// The catalog picker: a search box over the list from GET /api/candidates. Used on Home (check a shirt before
// buying) and on "Add to wardrobe" (find a shirt you own).
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useCatalog } from "../catalog.tsx";
import { GARMENT_NAMES, countOf, sizeRange } from "../lib/format.ts";
import { looksLikeLink, searchCandidates } from "../lib/search.ts";
import type { PickerCandidate } from "../lib/types.ts";
import { go } from "../useRoute.ts";
import { ChevronIcon, CloseIcon, SearchIcon } from "./Icons.tsx";
import { ApiErrorPanel, ErrorPanel, Loading } from "./Messages.tsx";

// More rows than this are not drawn: the person narrows the list by typing.
const MAX_ROWS = 30;

interface Props {
  label: string;
  hrefFor(candidate: PickerCandidate): string; // where a picked shirt leads
  browse?: boolean; // show the whole catalog before anything is typed
}

export function CatalogSearch({ label, hrefFor, browse = false }: Props) {
  const { state, reload } = useCatalog();
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(browse);
  const inputId = useId();

  const candidates = state.status === "ready" ? state.candidates : [];
  const matches = searchCandidates(candidates, query);
  const typed = query.trim() !== "";
  const showList = typed || browsing;

  // Enter (or the Search button) opens the shirt when exactly one is left. Otherwise it shows the list.
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (typed && matches.length === 1) go(hrefFor(matches[0]));
    else setBrowsing(true);
  }

  return (
    <div className="stack stack--loose">
      <label className="search-label" htmlFor={inputId}>
        {label}
      </label>
      <form className="search" role="search" onSubmit={onSubmit}>
        <div className="search__box">
          <SearchIcon />
          <input
            id={inputId}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Name, SKU or link"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== "" && (
            <button type="button" className="search__clear" aria-label="Clear search" onClick={() => setQuery("")}>
              <CloseIcon size={16} />
            </button>
          )}
        </div>
        <button type="submit" className="search__button">
          Search
        </button>
      </form>

      {state.status === "loading" && <Loading>Loading the catalog…</Loading>}

      {state.status === "error" && <ApiErrorPanel title="Couldn't load the catalog" error={state.error} onRetry={reload} />}

      {state.status === "ready" && !showList && (
        <div className="row row--between">
          <span className="small muted">{countOf(candidates.length, "shirt", "shirts")} in the catalog</span>
          {candidates.length > 0 && (
            <button type="button" className="btn btn--text" onClick={() => setBrowsing(true)}>
              Browse all
            </button>
          )}
        </div>
      )}

      {state.status === "ready" && showList && matches.length === 0 && <NoMatch query={query} empty={candidates.length === 0} />}

      {state.status === "ready" && showList && matches.length > 0 && (
        <>
          <ul className="result-list" aria-label="Shirts in the catalog">
            {matches.slice(0, MAX_ROWS).map((c) => (
              <li key={c.id}>
                <a className="result" href={hrefFor(c)}>
                  <span className="result__text">
                    <span className="result__name">{c.name}</span>
                    <span className="small muted">
                      {GARMENT_NAMES[c.garmentType].one} · {sizeRange(Object.keys(c.sizes))} · {c.id}
                    </span>
                  </span>
                  <span className="muted">
                    <ChevronIcon />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {matches.length > MAX_ROWS && (
            <p className="small muted">
              Showing {MAX_ROWS} of {matches.length}. Type more to narrow it down.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function NoMatch({ query, empty }: { query: string; empty: boolean }) {
  if (empty) return <p className="small muted">The catalog is empty right now.</p>;
  if (looksLikeLink(query)) {
    return (
      <div className="stack stack--loose">
        <ErrorPanel title="Couldn't match this link">
          Pearfit can't read product pages yet. A link only works when it contains the SKU of a shirt in the catalog.
        </ErrorPanel>
        <ul className="hints">
          <li className="hints__title">Try this:</li>
          <li>· Search by the product's name</li>
          <li>· Type the SKU from the tag or the product page</li>
        </ul>
      </div>
    );
  }
  return <p className="small muted">No shirt in the catalog matches “{query.trim()}”. Try fewer words, or the SKU from the tag.</p>;
}
