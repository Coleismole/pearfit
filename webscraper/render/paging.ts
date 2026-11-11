/** Sorting a review widget newest first and clicking through its "load more" / next-page controls. */
import { MAX_REVIEW_PAGES } from './constants.ts';
import { SORT_NEWEST } from './pageScripts.ts';

/** Switches the review widget to newest first when it can. Best effort; returns what it did. */
export async function sortReviewsNewest(evaluate: (script: string) => Promise<unknown>, sleep: (ms: number) => Promise<void>): Promise<string> {
  const viaSelect = (await evaluate(`${SORT_NEWEST}('select')`)) as string;
  if (viaSelect) return viaSelect;
  const opened = (await evaluate(`${SORT_NEWEST}('open')`)) as string;
  if (!opened) return '';
  await sleep(600);
  const picked = (await evaluate(`${SORT_NEWEST}('pick')`)) as string;
  return picked ? `${opened} ${picked}` : '';
}

/**
 * Clicks "load more" / "next page" in the review widget until no new reviews arrive twice in a row,
 * enough reviews were seen, or time runs out.
 */
export async function pageThroughReviews(ops: {
  /** Clicks a paging control whose label is not in `skip`; returns its label, or '' when none is left. */
  click: (skip: string[]) => Promise<string>;
  /**
   * Reviews read from JSON and review cards on the page, counted separately: a click made progress when
   * either grew. (A pager can replace the cards while the JSON grows; the first JSON page can hold fewer
   * reviews than the cards the page rendered.)
   */
  progress: () => Promise<{ json: number; cards: number }>;
  enough: () => Promise<boolean>;
  settle: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Scrolls to the end of the page; returns 'scroll'. */
  scroll?: () => Promise<string>;
  /**
   * Sends a real pointer click to the control the last click marked. Some stores (L.L.Bean) ignore a
   * script click on their "load more" button and answer only a real one.
   */
  realClick?: () => Promise<boolean>;
  stopAt: number;
}): Promise<number> {
  let pages = 0;
  let idle = 0;
  const skip = new Set<string>();
  const needsRealClick = new Set<string>();
  const fruitless = new Map<string, number>();
  if (process.env.SCRAPER_DEBUG) console.error(`[paging] start: msLeft=${ops.stopAt - Date.now()} enough=${await ops.enough()}`);
  for (let i = 0; i < MAX_REVIEW_PAGES && Date.now() < ops.stopAt; i++) {
    if (await ops.enough()) break;
    const before = await ops.progress();
    // No control left: infinite-scroll lists load the next reviews when the end comes into view.
    const clicked = (await ops.click([...skip])) || (ops.scroll ? await ops.scroll() : '');
    if (process.env.SCRAPER_DEBUG) console.error(`[paging] ${i}: clicked=${JSON.stringify(clicked)} json=${before.json} cards=${before.cards}`);
    if (!clicked) break;
    const waitForGrowth = async () => {
      const until = Math.min(Date.now() + 5000, ops.stopAt);
      while (Date.now() < until) {
        await ops.sleep(300);
        await ops.settle();
        const now = await ops.progress();
        if (now.json > before.json || now.cards > before.cards) return true;
      }
      return false;
    };
    // The real-click retry is for "load more" controls only: a second click on a slow "next" pager would
    // skip a page.
    const loadsMore = /more/i.test(clicked);
    let grew = false;
    if (loadsMore && needsRealClick.has(clicked) && ops.realClick) {
      grew = (await ops.realClick()) && (await waitForGrowth());
    } else {
      grew = await waitForGrowth();
      if (!grew && loadsMore && ops.realClick && (await ops.realClick())) {
        grew = await waitForGrowth();
        if (grew) needsRealClick.add(clicked);
      }
    }
    if (grew) {
      pages++;
      idle = 0;
    } else {
      // That control loaded nothing. After a second try (a response can just be slow) the next candidate
      // gets a turn. Stop after three fruitless clicks in a row.
      if (clicked !== 'scroll') {
        const misses = (fruitless.get(clicked) ?? 0) + 1;
        fruitless.set(clicked, misses);
        if (misses >= 2) skip.add(clicked);
      }
      if (++idle >= 3) break;
    }
  }
  return pages;
}
