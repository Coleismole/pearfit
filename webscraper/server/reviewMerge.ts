/** Merging the reviews read from several sources (JSON-LD, review JSON, DOM cards) into one list. */
import type { RawScrapedReview } from '../fitAnalyzer.ts';

/** JSON-LD stays the base. DOM cards fill a blank size and add reviews that were not in the script. */
const PLACEHOLDER_AUTHOR = /^(anonymous|verified (buyer|purchaser|customer|reviewer)|customer|guest|a customer|shopper)$/i;

/** True when `text` contains `part` starting at a word boundary. */
function startsAtWord(text: string, part: string): boolean {
  let from = text.indexOf(part);
  while (from !== -1) {
    if (from === 0 || !/[\p{L}\p{N}]/u.test(text[from - 1])) return true;
    from = text.indexOf(part, from + 1);
  }
  return false;
}

export function mergeScrapedReviews(primary: RawScrapedReview[], extra: RawScrapedReview[]): RawScrapedReview[] {
  // A card cut short by "Read more" still matches its full review: compare the first 60 characters.
  const norm = (body: string) =>
    body.replace(/\s+/g, ' ').replace(/(\.\.\.|…)?\s*(read more|show more|more)?$/i, '').trim().toLowerCase().slice(0, 60);
  const merged = primary.map((review) => ({ ...review }));
  // Reviews by text. Two shoppers can write the same words ("Love it"): the same text is the same review
  // only when the reviewers agree, or one of them is unnamed.
  const index = new Map<string, RawScrapedReview[]>();
  const remember = (key: string, review: RawScrapedReview) => {
    if (!key) return;
    const list = index.get(key) ?? [];
    list.push(review);
    index.set(key, list);
  };
  const unnamed = (author: string) => !author || PLACEHOLDER_AUTHOR.test(author);
  // One reviewer is shown in several forms: "Eddie K." in a widget's data, "Eddie K" or "Eddie Kowalski" in
  // JSON-LD, "Ann S., Toronto ON" on a card. Compare words of letters and digits: the first word must match,
  // and each word of the shorter form must start the matching word of the longer one.
  const nameWords = (name: string) => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const sameName = (a: string, b: string) => {
    const [short, long] = [nameWords(a), nameWords(b)].sort((x, y) => x.length - y.length);
    if (short.length === 0 || short[0] !== long[0]) return false;
    return short.every((word, i) => long[i].startsWith(word) || word.startsWith(long[i]));
  };
  const sameReviewer = (a: RawScrapedReview, b: RawScrapedReview) =>
    unnamed(a.author) || unnamed(b.author) || sameName(a.author, b.author);
  for (const review of merged) remember(norm(review.body), review);
  const loose = (body: string) => body.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const review of extra) {
    const key = norm(review.body);
    // A card whose text holds the whole card (stars, date, title, body) still matches its review.
    const existing =
      (key ? index.get(key)?.find((m) => sameReviewer(m, review)) : undefined) ??
      merged.find((m) => {
        // Same named reviewer, and the card contains the start of that review's text (a review can be
        // as short as "Good").
        // A placeholder name ("Verified Buyer") is shared by many reviewers and identifies no one.
        if (PLACEHOLDER_AUTHOR.test(m.author) || !sameName(m.author, review.author)) return false;
        const card = loose(review.body);
        const start = loose(m.body).slice(0, 40);
        // A card cut short ("Read more") may hold only part of the text, but it still shows the title.
        // Short text must start at a word ("ok" is not inside "looks"); longer text and titles can sit right
        // after other card text, which widgets often run together ("10 months agoDecent shirt").
        const title = loose(m.title);
        const startMatches = start.length >= 12 ? card.includes(start) : start.length >= 2 && startsAtWord(card, start);
        return startMatches || (title.length >= 8 && card.includes(title));
      });
    if (!existing) {
      merged.push(review);
      remember(key, review);
      continue;
    }
    if (!existing.sizePurchased && review.sizePurchased) existing.sizePurchased = review.sizePurchased;
    if (!existing.declaredFitTag && review.declaredFitTag) existing.declaredFitTag = review.declaredFitTag;
    if (!existing.date && review.date) existing.date = review.date;
    if ((!existing.author || existing.author === 'Anonymous') && review.author && review.author !== 'Anonymous') {
      existing.author = review.author;
    }
    if (!existing.usualSize && review.usualSize) existing.usualSize = review.usualSize;
  }
  return merged;
}
