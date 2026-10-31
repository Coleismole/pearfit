import React from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import {
  GARMENT_SIZES,
  GarmentSize,
  ProductFitReport,
  SizeSentimentSummary,
} from '../utils/fitAnalyzer';

interface Props {
  report: ProductFitReport;
  selectedSize: GarmentSize | 'ALL';
  onSelectSize: (size: GarmentSize | 'ALL') => void;
}

export const SizeSentimentMatrix: React.FC<Props> = ({
  report,
  selectedSize,
  onSelectSize,
}) => {
  const activeSizeSummary: SizeSentimentSummary | undefined =
    selectedSize !== 'ALL'
      ? report.sizeSummaries.find((s) => s.size === selectedSize)
      : undefined;

  const renderVerdictText = (summary: SizeSentimentSummary) => {
    if (summary.verdict === 'Runs Small' || summary.verdict === 'Slightly Small') {
      return (
        <span className="inline-flex items-center gap-1.5 font-medium text-amber-800">
          <ArrowDownRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{summary.verdict}</span>
        </span>
      );
    }
    if (summary.verdict === 'Runs Large' || summary.verdict === 'Slightly Large') {
      return (
        <span className="inline-flex items-center gap-1.5 font-medium text-blue-800">
          <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{summary.verdict}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{summary.verdict}</span>
      </span>
    );
  };

  return (
    <section
      id="size-matrix"
      aria-labelledby="size-matrix-heading"
      className="bg-white border border-stone-200 rounded-lg p-6"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-stone-200">
        <div>
          <h2
            id="size-matrix-heading"
            className="text-xl font-bold text-slate-900 tracking-tight"
          >
            Size-by-Size Fit Skew &amp; Sentiment Trend Matrix
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Compare whether each individual size runs small, true to size, or large, alongside post-wash shrinkage frequency and fabric opacity notes.
          </p>
        </div>

        {/* Interactive Size Filter Segmented Control */}
        <div
          role="group"
          aria-label="Filter by garment size"
          className="flex flex-wrap items-center gap-1 p-1 bg-stone-100 rounded-lg shrink-0"
        >
          <button
            type="button"
            onClick={() => onSelectSize('ALL')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedSize === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:text-slate-900 hover:bg-stone-200/70'
            }`}
          >
            All Sizes ({report.totalReviews})
          </button>
          {GARMENT_SIZES.map((sz) => {
            const count =
              report.sizeSummaries.find((s) => s.size === sz)?.reviewCount || 0;
            const isSelected = selectedSize === sz;
            return (
              <button
                key={sz}
                type="button"
                onClick={() => onSelectSize(sz)}
                aria-label={`Filter size ${sz}`}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  isSelected
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-stone-200/70'
                }`}
              >
                {sz} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Pattern Grading Alert Banner (unboxed hairline layout, no border-l-4) */}
      <div className="py-3.5 px-4 my-4 bg-stone-50 border border-stone-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-700">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
          <span className="font-medium text-slate-900">Pattern Grading Analysis:</span>
          <span>{report.sizingGradingAlert}</span>
        </div>
        <span className="font-mono text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
          Scale: -1.00 (Small) to +1.00 (Large)
        </span>
      </div>

      {/* High-density Size Matrix Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-stone-200 text-xs font-semibold text-slate-500">
              <th className="py-3 pr-4">Size</th>
              <th className="py-3 px-3 text-right">Reviews</th>
              <th className="py-3 px-3">Fit Verdict</th>
              <th className="py-3 px-3 w-56">
                Small / True to Size / Large Split
              </th>
              <th className="py-3 px-3 text-right">Fit Index</th>
              <th className="py-3 px-3 text-right">Wash Shrinkage</th>
              <th className="py-3 px-3 text-right">Sentiment</th>
              <th className="py-3 pl-3">Size Trend, Tension &amp; Fabric Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 text-sm">
            {report.sizeSummaries.map((s) => {
              const isSelected = selectedSize === s.size;
              return (
                <tr
                  key={s.size}
                  onClick={() =>
                    onSelectSize(isSelected ? 'ALL' : s.size)
                  }
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-stone-100/90'
                      : 'hover:bg-stone-50'
                  }`}
                >
                  <td className="py-3.5 pr-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSize(isSelected ? 'ALL' : s.size);
                      }}
                      className="inline-flex items-center gap-1.5 text-left focus:outline-none"
                    >
                      <span className="underline-offset-4 hover:underline">
                        Size {s.size}
                      </span>
                      {isSelected && (
                        <Filter className="w-3 h-3 text-slate-700" aria-hidden="true" />
                      )}
                    </button>
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {s.reviewCount}
                  </td>
                  <td className="py-3.5 px-3 whitespace-nowrap">
                    {renderVerdictText(s)}
                  </td>
                  <td className="py-3.5 px-3">
                    {s.reviewCount > 0 ? (
                      <div>
                        <div className="h-2.5 w-full rounded-sm overflow-hidden flex bg-stone-200">
                          {s.runsSmallPct > 0 && (
                            <div
                              style={{ width: `${s.runsSmallPct}%` }}
                              className="bg-amber-600 h-full"
                              title={`Runs Small: ${s.runsSmallPct}%`}
                            />
                          )}
                          {s.trueToSizePct > 0 && (
                            <div
                              style={{ width: `${s.trueToSizePct}%` }}
                              className="bg-emerald-600 h-full"
                              title={`True to Size: ${s.trueToSizePct}%`}
                            />
                          )}
                          {s.runsLargePct > 0 && (
                            <div
                              style={{ width: `${s.runsLargePct}%` }}
                              className="bg-blue-600 h-full"
                              title={`Runs Large: ${s.runsLargePct}%`}
                            />
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                          <span>{s.runsSmallPct}% Sm</span>
                          <span>{s.trueToSizePct}% TTS</span>
                          <span>{s.runsLargePct}% Lg</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">No data</span>
                    )}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums font-medium text-slate-900">
                    {s.reviewCount > 0
                      ? s.fitSkew > 0
                        ? `+${s.fitSkew.toFixed(2)}`
                        : s.fitSkew.toFixed(2)
                      : '—'}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                    {s.reviewCount > 0 ? (
                      <span
                        className={
                          s.shrinkageMentionPct >= 40
                            ? 'text-amber-800 font-semibold'
                            : 'text-slate-700'
                        }
                      >
                        {s.shrinkageMentionPct}% ({s.shrinkageMentionCount})
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                    {s.reviewCount > 0 ? (
                      <span className="text-slate-900">
                        {s.sentimentScore}/100{' '}
                        <span className="text-slate-500 text-xs">
                          ({s.avgRating}★)
                        </span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3.5 pl-3 text-xs text-slate-700 max-w-md">
                    <div className="font-medium text-slate-900">
                      {s.primaryFitNote}
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      {s.fabricWeightNote}
                      {s.topKeywords.length > 0 && ` · ${s.topKeywords.slice(0, 2).join(' · ')}`}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Selected Size Deep-Dive Panel when a specific size is clicked */}
      {activeSizeSummary && (
        <div
          data-testid="selected-size-spotlight"
          className="mt-5 pt-5 border-t border-stone-200 grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-bold text-slate-900">
                Size {activeSizeSummary.size} Sentiment Synthesis ({activeSizeSummary.reviewCount} Scraped Reviews)
              </h3>
              <button
                type="button"
                onClick={() => onSelectSize('ALL')}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                Reset to All Sizes
              </button>
            </div>
            <p className="text-sm text-slate-700 mt-2 leading-relaxed">
              {activeSizeSummary.trendSummary}
            </p>
            {activeSizeSummary.sampleQuote && (
              <p className="text-xs text-slate-600 italic mt-3 pt-3 border-t border-stone-200">
                Representative Size {activeSizeSummary.size} Quote: &ldquo;{activeSizeSummary.sampleQuote}&rdquo;
              </p>
            )}
          </div>

          <div className="bg-stone-50 border border-stone-200 rounded-md p-4 flex flex-col justify-between">
            <div className="text-xs font-semibold text-slate-900">
              Size {activeSizeSummary.size} Breakdown &amp; Shrinkage
            </div>
            <div className="grid grid-cols-4 gap-2 my-3 font-mono tabular-nums">
              <div>
                <div className="text-[11px] text-slate-500">Small</div>
                <div className="text-base font-bold text-amber-700">
                  {activeSizeSummary.runsSmallPct}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">TTS</div>
                <div className="text-base font-bold text-emerald-700">
                  {activeSizeSummary.trueToSizePct}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Large</div>
                <div className="text-base font-bold text-blue-700">
                  {activeSizeSummary.runsLargePct}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Shrinkage</div>
                <div className="text-base font-bold text-slate-900">
                  {activeSizeSummary.shrinkageMentionPct}%
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-600 border-t border-stone-200 pt-2">
              {activeSizeSummary.fabricWeightNote} · Return Risk:{' '}
              <strong className="text-slate-900">{activeSizeSummary.returnRisk}</strong>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
