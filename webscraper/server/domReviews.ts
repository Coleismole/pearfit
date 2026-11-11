/** Reading review cards from page markup. */
import * as cheerio from 'cheerio';
import type { RawScrapedReview } from '../fitAnalyzer.ts';
import { extractSizeFromReviewText } from '../structuredData.ts';
import { REVIEW_CARD_SELECTOR } from '../headlessFetch.ts';
import {
  labelledValue,
  leafTexts,
  LABEL_LINE,
  longestFreeText,
  looksLikeDate,
  isBadgeLine,
  dateFromAttribute,
  textOutsideLines,
  ratingFromStarFills,
  ratingFromLabel,
  ratingFromStarIcons,
} from '../pageHelpers.ts';

/** "Size Purchased: L" -> "L": a card that keeps its label in the value. */
function stripSizeLabel(value: string): string {
  return value.replace(/^\s*(?:size|purchased|ordered|bought)(?:\s+(?:purchased|ordered|bought|size))?\s*[:\-]\s*/i, '').trim();
}

/**
 * The review cards on the page. JSON-LD often carries only a few reviews; the cards are still read, and
 * `completeDomCards` holds the indexes of the cards that have both a star rating and a named reviewer.
 * Adds to `selectorsUsed` when the page has cards.
 */
export function readDomReviewCards(
  $: cheerio.CheerioAPI,
  selectorsUsed: string[],
): { domReviews: RawScrapedReview[]; completeDomCards: Set<number> } {
  const domReviews: RawScrapedReview[] = [];
  const completeDomCards = new Set<number>();

  // 2. Review cards in the DOM (microdata and common review-widget markup).
  // JSON-LD often carries only a few reviews. The cards on the page are still read.
  {
    const reviewElements = $(REVIEW_CARD_SELECTOR);
    if (reviewElements.length > 0) {
      selectorsUsed.push('review-card DOM selectors');
      reviewElements.each((idx, el) => {
        const node = $(el);
        // Skip wrappers that contain another matched card (avoids double counting).
        if (node.find(REVIEW_CARD_SELECTOR).length > 0) return;
        const nodeText = node.text().replace(/\s+/g, ' ').trim();
        const lines = leafTexts($, node);

        const isDate = looksLikeDate;
        const author =
          node.attr('data-author') ||
          node.attr('data-reviewer') ||
          node.find('[itemprop="author"]').first().text().trim() ||
          node.find('[class*="feed-item-title"] .title').first().text().trim() ||
          // A hashed CSS-module class ends in "_author"; "_authorInfo" wraps the name and a "Verified Buyer" badge.
          node.find('[class$="_author"], [class*="_author "]').first().text().trim() ||
          node.find('[class*="reviewer-name"], .review-author, [class*="review-author"], .jdgm-rev__author, .yotpo-user-name, [class*="reviewUserInfo"] > :first-child, [class*="user-info" i] > :first-child').first().text().replace(/^[\s\u2014-]+/, '').trim() ||
          // A masked reviewer name ("1***3", "a***b") alone on its line.
          lines.find((l) => /^[\p{L}\p{N}]{1,4}\*{2,}[\p{L}\p{N}]{1,4}$/u.test(l)) ||
          'Anonymous';
        const body =
          node.find('[itemprop="reviewBody"], .review-body-copy, [class*="review-body"], [class*="review-content"], [class*="review-text"], [class*="reviewContent-body"], [class*="reviewBody"], [class*="review_body"], [class*="CommentWithEllipsis"], [class*="_reviewContent"], .main-text, [class*="review-message"], .jdgm-rev__body, .bv-content-summary-body-text, .pr-rd-description-text').first().text().replace(/\s+/g, ' ').trim() ||
          longestFreeText(lines, [author]) ||
          // Text written directly in the card. A card of only a rating, a date and a size has none: no review.
          textOutsideLines(nodeText, lines);
        // Unlabelled markup: the first short free-text line before the body is the title.
        const title =
          node.find('[itemprop="name"], [class*="review-title"], h3, h4').first().text().replace(/\s+/g, ' ').trim() ||
          lines.slice(0, Math.max(0, lines.indexOf(body))).find(
            (l) => l !== author && l.length <= 150 && !LABEL_LINE.test(l) && !isDate(l) && !isBadgeLine(l)
          ) ||
          '';
        const sizePurchased = stripSizeLabel(
          node.attr('data-size') ||
          node.find('.review-size-tag strong').text().trim() ||
          labelledValue(lines, /^(purchased size|size purchased|size ordered|size bought|size)$/i) ||
          // Loox "Item type: GLACIER / XX-LARGE": the size is the last part.
          node.find('.item-type-value').first().text().split('/').pop()?.trim() ||
          // Tags become spaces first: "<div>L</div><div>These..." must not read as "LThese".
          (node.html() ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/Size(?:\s+(?:Purchased|Ordered|Bought))?\s*:\s*([A-Za-z0-9]+)/i)?.[1] ||
          extractSizeFromReviewText(body)
        );
        const ratingStr =
          node.attr('data-rating') ||
          node.attr('data-score') ||
          node.find('[itemprop="ratingValue"]').attr('content') ||
          node.find('[itemprop="ratingValue"]').text().trim() ||
          node.find('[data-score]').attr('data-score') ||
          node.find('.review-rating').text().match(/(\d(?:\.\d)?)/)?.[1] ||
          // Accessible star widgets: aria-label/title like "4 out of 5 stars".
          ratingFromLabel(node.find('[aria-label*="out of 5" i], [title*="out of 5" i]').first().attr('aria-label') ?? node.find('[title*="out of 5" i]').first().attr('title')) ||
          ratingFromLabel(node.find('[aria-label*="/ 5" i]').first().attr('aria-label')) ||
          ratingFromStarIcons($, node) ||
          ratingFromStarFills($, node) ||
          // Screen-reader text such as "Rated 5 out of 5" (Okendo and others).
          nodeText.match(/\brated\s+(\d(?:\.\d)?)\s+out of\s+5\b/i)?.[1] ||
          '';
        const declaredFitTag =
          node.attr('data-fit') ||
          node.find('.review-fit-tag').text().replace(/^Fit:\s*/i, '').trim() ||
          labelledValue(lines, /^(how it fits|fit|overall fit|sizing)$/i) ||
          undefined;
        const date =
          dateFromAttribute(node.attr('data-date') ?? '') ||
          node.find('[itemprop="datePublished"]').attr('content') ||
          node.find('time').attr('datetime') ||
          lines.find(isDate) ||
          '';
        const reviewerHeight = labelledValue(lines, /^height$/i) || undefined;
        const reviewerBuild = labelledValue(lines, /^(weight|body type|build)$/i) || undefined;
        const usualSize = labelledValue(lines, /^(usual size|normally wears|usually wears)$/i) || undefined;
        const parsedRating = parseFloat(ratingStr);

        // Bazaarvoice's search-engine block renders debug text ("bvseo_bulk, prod_bvrr", "y_2026, m_11")
        // inside review markup. A card with no rating, no reviewer and mostly snake_case tokens is not a review.
        const words = body.split(/[\s,]+/).filter(Boolean);
        const tokenish = words.filter((w) => /_/.test(w) || /^[a-z]+\d+$/i.test(w)).length;
        // Share buttons and widget lines ("facebook Share Review by Anonymous User") are not reviews either.
        // Only a card made of such words: a real review can mention Facebook.
        const WIDGET_WORDS =
          /\b(facebook|twitter|pinterest|share (this )?review|share|copy link|was this (review )?helpful|report (this )?review|tweet|pin it|by|anonymous|user|yes|no)\b|\d+/gi;
        const widgetLine =
          /\b(facebook|twitter|pinterest|share (this )?review|copy link|was this (review )?helpful|report (this )?review)\b/i.test(body) &&
          body.replace(WIDGET_WORDS, ' ').split(/[^\p{L}]+/u).filter(Boolean).length <= 2;
        const debugText =
          !Number.isFinite(parsedRating) && author === 'Anonymous' && (tokenish * 2 >= words.length || widgetLine);
        if (body.length > 8 && !debugText) {
          // A card with a star rating in its markup and a named reviewer is a real review. Lines a widget
          // repeats around reviews ("Was this review helpful?") have neither.
          if (Number.isFinite(parsedRating) && author !== 'Anonymous') completeDomCards.add(domReviews.length);
          domReviews.push({
            id: `dom-rev-${idx + 1}`,
            author,
            sizePurchased,
            usualSize,
            // A card whose stars cannot be read has no rating. Never a stand-in such as 3.
            // (A widget that prints "0" has no rating to show either.)
            rating: Number.isFinite(parsedRating) && parsedRating > 0 ? Math.min(5, Math.max(1, Math.round(parsedRating))) : null,
            title,
            body,
            date,
            verifiedPurchase: false,
            reviewerHeight,
            reviewerBuild,
            declaredFitTag,
          });
        }
      });
    }
  }

  return { domReviews, completeDomCards };
}
