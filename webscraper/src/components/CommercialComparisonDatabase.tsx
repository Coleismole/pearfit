import React, { useState } from 'react';
import {
  Database,
  Download,
  FileCode2,
  Table2,
  Trash2,
  Check,
  ArrowUpDown,
} from 'lucide-react';
import {
  GARMENT_SIZES,
  generateSqlInsertDump,
  ProductFitReport,
} from '../utils/fitAnalyzer';

interface Props {
  catalog: ProductFitReport[];
  activeProductId: string;
  onSelectProduct: (id: string) => void;
  onDeleteSku: (sku: string) => void;
  dbStats: {
    skuCount: number;
    sizeMetricRows: number;
    reviewRows: number;
  };
}

export const CommercialComparisonDatabase: React.FC<Props> = ({
  catalog,
  activeProductId,
  onSelectProduct,
  onDeleteSku,
  dbStats,
}) => {
  const [activeTab, setActiveTab] = useState<'comparison' | 'sqldump'>(
    'comparison'
  );
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<
    'ingested' | 'fitIndex' | 'gradingDelta' | 'shrinkage' | 'reviews'
  >('ingested');
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);

  const categories = ['ALL', ...Array.from(new Set(catalog.map((c) => c.category)))];

  const filteredCatalog = catalog
    .filter((item) =>
      categoryFilter === 'ALL' ? true : item.category === categoryFilter
    )
    .sort((a, b) => {
      if (sortBy === 'ingested') return 0;
      if (sortBy === 'fitIndex') return a.overallFitIndex - b.overallFitIndex;
      if (sortBy === 'gradingDelta') return a.gradingDelta - b.gradingDelta;
      if (sortBy === 'shrinkage')
        return (
          b.tshirtSignals.overallShrinkagePct -
          a.tshirtSignals.overallShrinkagePct
        );
      return b.totalReviews - a.totalReviews;
    });

  const sqlDumpText = generateSqlInsertDump(filteredCatalog);

  const handleDownloadComparisonCsv = () => {
    const headers = [
      'SKU',
      'Brand',
      'GarmentName',
      'Category',
      'Price',
      'TotalReviews',
      'OverallFitIndex',
      'OverallVerdict',
      'GradingDelta_L_XXL_vs_XS_M',
      'XS_FitSkew',
      'S_FitSkew',
      'M_FitSkew',
      'L_FitSkew',
      'XL_FitSkew',
      'XXL_FitSkew',
      'RunsSmallPct',
      'TrueToSizePct',
      'RunsLargePct',
      'WashShrinkagePct',
      'FabricOpacityPct',
      'SentimentScore',
      'AvgRating',
    ];

    const rows = filteredCatalog.map((r) => {
      const getSkew = (sz: string) =>
        r.sizeSummaries.find((s) => s.size === sz)?.fitSkew ?? 0;
      return [
        r.sku,
        `"${r.brand.replace(/"/g, '""')}"`,
        `"${r.name.replace(/"/g, '""')}"`,
        `"${r.category}"`,
        r.price,
        r.totalReviews,
        r.overallFitIndex,
        `"${r.overallVerdict}"`,
        r.gradingDelta,
        getSkew('XS'),
        getSkew('S'),
        getSkew('M'),
        getSkew('L'),
        getSkew('XL'),
        getSkew('XXL'),
        r.overallDistribution.runsSmallPct,
        r.overallDistribution.trueToSizePct,
        r.overallDistribution.runsLargePct,
        r.tshirtSignals.overallShrinkagePct,
        r.tshirtSignals.fabricOpacityPct,
        r.overallSentimentScore,
        r.overallAvgRating,
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'pearfit_scraper_commercial_sku_comparison.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setCopiedFeedback('CSV Exported');
    setTimeout(() => setCopiedFeedback(null), 2000);
  };

  const handleCopySqlDump = () => {
    navigator.clipboard?.writeText(sqlDumpText);
    setCopiedFeedback('Copied SQL to Clipboard');
    setTimeout(() => setCopiedFeedback(null), 2000);
  };

  const formatSkewCell = (skew: number, count: number) => {
    if (count === 0) return <span className="text-slate-300">—</span>;
    const formatted = skew > 0 ? `+${skew.toFixed(2)}` : skew.toFixed(2);
    const colorClass =
      skew <= -0.25
        ? 'text-amber-800 font-semibold'
        : skew >= 0.25
        ? 'text-blue-800 font-semibold'
        : 'text-emerald-800';
    return <span className={colorClass}>{formatted}</span>;
  };

  return (
    <section
      id="comparison-database"
      aria-labelledby="commercial-database-heading"
      className="bg-white border border-stone-200 rounded-lg p-6"
    >
      {/* Header & Relational Database Telemetry */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-stone-200">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500">
            <span className="font-semibold text-slate-900">
              SQLite Engine: commercial_fit.db
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{dbStats.skuCount} Ingested SKUs</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {dbStats.sizeMetricRows} Size Metric Rows
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {dbStats.reviewRows} Scraped Review Rows
            </span>
          </div>
          <h2
            id="commercial-database-heading"
            className="text-xl font-bold text-slate-900 tracking-tight mt-1"
          >
            Commercial Cross-SKU Fit Comparison Database &amp; SQL Dump
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Compare sizing skew across XS–XXL, pattern grading deltas, and wash shrinkage across competing apparel SKUs, or export relational database dumps.
          </p>
        </div>

        {/* Export & View Switcher Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/db/dump.sql"
            download="pearfit_scraper_commercial_db_dump.sql"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Dump .SQL</span>
          </a>
          <a
            href="/api/db/dump.json"
            download="pearfit_scraper_commercial_db_dump.json"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Dump .JSON</span>
          </a>
          <button
            type="button"
            onClick={handleDownloadComparisonCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {copiedFeedback === 'CSV Exported' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>CSV Exported</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Export Matrix .CSV</span>
              </>
            )}
          </button>

          <div
            role="group"
            aria-label="Database view mode"
            className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg"
          >
            <button
              type="button"
              onClick={() => setActiveTab('comparison')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'comparison'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Cross-SKU Matrix</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sqldump')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'sqldump'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>SQL Dump Inspector</span>
            </button>
          </div>
        </div>
      </div>

      {/* Category & Sort Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-stone-200 text-xs">
        <div
          role="group"
          aria-label="Filter database by apparel category"
          className="flex flex-wrap items-center gap-1"
        >
          <span className="text-slate-500 mr-1.5">Category Filter:</span>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === cat
                  ? 'bg-slate-900 text-white font-medium'
                  : 'text-slate-600 hover:bg-stone-100'
              }`}
            >
              {cat === 'ALL' ? `All SKUs (${catalog.length})` : cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          <label htmlFor="db-sort-select" className="text-slate-500">
            Sort By:
          </label>
          <select
            id="db-sort-select"
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as
                  | 'ingested'
                  | 'fitIndex'
                  | 'gradingDelta'
                  | 'shrinkage'
                  | 'reviews'
              )
            }
            className="px-2.5 py-1 bg-stone-50 border border-stone-200 rounded text-slate-900 font-medium"
          >
            <option value="ingested">Database Commit Order (Newest First)</option>
            <option value="fitIndex">Overall Fit Index (Smallest to Largest)</option>
            <option value="gradingDelta">Pattern Grading Delta (L–XXL vs XS–M)</option>
            <option value="shrinkage">Post-Wash Shrinkage Rate (%)</option>
            <option value="reviews">Scraped Review Count</option>
          </select>
        </div>
      </div>

      {activeTab === 'comparison' ? (
        <div className="overflow-x-auto mt-2">
          <table
            data-testid="commercial-comparison-table"
            className="w-full text-left border-collapse text-xs"
          >
            <thead>
              <tr className="border-b border-stone-200 font-semibold text-slate-500">
                <th className="py-3 pr-3">SKU Code</th>
                <th className="py-3 px-3">Vendor &amp; Garment Title</th>
                <th className="py-3 px-2 text-right">Revs</th>
                <th className="py-3 px-3">Overall Fit</th>
                {GARMENT_SIZES.map((sz) => (
                  <th
                    key={sz}
                    className="py-3 px-2 text-right font-mono"
                    title={`Fit Skew Index for Size ${sz}`}
                  >
                    {sz}
                  </th>
                ))}
                <th
                  className="py-3 px-3 text-right"
                  title="Fit Skew difference between L-XXL and XS-M"
                >
                  Grading Delta
                </th>
                <th className="py-3 px-3 text-right">Shrinkage</th>
                <th className="py-3 px-3 text-right">Opacity</th>
                <th className="py-3 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 font-mono tabular-nums">
              {filteredCatalog.map((item) => {
                const isSelected = item.id === activeProductId;
                return (
                  <tr
                    key={item.sku}
                    onClick={() => onSelectProduct(item.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-stone-100/90' : 'hover:bg-stone-50'
                    }`}
                  >
                    <td className="py-3 pr-3 font-semibold text-slate-900 whitespace-nowrap">
                      {item.sku}
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <div className="font-semibold text-slate-900">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {item.brand} · {item.category} · {item.price}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right text-slate-700">
                      {item.totalReviews}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`font-sans font-semibold ${
                          item.overallFitIndex <= -0.18
                            ? 'text-amber-800'
                            : item.overallFitIndex >= 0.18
                            ? 'text-blue-800'
                            : 'text-emerald-800'
                        }`}
                      >
                        {item.overallVerdict}
                      </span>{' '}
                      <span className="text-slate-500">
                        (
                        {item.overallFitIndex > 0
                          ? `+${item.overallFitIndex.toFixed(2)}`
                          : item.overallFitIndex.toFixed(2)}
                        )
                      </span>
                    </td>
                    {GARMENT_SIZES.map((sz) => {
                      const sObj = item.sizeSummaries.find(
                        (s) => s.size === sz
                      );
                      return (
                        <td key={sz} className="py-3 px-2 text-right">
                          {formatSkewCell(
                            sObj?.fitSkew ?? 0,
                            sObj?.reviewCount ?? 0
                          )}
                        </td>
                      );
                    })}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <span
                        className={
                          Math.abs(item.gradingDelta) >= 0.22
                            ? 'text-amber-800 font-semibold'
                            : 'text-slate-600'
                        }
                      >
                        {item.gradingDelta > 0
                          ? `+${item.gradingDelta.toFixed(2)}`
                          : item.gradingDelta.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={
                          item.tshirtSignals.overallShrinkagePct >= 30
                            ? 'text-amber-800 font-semibold'
                            : 'text-slate-700'
                        }
                      >
                        {item.tshirtSignals.overallShrinkagePct}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-800 font-medium">
                      {item.tshirtSignals.fabricOpacityPct}%
                    </td>
                    <td className="py-3 pl-3 text-right whitespace-nowrap font-sans">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectProduct(item.id);
                          }}
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            isSelected
                              ? 'bg-slate-900 text-white'
                              : 'bg-stone-100 text-slate-700 hover:bg-stone-200'
                          }`}
                        >
                          {isSelected ? 'Inspecting' : 'Inspect'}
                        </button>
                        {catalog.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Delete SKU ${item.sku} from database`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSku(item.sku);
                            }}
                            className="p-1 text-slate-400 hover:text-red-700 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-700">
              Relational SQL DDL &amp; INSERT Dump (`commercial_skus` &amp; `sku_size_metrics`)
            </span>
            <button
              type="button"
              onClick={handleCopySqlDump}
              className="px-3 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 transition-colors"
            >
              {copiedFeedback === 'Copied SQL to Clipboard'
                ? 'Copied SQL!'
                : 'Copy SQL Statements'}
            </button>
          </div>
          <pre
            data-testid="sql-dump-preview"
            className="p-4 bg-slate-900 text-stone-100 rounded-md overflow-x-auto max-h-80 text-xs font-mono leading-relaxed"
          >
            {sqlDumpText}
          </pre>
        </div>
      )}
    </section>
  );
};
