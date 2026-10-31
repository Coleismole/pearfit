import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  FitDirection,
  GARMENT_SIZES,
  GarmentSize,
  ProductFitReport,
} from '../utils/fitAnalyzer';

interface Props {
  report: ProductFitReport;
  selectedSize: GarmentSize | 'ALL';
  onSelectSize: (size: GarmentSize | 'ALL') => void;
  selectedZoneFilter: string | null;
  onClearZoneFilter: () => void;
}

export const ReviewCorpusTable: React.FC<Props> = ({
  report,
  selectedSize,
  onSelectSize,
  selectedZoneFilter,
  onClearZoneFilter,
}) => {
  const [fitFilter, setFitFilter] = useState<FitDirection | 'ALL'>('ALL');
  const [signalFilter, setSignalFilter] = useState<
    'ALL' | 'SHRINKAGE' | 'OPACITY'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredReviews = report.reviews.filter((r) => {
    if (selectedSize !== 'ALL' && r.normalizedSize !== selectedSize) {
      return false;
    }
    if (fitFilter !== 'ALL' && r.fitDirection !== fitFilter) {
      return false;
    }
    if (signalFilter === 'SHRINKAGE' && !r.mentionsShrinkage) {
      return false;
    }
    if (signalFilter === 'OPACITY' && !r.mentionsFabricOpacity) {
      return false;
    }
    if (
      selectedZoneFilter &&
      !r.anatomicalMentions.some((m) => m.zone === selectedZoneFilter)
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText =
        r.body.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q) ||
        r.extractedPhrases.some((p) => p.toLowerCase().includes(q));
      if (!matchText) return false;
    }
    return true;
  });

  const formatFitDirectionLabel = (dir: FitDirection) => {
    if (dir === 'runs_small') return 'Runs Small';
    if (dir === 'runs_large') return 'Runs Large';
    return 'True to Size';
  };

  return (
    <section
      id="review-corpus"
      aria-labelledby="review-corpus-heading"
      className="bg-white border border-stone-200 rounded-lg p-6"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-stone-200">
        <div>
          <h2
            id="review-corpus-heading"
            className="text-xl font-bold text-slate-900 tracking-tight"
          >
            Scraped Customer Review Corpus ({filteredReviews.length} of {report.totalReviews})
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span>Source: {report.scraperTelemetry.sourceUrl}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {report.scraperTelemetry.domNodesScanned} DOM nodes scanned in {report.scraperTelemetry.parseDurationMs}ms
            </span>
          </div>
        </div>

        {/* Search & Fit Direction Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <label htmlFor="corpus-search-input" className="sr-only">
              Search scraped reviews
            </label>
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="corpus-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search fit keywords (e.g. gsm, shrunk)..."
              className="pl-8 pr-7 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 w-60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label="Filter reviews by fit direction"
            className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg"
          >
            {(
              [
                { id: 'ALL', label: 'All Fit Verdicts' },
                { id: 'runs_small', label: 'Runs Small' },
                { id: 'true_to_size', label: 'True to Size' },
                { id: 'runs_large', label: 'Runs Large' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFitFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  fitFilter === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Active filter bar if size, signal, or anatomical zone is filtered */}
      {(selectedSize !== 'ALL' ||
        selectedZoneFilter ||
        fitFilter !== 'ALL' ||
        signalFilter !== 'ALL' ||
        searchQuery) && (
        <div className="py-2.5 px-3 mt-4 bg-stone-50 border border-stone-200 rounded-md flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">Active Filters:</span>
            <span>Size: {selectedSize}</span>
            {selectedZoneFilter && (
              <>
                <span aria-hidden="true">·</span>
                <span>Anatomical Zone: {selectedZoneFilter}</span>
              </>
            )}
            {fitFilter !== 'ALL' && (
              <>
                <span aria-hidden="true">·</span>
                <span>Verdict: {formatFitDirectionLabel(fitFilter)}</span>
              </>
            )}
            {signalFilter !== 'ALL' && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Signal:{' '}
                  {signalFilter === 'SHRINKAGE'
                    ? 'Post-Wash Shrinkage'
                    : 'Fabric Weight & Opacity'}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              onSelectSize('ALL');
              setFitFilter('ALL');
              setSignalFilter('ALL');
              setSearchQuery('');
              onClearZoneFilter();
            }}
            className="text-xs font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700 whitespace-nowrap shrink-0"
          >
            Reset All Filters
          </button>
        </div>
      )}

      {/* Quick Size & T-Shirt Signal Filter Strip inside Corpus */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pb-3 border-b border-stone-200">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs text-slate-500 mr-1 whitespace-nowrap shrink-0">
            Size Purchased:
          </span>
          <button
            type="button"
            onClick={() => onSelectSize('ALL')}
            className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
              selectedSize === 'ALL'
                ? 'bg-slate-900 text-white font-semibold'
                : 'text-slate-600 hover:bg-stone-100'
            }`}
          >
            All
          </button>
          {GARMENT_SIZES.map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() => onSelectSize(sz)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                selectedSize === sz
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'text-slate-600 hover:bg-stone-100'
              }`}
            >
              {sz}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Filter by T-shirt wash and fabric signals"
          className="flex items-center gap-1 p-1 bg-stone-100 rounded-md"
        >
          <button
            type="button"
            onClick={() => setSignalFilter('ALL')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              signalFilter === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            All Signals
          </button>
          <button
            type="button"
            onClick={() =>
              setSignalFilter(signalFilter === 'SHRINKAGE' ? 'ALL' : 'SHRINKAGE')
            }
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              signalFilter === 'SHRINKAGE'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            Shrinkage Mentioned ({report.tshirtSignals.shrinkageReviewCount})
          </button>
          <button
            type="button"
            onClick={() =>
              setSignalFilter(signalFilter === 'OPACITY' ? 'ALL' : 'OPACITY')
            }
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              signalFilter === 'OPACITY'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            Fabric &amp; Opacity ({report.tshirtSignals.opaqueReviewCount + report.tshirtSignals.sheerReviewCount})
          </button>
        </div>
      </div>

      {/* Review List */}
      {filteredReviews.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-slate-900">
            No scraped reviews match the current filter combination.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Try resetting the size or signal filter to inspect all {report.totalReviews} extracted reviews.
          </p>
          <button
            type="button"
            onClick={() => {
              onSelectSize('ALL');
              setFitFilter('ALL');
              setSignalFilter('ALL');
              setSearchQuery('');
              onClearZoneFilter();
            }}
            className="mt-3 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
          >
            Show All {report.totalReviews} Reviews
          </button>
        </div>
      ) : (
        <div className="divide-y divide-stone-200">
          {filteredReviews.map((review) => (
            <article key={review.id} className="py-4 flex flex-col gap-1.5">
              {/* Unboxed clean metadata line (Zero-Pill Rule) */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-600">
                  <span className="font-mono font-bold text-slate-900">
                    Size {review.normalizedSize}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold ${
                      review.fitDirection === 'runs_small'
                        ? 'text-amber-800'
                        : review.fitDirection === 'runs_large'
                        ? 'text-blue-800'
                        : 'text-emerald-800'
                    }`}
                  >
                    {formatFitDirectionLabel(review.fitDirection)} (Skew{' '}
                    {review.fitSkew > 0 ? `+${review.fitSkew}` : review.fitSkew})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-700">
                    {review.rating}.0★
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    Sentiment {review.sentimentScore}/100
                  </span>
                  {review.mentionsShrinkage && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-amber-800">
                        Wash Shrinkage Noted
                      </span>
                    </>
                  )}
                  {review.mentionsFabricOpacity === 'thick_opaque' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-emerald-800">
                        Opaque Heavyweight
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px] tabular-nums">
                  <span>{review.author}</span>
                  {review.reviewerHeight && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{review.reviewerHeight}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{review.date}</span>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-slate-900">
                {review.title}
              </h3>

              <p className="text-sm text-slate-700 leading-relaxed">
                {review.body}
              </p>

              {/* Extracted Cues & Anatomical Tension Metadata (unboxed text with · separators) */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                <span className="font-medium text-slate-700">
                  Extracted Fit Signals:
                </span>
                <span>{review.extractedPhrases.join(' · ')}</span>
                {review.anatomicalMentions.length > 0 && (
                  <>
                    <span aria-hidden="true">/</span>
                    <span className="font-medium text-slate-700">Zones:</span>
                    <span>
                      {review.anatomicalMentions
                        .map((m) => `${m.zone} (${m.tension})`)
                        .join(' · ')}
                    </span>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
