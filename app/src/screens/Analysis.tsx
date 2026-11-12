// Screen 6 of the design: the suitability analysis of one catalog shirt. This is where POST /api/recommend is
// shown: the suggested size, how close it is, which owned shirt it fits like, and the reasons.
import { useEffect } from "react";
import { useCatalog } from "../catalog.tsx";
import { ApiErrorPanel, Loading, Notice } from "../components/Messages.tsx";
import { SaveToPlanned } from "../components/SaveToPlanned.tsx";
import { SubScreen } from "../components/Screen.tsx";
import { Thumb } from "../components/Thumb.tsx";
import { CONFIDENCE_NAMES, GARMENT_NAMES, NOT_MEASURED, countOf, formatPercent } from "../lib/format.ts";
import { ownedEntry, plannedFrom } from "../lib/items.ts";
import { link } from "../lib/router.ts";
import { DIMS } from "../lib/types.ts";
import type { PickerCandidate, RecommendResponse, ReviewSummary } from "../lib/types.ts";
import { round1 } from "../lib/units.ts";
import { displayName } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";
import { useRecommendation } from "../useRecommendation.ts";

export function Analysis({ candidateId }: { candidateId: string }) {
  const { state, reload } = useRecommendation(candidateId);
  const catalog = useCatalog();
  const { planned, refreshPlannedItem } = useStore();
  const candidate = catalog.find(candidateId);
  const saved = planned.find((p) => p.candidateId === candidateId);
  const name = candidate?.name ?? saved?.name ?? candidateId;
  const result = state.status === "ready" ? state.result : null;
  const garmentType = result?.garmentType ?? candidate?.garmentType ?? saved?.garmentType;

  // A shirt that is already saved keeps the newest answer.
  useEffect(() => {
    if (result) refreshPlannedItem(candidateId, (previous) => plannedFrom({ candidateId, name, result, candidate, previous, now: new Date() }));
    // Runs when a new answer or the catalog arrives. refreshPlannedItem itself never changes.
  }, [result, candidate, candidateId, name, refreshPlannedItem]);

  return (
    <SubScreen title="Suitability analysis" back={link()} backLabel="Back to home">
      <div className="row row--wide">
        <Thumb seed={candidateId} variant="head" />
        <div className="stack stack--tight min0">
          <div className="heading heading--product">{name}</div>
          <div className="small muted">
            {garmentType ? `${GARMENT_NAMES[garmentType].one} · ` : ""}SKU {candidateId}
          </div>
          <div className="small muted">From the Pearfit catalog</div>
        </div>
      </div>

      {state.status === "no-wardrobe" && (
        <Notice title="Add a shirt you own first">
          <p className="notice__text">Pearfit sizes a new shirt by comparing it with shirts you already own. Your wardrobe is empty.</p>
          <a className="btn btn--primary btn--small" href={link("add")}>
            Add a shirt
          </a>
        </Notice>
      )}

      {state.status === "loading" && <Loading>Checking this shirt against your wardrobe…</Loading>}

      {state.status === "error" && <ApiErrorPanel title="Couldn't check this shirt" error={state.error} onRetry={reload} />}

      {result && result.size !== null && <Sized candidateId={candidateId} candidate={candidate} result={result} size={result.size} />}

      {/* No size is an answer, not a failure: the verdict says why, and it is shown as a message. */}
      {result && result.size === null && (
        <Notice title="No size to suggest yet">
          <p className="notice__text">{result.verdict}</p>
          {result.notes.length > 0 && (
            <ul className="notes">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <a className="btn btn--outline btn--small" href={link("add")}>
            Add a shirt to your wardrobe
          </a>
        </Notice>
      )}

      {result?.reviews && <Reviews reviews={result.reviews} />}

      {candidate && <SizeChart candidate={candidate} suggested={result?.size ?? null} />}

      {result && (
        <>
          <div className="spacer" />
          <SaveToPlanned item={plannedFrom({ candidateId, name, result, candidate, previous: saved, now: new Date() })} />
        </>
      )}
    </SubScreen>
  );
}

// How many owned shirts the "Most similar in your wardrobe" list shows.
const SIMILAR_SHOWN = 3;

function Sized({ candidateId, candidate, result, size }: { candidateId: string; candidate: PickerCandidate | undefined; result: RecommendResponse; size: string }) {
  const { wardrobe } = useStore();
  // The API ranks the great shirts against the suggested size. An answer saved before it did has only fitsLike.
  const ranked =
    result.similar.length > 0
      ? result.similar
      : result.fitsLike !== null && result.matchPercent !== null
        ? [{ shirtId: result.fitsLike, matchPercent: result.matchPercent }]
        : [];
  const similar = ranked.slice(0, SIMILAR_SHOWN);
  // Every size with the owned shirt it is closest to. A size the API could not compare is left out.
  const bySize = result.sizes.flatMap((s) => (s.fitsLike !== null && s.matchPercent !== null ? [{ ...s, fitsLike: s.fitsLike, matchPercent: s.matchPercent }] : []));
  const matchName = result.fitsLike === null ? null : displayName(result.fitsLike);
  const percent = Math.max(0, Math.min(100, result.matchPercent ?? 0));

  return (
    <>
      <div className="card card--dark stack stack--wide">
        <div className="score__head">
          <div className="stack stack--tight">
            <div className="score__label">Suitability in size {size}</div>
            <div className="score__value">{formatPercent(result.matchPercent)}</div>
          </div>
          <div className="score__confidence">{CONFIDENCE_NAMES[result.confidence]}</div>
        </div>
        <div className="score__track" aria-hidden="true">
          <div className="score__fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="score__verdict">{result.verdict}</p>
        {candidate && (
          <div className="stack stack--tight">
            <div className="score__label">Sizes · we suggest {size}</div>
            <div className="sizes">
              {Object.keys(candidate.sizes).map((s) => {
                // The match of each size comes from the API. A size it did not score shows no number.
                const percent = result.sizes.find((entry) => entry.size === s)?.matchPercent ?? null;
                const said = percent === null ? "" : `, ${formatPercent(percent)} match`;
                return (
                  <a
                    key={s}
                    className={s === size ? "size size--suggested size--scored" : "size size--scored"}
                    href={link("check", candidateId, "compare", { size: s })}
                    aria-label={s === size ? `Compare size ${s}, the suggested size${said}` : `Compare size ${s}${said}`}
                  >
                    <span>{s}</span>
                    {percent !== null && <span className="size__percent">{formatPercent(percent)}</span>}
                  </a>
                );
              })}
            </div>
            {matchName && <div className="tiny score__label">Tap a size to compare it with your {matchName}.</div>}
          </div>
        )}
      </div>

      {result.notes.length > 0 && (
        <section className="stack stack--tight" aria-labelledby="notes-heading">
          <h2 className="heading" id="notes-heading">
            Good to know
          </h2>
          <ul className="card notes notes--card">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {bySize.length > 1 && (
        <section className="stack stack--tight" aria-labelledby="sizes-heading">
          <h2 className="heading" id="sizes-heading">
            Each size next to your wardrobe
          </h2>
          <div className="card card--flush">
          <ul className="plain-list">
            {bySize.map(({ size: s, matchPercent, fitsLike }) => (
              <li key={s}>
                <a
                  className={s === size ? "size-row size-row--suggested" : "size-row"}
                  href={candidate ? link("check", candidateId, "compare", { size: s, with: fitsLike }) : link("owned", fitsLike)}
                >
                  <span className="size-row__size">{s}</span>
                  <span className="size-row__text">
                    Closest to your {displayName(fitsLike)}
                    {s === size && <span className="sr-only"> (suggested size)</span>}
                  </span>
                  <span className="size-row__percent">{formatPercent(matchPercent)}</span>
                </a>
              </li>
            ))}
          </ul>
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section className="stack" aria-labelledby="match-heading">
          <div className="row row--between row--baseline row--wrap">
            <h2 className="heading" id="match-heading">
              Most similar in your wardrobe
            </h2>
            {candidate && <div className="small muted">Tap to compare</div>}
          </div>
          <ol className="stack stack--tight plain-list">
            {similar.map(({ shirtId, matchPercent }, i) => {
              const owned = wardrobe.find((s) => s.id === shirtId);
              return (
                <li key={shirtId}>
                  <a
                    className={i === 0 ? "list-row list-row--selected" : "list-row"}
                    href={candidate ? link("check", candidateId, "compare", { with: shirtId }) : link("owned", shirtId)}
                  >
                    <Thumb seed={shirtId} variant="match" />
                    <span className="list-row__text">
                      <span className="list-row__name">{owned ? ownedEntry(owned).title : displayName(shirtId)}</span>
                      {owned && (
                        <span className="small muted">
                          {ownedEntry(owned).detail} · {ownedEntry(owned).badge}
                        </span>
                      )}
                    </span>
                    <span className="match-score">
                      <span className="match-score__value">{formatPercent(matchPercent)}</span>
                      <span className="match-score__label">match</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
          {result.similar.length > SIMILAR_SHOWN && (
            <p className="tiny muted">
              The closest {SIMILAR_SHOWN} of the {result.similar.length} shirts you marked as a great fit.
            </p>
          )}
        </section>
      )}
    </>
  );
}

// What reviewers said about the fit. The numbers are the catalog's, shown as they are.
function Reviews({ reviews }: { reviews: ReviewSummary }) {
  const rows = [
    { label: "Runs small", percent: reviews.runsSmallPct },
    { label: "True to size", percent: reviews.trueToSizePct },
    { label: "Runs large", percent: reviews.runsLargePct },
  ];
  return (
    <section className="stack stack--tight" aria-labelledby="reviews-heading">
      <h2 className="heading" id="reviews-heading">
        What reviewers say about the fit
      </h2>
      <div className="card stack">
        <dl className="review-bars">
          {rows.map(({ label, percent }) => (
            <div key={label} className="review-bars__row">
              <dt>{label}</dt>
              <dd>
                <span className="review-bars__track" aria-hidden="true">
                  <span className="review-bars__fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
                </span>
                <span className="review-bars__value">{formatPercent(percent)}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="tiny muted">From {countOf(reviews.total, "review", "reviews")} in the Pearfit catalog.</p>
      </div>
    </section>
  );
}

function SizeChart({ candidate, suggested }: { candidate: PickerCandidate; suggested: string | null }) {
  return (
    <section className="stack stack--tight" aria-labelledby="chart-heading">
      <h2 className="heading" id="chart-heading">
        Size chart
      </h2>
      <div className="card card--flush">
        <table className="chart">
          <thead>
            <tr>
              <th scope="col">Size</th>
              <th scope="col">Chest</th>
              <th scope="col">Length</th>
              <th scope="col">Sleeve</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(candidate.sizes).map(([size, row]) => (
              <tr key={size} className={size === suggested ? "chart__suggested" : undefined}>
                <th scope="row">
                  {size}
                  {size === suggested && <span className="sr-only"> (suggested)</span>}
                </th>
                {DIMS.map((dim) => (
                  <td key={dim}>{row[dim] === null ? NOT_MEASURED : round1(row[dim])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny muted">Centimetres, with the shirt laid flat. Chest is pit to pit. “{NOT_MEASURED}” means the catalog has no number.</p>
    </section>
  );
}
