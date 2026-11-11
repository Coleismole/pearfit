/** Selectors and limits shared by the headless render modules. */

/** Selectors that indicate review content has rendered. Kept in sync with the card reader in server/domReviews.ts. */
export const REVIEW_CARD_SELECTOR =
  '[data-review-card], .review-card, [itemprop="review"], .review-item, .yotpo-review, .jdgm-rev, .spr-review, .bv-content-review, .pr-review, .okeReviews-review, .oke-w-review, .stamped-review, [data-bv-show="reviews"] li, [class*="ReviewCard"], [class*="review-card"], [class*="aftership-reviews-widget"][class*="cardContainer"], .detailReviewItem, [class$="_review"]:has([class*="reviewContent"]), article:has([aria-label="review item"]), .grid-item:has(.main-text), .product-detail__rating__review, .pdp-review, li:has(> div > [data-testid="ITORating"]), li:has([class*="reviewUserInfo"])';

export const NAV_TIMEOUT_MS = 45_000;
/** Whole render, including scrolling and paging. One page cannot hold the browser longer than this. */
export const RENDER_DEADLINE_MS = 120_000;
/**
 * Time kept back at the end of a render for opening the size chart and serializing the page. A page of
 * several megabytes (Duer: 3 MB) takes seconds to serialize; running into the hard deadline loses
 * everything the render recorded.
 */
export const RENDER_TAIL_MS = 25_000;
export const REVIEW_WAIT_MS = 10_000;
/** Most "load more" / "next page" clicks in one review widget. */
export const MAX_REVIEW_PAGES = 60;
/** Stop paging once about this many reviews were seen; enough for fit statistics. */
export const MAX_REVIEWS = 300;
/** Most review pages followed by link (/…/page/N). */
export const MAX_LINKED_REVIEW_PAGES = 15;
/** Review JSON kept from one render: per response and in total. */
export const MAX_CAPTURED_BODY_BYTES = 5_000_000;
export const MAX_CAPTURED_TOTAL_BYTES = 30_000_000;

/** Containers of review widgets (vendor and first-party). Used to scroll them into view and to find their paging controls. */
export const REVIEW_WIDGET_SELECTOR = [
  '#yotpo-main-widget', '.yotpo-main-widget', '[class*="yotpo-reviews"]', '.yotpo-display-wrapper',
  '.okeReviews', '[data-oke-reviews-widget]', '[data-oke-widget]',
  '.jdgm-widget', '.jdgm-rev-widg', '#judgeme_product_reviews',
  '#stamped-main-widget', '.stamped-main-widget', '#stamped-reviews-widget',
  '[class*="junip"]', 'junip-product-reviews',
  '[data-bv-show]', '#BVRRContainer', '[class*="bv-rnr"]', '[class*="bv_main"]', '[class*="bv-pagination"]', '[data-bv-v]',
  '#pr-reviewdisplay', '.pr-review-display',
  '.kl_reviews', '[class*="kl_reviews"]', '#klaviyo-reviews-all',
  '.loox-reviews-default', '#looxReviews', '.reviews-io-widget', '#ReviewsWidget', '#full-page-widget',
  '#reviews', '#Reviews', '#product-reviews', '[id*="review" i]:not([id*="preview" i])', '[class*="review" i]:not([class*="preview" i])',
].join(', ');
