import React, { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Database,
  Layers,
  Check,
  RefreshCw,
} from 'lucide-react';
import { SEED_CATALOG } from './data/seedCatalog';
import {
  GarmentSize,
  ProductFitReport,
  generateSqlInsertDump,
} from './utils/fitAnalyzer';
import { ScraperWorkbenchBar } from './components/ScraperWorkbenchBar';
import { SizeSentimentMatrix } from './components/SizeSentimentMatrix';
import { GarmentBlueprintIllustration } from './components/GarmentBlueprintIllustration';
import { ReviewCorpusTable } from './components/ReviewCorpusTable';

export default function App() {
  const [catalog, setCatalog] = useState<ProductFitReport[]>(SEED_CATALOG);
  const [usingSamples, setUsingSamples] = useState(true);
  const [remoteSkus, setRemoteSkus] = useState<
    { sku: string; brand: string; name: string; overallVerdict: string; totalReviews: number; sizeCount: number }[]
  >([]);
  const [remoteNote, setRemoteNote] = useState<string | null>(null);
  const [activeProductId, setActiveProductId] = useState<string>(
    SEED_CATALOG[0].id
  );
  const [selectedSize, setSelectedSize] = useState<GarmentSize | 'ALL'>('ALL');
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string | null>(
    null
  );
  const [isCommittingActiveSku, setIsCommittingActiveSku] = useState(false);
  const [skuCommitMessage, setSkuCommitMessage] = useState<string | null>(null);

  const fetchDatabaseRecords = async (whenEmpty: 'samples' | 'keep' = 'samples') => {
    try {
      const response = await fetch('/api/db/records');
      if (!response.ok) return;
      const data = await response.json();
      const loadedReports: ProductFitReport[] = data.reports || data.records || [];
      if (Array.isArray(loadedReports) && loadedReports.length > 0) {
        setCatalog(loadedReports);
        setUsingSamples(false);
      } else if (whenEmpty === 'samples') {
        setCatalog(SEED_CATALOG);
        setUsingSamples(true);
      }
    } catch {
      // Keep the sample catalog if the local database cannot be read
    }
  };

  const fetchRemoteFitStore = async () => {
    try {
      const response = await fetch('/api/db/remote');
      if (!response.ok) return;
      const data = await response.json();
      if (data.ok) {
        setRemoteSkus(data.skus || []);
        setRemoteNote(null);
        return;
      }
      setRemoteSkus([]);
      setRemoteNote(data.error || data.reason || 'The shared fit store could not be read.');
    } catch {
      setRemoteNote('The shared fit store could not be read.');
    }
  };

  useEffect(() => {
    fetchDatabaseRecords();
    fetchRemoteFitStore();
  }, []);

  const activeReport =
    catalog.find((item) => item.id === activeProductId) || catalog[0];

  const handleSelectProduct = (productId: string) => {
    setActiveProductId(productId);
    setSelectedSize('ALL');
    setSelectedZoneFilter(null);
    setSkuCommitMessage(null);
  };

  const handleScrapedReportReady = (newReport: ProductFitReport) => {
    setUsingSamples(false);
    setCatalog((prev) => {
      const filtered = prev.filter((item) => item.sku !== newReport.sku);
      return [newReport, ...filtered];
    });
    setActiveProductId(newReport.id);
    setSelectedSize('ALL');
    setSelectedZoneFilter(null);
    fetchDatabaseRecords('keep');
    fetchRemoteFitStore();
  };

  const handleBatchCommitted = () => {
    fetchDatabaseRecords();
    fetchRemoteFitStore();
  };

  const handleDeleteSku = async (sku: string) => {
    try {
      const res = await fetch(`/api/db/sku/${encodeURIComponent(sku)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        const loadedReports: ProductFitReport[] = data.reports || data.records || [];
        if (Array.isArray(loadedReports) && loadedReports.length > 0) {
          setCatalog(loadedReports);
          setUsingSamples(false);
          if (activeReport.sku === sku) {
            setActiveProductId(loadedReports[0].id);
          }
        } else {
          setCatalog(SEED_CATALOG);
          setUsingSamples(true);
          setActiveProductId(SEED_CATALOG[0].id);
        }
        fetchRemoteFitStore();
      }
    } catch {
      // Ignore error
    }
  };

  const handleCommitActiveSkuToDb = async () => {
    setIsCommittingActiveSku(true);
    setSkuCommitMessage(null);
    try {
      const response = await fetch('/api/db/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: activeReport }),
      });
      if (response.ok) {
        const data = await response.json();
        const remote =
          data.supabase?.ok
            ? ' Fit values were sent to Supabase.'
            : data.supabase?.error
              ? ` Supabase was not updated: ${data.supabase.error}`
              : '';
        setSkuCommitMessage(
          `Committed SKU ${activeReport.sku} (1 SKU row, ${activeReport.sizeSummaries.length} size_metrics rows, ${activeReport.totalReviews} review rows) to commercial_fit.db.${remote}`
        );
        fetchRemoteFitStore();
      }
    } finally {
      setIsCommittingActiveSku(false);
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const renderOverallVerdictHeadline = (report: ProductFitReport) => {
    if (
      report.overallVerdict === 'Runs Small' ||
      report.overallVerdict === 'Slightly Small'
    ) {
      return (
        <span className="inline-flex items-center gap-2 text-amber-800">
          <ArrowDownRight className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>{report.overallVerdict}</span>
        </span>
      );
    }
    if (
      report.overallVerdict === 'Runs Large' ||
      report.overallVerdict === 'Slightly Large'
    ) {
      return (
        <span className="inline-flex items-center gap-2 text-blue-800">
          <ArrowUpRight className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>{report.overallVerdict}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 text-emerald-800">
        <CheckCircle2 className="w-6 h-6 shrink-0" aria-hidden="true" />
        <span>{report.overallVerdict}</span>
      </span>
    );
  };

  const activeSkuSqlSnippet = generateSqlInsertDump([activeReport]);

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200 px-6 py-3.5">
        <div className="max-w-[1360px] mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Pearfit Scraper
          </a>

          {/* Zone 2: 4 concise single-line text navigation links */}
          <nav
            aria-label="Primary workspace navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <a
              href="#scraper-workbench"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('scraper-workbench');
              }}
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Scraper Pipeline
            </a>
            <a
              href="#size-matrix"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('size-matrix');
              }}
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Size Matrix
            </a>
            <a
              href="#review-corpus"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('review-corpus');
              }}
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Review Corpus
            </a>
          </nav>

          {/* Zone 3: 1 primary action button */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                scrollToSection('scraper-workbench');
                const input = document.getElementById('target-url-input');
                if (input) input.focus();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Scrape &amp; Dump SKU</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container (1360px max width for 1440px desktop baseline) */}
      <main
        id="top"
        className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-8 space-y-8"
      >
        {/* Section 1: Web Scraper & Database Ingestion Pipeline */}
        <ScraperWorkbenchBar
          onScrapedReportReady={handleScrapedReportReady}
          onBatchCommitted={handleBatchCommitted}
        />

        <section
          aria-labelledby="shared-fit-store-heading"
          className="bg-white border border-stone-200 rounded-lg p-6"
        >
          <h2
            id="shared-fit-store-heading"
            className="text-lg font-bold text-slate-900 tracking-tight"
          >
            Shared fit store
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Fit numbers in Supabase. Review text is not in this list.
          </p>
          {remoteNote ? (
            <p className="text-sm text-amber-800 mt-3">{remoteNote}</p>
          ) : remoteSkus.length === 0 ? (
            <p className="text-sm text-slate-600 mt-3">No shared fit rows yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-stone-200">
              {remoteSkus.map((row) => {
                const onThisMachine =
                  !usingSamples && catalog.some((item) => item.sku === row.sku);
                return (
                  <li
                    key={row.sku}
                    className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                  >
                    <span className="font-mono text-xs">{row.sku}</span>
                    <span className="text-slate-800">{row.name}</span>
                    <span className="text-slate-500">{row.brand}</span>
                    <span className="text-slate-700">{row.overallVerdict}</span>
                    <span className="font-mono text-xs text-slate-500">
                      {row.totalReviews} reviews · {row.sizeCount} sizes
                    </span>
                    <span className="text-xs text-slate-500">
                      {onThisMachine ? 'Also in the local database' : 'Not in the local database'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {!usingSamples && remoteSkus.length > 0 && (
            <ul className="mt-3 text-xs text-slate-600">
              {catalog
                .filter((item) => !remoteSkus.some((row) => row.sku === item.sku))
                .map((item) => (
                  <li key={item.sku}>
                    <span className="font-mono">{item.sku}</span> is only on this machine.
                  </li>
                ))}
            </ul>
          )}
        </section>

        {/* Active SKU fit values. Comparison happens in the separate engine. */}
        <section
          aria-labelledby="active-garment-heading"
          className="bg-white border border-stone-200 rounded-lg p-6"
        >
          {/* Ingested SKU Switcher Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-stone-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Layers
                className="w-4 h-4 text-slate-600 shrink-0"
                aria-hidden="true"
              />
              <span>
                {usingSamples
                  ? `Sample products (${catalog.length}). These are not scrapes and are not in the local database.`
                  : `Active SKU Telemetry Inspector (${catalog.length} SKUs in the local database):`}
              </span>
            </div>

            <div
              role="group"
              aria-label="Select ingested SKU record"
              className="flex flex-wrap items-center gap-1.5"
            >
              {catalog.map((item) => {
                const isCurrent = item.id === activeReport.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectProduct(item.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      isCurrent
                        ? 'bg-slate-900 text-white'
                        : 'bg-stone-100 text-slate-700 hover:bg-stone-200 hover:text-slate-900'
                    }`}
                  >
                    {usingSamples && <span>Sample </span>}
                    <span className="font-mono">{item.sku}</span> ·{' '}
                    {item.name.split(' ').slice(0, 3).join(' ')} (
                    {item.overallVerdict})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Garment Header & Overall Fit Verdict */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-6 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-between">
              <div>
                {/* Clean unboxed metadata line */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-800">
                    {activeReport.brand}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeReport.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">SKU {activeReport.sku}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {activeReport.price}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-700">
                    Grading Delta:{' '}
                    {activeReport.gradingDelta > 0
                      ? `+${activeReport.gradingDelta.toFixed(2)}`
                      : activeReport.gradingDelta.toFixed(2)}
                  </span>
                </div>

                <h1
                  id="active-garment-heading"
                  style={{ textWrap: 'balance' }}
                  className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-2"
                >
                  {activeReport.name}
                </h1>

                <p className="text-xs text-slate-500 mt-1">
                  Mill &amp; Fabric Spec: {activeReport.fabricComposition}
                </p>

                <p className="text-sm text-slate-700 mt-4 leading-relaxed">
                  {activeReport.merchandisingTakeaway}
                </p>

                {/* T-Shirt Specific Signals: Shrinkage After Wash & Fabric Weight/Opacity */}
                <div
                  data-testid="tshirt-specific-signals"
                  className="mt-4 pt-3.5 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-700"
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      Shrinkage After Wash Frequency:{' '}
                      <span className="font-mono tabular-nums text-amber-800">
                        {activeReport.tshirtSignals.overallShrinkagePct}% (
                        {activeReport.tshirtSignals.shrinkageReviewCount} of{' '}
                        {activeReport.totalReviews} reviews)
                      </span>
                    </div>
                    <p className="text-slate-600 mt-0.5">
                      {activeReport.tshirtSignals.washCareAdvisory}
                    </p>
                  </div>

                  <div>
                    <div className="font-semibold text-slate-900">
                      Fabric Weight &amp; Transparency:{' '}
                      <span className="font-mono tabular-nums text-emerald-800">
                        {activeReport.tshirtSignals.fabricOpacityPct}% Opaque (
                        {activeReport.tshirtSignals.gsmSpec})
                      </span>
                    </div>
                    <p className="text-slate-600 mt-0.5">
                      {activeReport.tshirtSignals.fabricWeightConsensus}
                    </p>
                  </div>
                </div>
              </div>

              {/* 4-Column Key Fit Telemetry Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 mt-5 border-t border-stone-200 font-mono tabular-nums">
                <div>
                  <div className="text-xs font-sans text-slate-500">
                    Overall Fit Index
                  </div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {activeReport.overallFitIndex > 0
                      ? `+${activeReport.overallFitIndex.toFixed(2)}`
                      : activeReport.overallFitIndex.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-sans text-slate-500">
                    Ingested Reviews
                  </div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {activeReport.totalReviews}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-sans text-slate-500">
                    Sentiment Index
                  </div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {activeReport.overallSentimentScore}/100
                  </div>
                </div>
                <div>
                  <div className="text-xs font-sans text-slate-500">
                    Mean Star Rating
                  </div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {activeReport.overallAvgRating}★
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Aggregate Fit Distribution Gauge */}
            <div className="lg:col-span-5 bg-stone-50 border border-stone-200 rounded-lg p-5 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  Aggregate SKU Sizing Verdict
                </div>
                <div
                  data-testid="overall-fit-verdict"
                  className="text-2xl font-bold tracking-tight mt-1"
                >
                  {renderOverallVerdictHeadline(activeReport)}
                </div>
              </div>

              <div className="my-5 space-y-3 font-mono tabular-nums text-xs">
                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span className="font-sans font-medium">
                      Runs Small / Tight
                    </span>
                    <span className="font-semibold text-amber-800">
                      {activeReport.overallDistribution.runsSmallPct}% (
                      {activeReport.overallDistribution.runsSmallCount})
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-200 rounded-sm overflow-hidden">
                    <div
                      style={{
                        width: `${activeReport.overallDistribution.runsSmallPct}%`,
                      }}
                      className="h-full bg-amber-600"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span className="font-sans font-medium">
                      True to Size / Spec-Accurate
                    </span>
                    <span className="font-semibold text-emerald-800">
                      {activeReport.overallDistribution.trueToSizePct}% (
                      {activeReport.overallDistribution.trueToSizeCount})
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-200 rounded-sm overflow-hidden">
                    <div
                      style={{
                        width: `${activeReport.overallDistribution.trueToSizePct}%`,
                      }}
                      className="h-full bg-emerald-600"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span className="font-sans font-medium">
                      Runs Large / Oversized
                    </span>
                    <span className="font-semibold text-blue-800">
                      {activeReport.overallDistribution.runsLargePct}% (
                      {activeReport.overallDistribution.runsLargeCount})
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-200 rounded-sm overflow-hidden">
                    <div
                      style={{
                        width: `${activeReport.overallDistribution.runsLargePct}%`,
                      }}
                      className="h-full bg-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  Parser: {activeReport.scraperTelemetry.engineMode} (Zero-LLM)
                </span>
                <span>
                  Selectors:{' '}
                  {activeReport.scraperTelemetry.selectorsUsed
                    .slice(0, 2)
                    .join(', ')}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Size-by-Size Fit Skew & Sentiment Trend Matrix */}
        <SizeSentimentMatrix
          report={activeReport}
          selectedSize={selectedSize}
          onSelectSize={setSelectedSize}
        />

        {/* Section 5: Anatomical Fit Tension Breakdown & Relational SKU Record Inspector */}
        <section
          id="fit-anatomy"
          aria-labelledby="fit-anatomy-heading"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
        >
          <div className="lg:col-span-7 bg-white border border-stone-200 rounded-lg p-6 flex flex-col justify-between">
            <div className="pb-4 border-b border-stone-200">
              <h2
                id="fit-anatomy-heading"
                className="text-lg font-bold text-slate-900 tracking-tight"
              >
                Anatomical Pattern Block Tension Breakdown
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Deterministic keyword extraction across shoulders, chest, waist,
                hips, sleeves, and length. Click a zone to filter the raw review
                table below.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-4 items-center">
              <div className="md:col-span-5">
                <GarmentBlueprintIllustration
                  category={activeReport.category}
                  anatomicalBreakdown={activeReport.anatomicalBreakdown}
                  selectedZone={selectedZoneFilter}
                  onSelectZone={(z) => setSelectedZoneFilter(z)}
                />
              </div>

              <div className="md:col-span-7 divide-y divide-stone-200">
                {activeReport.anatomicalBreakdown.map((zone) => {
                  const isZoneSelected = selectedZoneFilter === zone.zone;
                  return (
                    <div
                      key={zone.zone}
                      onClick={() =>
                        setSelectedZoneFilter(isZoneSelected ? null : zone.zone)
                      }
                      className={`py-2.5 px-2 cursor-pointer rounded transition-colors ${
                        isZoneSelected ? 'bg-stone-100' : 'hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900">
                          {zone.label}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600">
                          {zone.statusLabel} ({zone.mentionCount} mentions)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-stone-200 rounded-sm overflow-hidden flex mt-1.5">
                        <div
                          style={{ width: `${zone.tightPct}%` }}
                          className="bg-amber-600 h-full"
                        />
                        <div
                          style={{ width: `${zone.optimalPct}%` }}
                          className="bg-emerald-600 h-full"
                        />
                        <div
                          style={{ width: `${zone.loosePct}%` }}
                          className="bg-blue-600 h-full"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                        <span>Tight: {zone.tightPct}%</span>
                        <span>Optimal: {zone.optimalPct}%</span>
                        <span>Loose: {zone.loosePct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* B2B Relational Record & Pattern Grading QA Spec Card */}
          <div className="lg:col-span-5 bg-white border border-stone-200 rounded-lg p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-stone-200">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                    SKU fit record
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Numerical fit values for{' '}
                    <span className="font-mono font-semibold text-slate-800">
                      {activeReport.sku}
                    </span>
                    . Comparison runs in the separate engine.
                  </p>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCommitActiveSkuToDb}
                  disabled={isCommittingActiveSku}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isCommittingActiveSku ? 'animate-spin' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span>Sync SKU to DB</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSku(activeReport.sku)}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-700 bg-stone-100 rounded-md hover:bg-stone-200 transition-colors shrink-0"
                >
                  Remove SKU
                </button>
                </div>
              </div>

              {skuCommitMessage && (
                <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-900 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{skuCommitMessage}</span>
                </div>
              )}

              {/* Relational Table Row Breakdown */}
              <div className="mt-4 grid grid-cols-3 gap-2.5 font-mono tabular-nums text-xs">
                <div className="p-2.5 bg-stone-50 border border-stone-200 rounded">
                  <div className="text-[11px] font-sans text-slate-500">
                    Primary Key
                  </div>
                  <div className="font-bold text-slate-900 mt-0.5 truncate">
                    {activeReport.sku}
                  </div>
                </div>
                <div className="p-2.5 bg-stone-50 border border-stone-200 rounded">
                  <div className="text-[11px] font-sans text-slate-500">
                    Size Rows
                  </div>
                  <div className="font-bold text-slate-900 mt-0.5">
                    6 (XS–XXL)
                  </div>
                </div>
                <div className="p-2.5 bg-stone-50 border border-stone-200 rounded">
                  <div className="text-[11px] font-sans text-slate-500">
                    Review Rows
                  </div>
                  <div className="font-bold text-slate-900 mt-0.5">
                    {activeReport.totalReviews} rows
                  </div>
                </div>
              </div>

              {/* Pattern Grading Consistency Analysis */}
              <div className="mt-4 p-3.5 bg-stone-50 border border-stone-200 rounded-md text-xs">
                <div className="flex items-center justify-between font-semibold text-slate-900">
                  <span>Pattern Grading Slope (L–XXL vs XS–M)</span>
                  <span
                    className={`font-mono tabular-nums ${
                      activeReport.gradingDelta <= -0.15
                        ? 'text-amber-800'
                        : activeReport.gradingDelta >= 0.15
                        ? 'text-blue-800'
                        : 'text-emerald-800'
                    }`}
                  >
                    {activeReport.gradingDelta > 0
                      ? `+${activeReport.gradingDelta.toFixed(2)}`
                      : activeReport.gradingDelta.toFixed(2)}
                  </span>
                </div>
                <p className="text-slate-600 mt-1 leading-relaxed">
                  {activeReport.sizingGradingAlert}
                </p>
              </div>

              {/* Single-SKU SQL INSERT Preview */}
              <div className="mt-4">
                <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
                  Relational SQL INSERT Statement ({activeReport.sku}):
                </div>
                <pre className="bg-slate-900 text-stone-100 p-3 rounded-md text-[11px] font-mono overflow-x-auto max-h-40 leading-relaxed">
                  {activeSkuSqlSnippet}
                </pre>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-stone-200 flex items-center justify-between text-[11px] text-slate-500">
              <span>Table: commercial_skus + sku_size_metrics</span>
              <a
                href="/api/db/dump.sql"
                download="pearfit-scraper-commercial-database.sql"
                className="font-semibold text-slate-900 hover:underline"
              >
                Download Full .SQL Dump →
              </a>
            </div>
          </div>
        </section>

        {/* Section 6: Scraped Customer Review Corpus Table */}
        <ReviewCorpusTable
          report={activeReport}
          selectedSize={selectedSize}
          onSelectSize={setSelectedSize}
          selectedZoneFilter={selectedZoneFilter}
          onClearZoneFilter={() => setSelectedZoneFilter(null)}
        />
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-stone-200 bg-white py-6 px-6 mt-12">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            Pearfit Scraper — numerical fit values are sent to the comparison engine
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#scraper-workbench"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('scraper-workbench');
              }}
              className="hover:text-slate-900 transition-colors"
            >
              Scraper Pipeline
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="/api/db/dump.sql"
              download="pearfit-scraper-commercial-database.sql"
              className="hover:text-slate-900 transition-colors"
            >
              Export SQL Dump
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
