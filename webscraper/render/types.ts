/** What a render returns, and the JSON a page received while it rendered. */

export interface RenderedPage {
  html: string;
  status: number | null;
  finalUrl: string;
  reviewSelectorFound: boolean;
  /**
   * The page as serialized once it settled and was scrolled, before any review step.
   * A review click can navigate away from the product view (Uniqlo goes to /reviews) and take the
   * size chart with it, so the chart is read from here when the final html has none.
   */
  chartHtml: string | null;
  /** JSON (or JSONP) responses the page itself received that carry a rating field: review widget data. */
  jsonResponses: CapturedJson[];
  /**
   * Earlier pages of a review list that pages by link (Zappos /product/review/<id>/page/2), oldest first.
   * `html` is the last page. Each holds its own reviews.
   */
  extraHtml?: string[];
  /**
   * HTML tables that arrived inside JSON the page itself received (Salesforce: { action: "Product-SizeChart",
   * content: "<table>…" }). Each entry is one HTML fragment, read as a chart candidate beside the page.
   */
  chartJson?: string[];
  /**
   * Size guides that are pages of their own, linked from the product page ("/pages/size-chart"), loaded when
   * the product page itself showed no chart. They hold the store's tables for every product: use
   * parseSizeChartWithGuides, which picks the table that fits the product.
   */
  guidePages?: string[];
}

export interface CapturedJson {
  url: string;
  body: string;
}
