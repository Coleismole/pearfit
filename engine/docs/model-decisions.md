# Model Design Decisions — Pilot 1

Decisions made 2026-11-01 from real-shirt testing. Read before changing the engine's goal or the test set.

## 1. The model is objective closest-dimension
The engine's job is: given a shirt's measurements, find the size whose dimensions are closest to shirts the user already wears well. It matches measurements. It does not infer what fit the user wants for a given shirt.

## 2. What "correct" means in the test set
- Correct = the size closest in dimensions to the user's well-fitting shirts.
- NOT "the size the user happened to buy."
- For normal-fit purchases these are the same (which is why early tests passed).
- Keep this definition when labeling every eval case.

## 3. Style purchases are not clean test cases
A shirt bought intentionally oversized, cropped, or slim does NOT have a trustworthy correct size, because the size bought reflects style intent, not best fit. Example: the Keith Haring test — the engine recommended M (closest to the user's good-fitting shirts); the user owns L, bought intentionally oversized. Neither is wrong. This case is excluded from the scored test set and kept only as the documented example. Rule: only use purchases meant to fit normally as scored test cases.

## 4. Output philosophy: translate sizes into shirts the user owns
The most honest output maps each size to a known reference (e.g. "M fits like your Uniqlo sportswear (usual fit); L fits like your Adidas (oversized)"). Lead with the objective best match, then give context to override it. The engine never guesses intent.

## 5. Known limitation (by design)
The model cannot know you want a specific shirt baggy/slim. That is outside measurements. Honest boundary, not a bug.

## 6. The label-system gap (future, not now)
great/tight/loose conflates "too big, unwanted" with "oversized, loved." Future: add a fit-style dimension (regular/oversized/slim) separate from good/bad, let a loved-oversized shirt be a positive reference, and use the garment's stated fit.

## 7. Still true from earlier
- Chest (pit-to-pit / body width) is the trusted dimension across sources.
- Length/sleeve need a per-brand offset or get nulled.
- Calibrated so far: Uniqlo (chest +1.5, length +2.5), Tommy (chest +2, length +5).

---

# 2026-11-14: Body-chart-only stores (PROPOSED, not yet signed off)

Status: PROPOSED. Nothing here is a team decision until the team signs off. Do not build against it before then.
Tracking: umbrella issue https://github.com/Coleismole/pearfit/issues/50 (tasks #40 to #48).
Evidence is thin: 14 hand-measured shirts from 3 people, paired body and garment charts from Uniqlo only, and third-party chart copies whose units were assumed. Treat it as directional.

## 8. Findings
- Body charts are the norm. A chart was read for 17 of 163 stores that returned reviews (`webscraper/SUPPORTED_STORES.md`). The scraper drops body ranges and the engine skips SKUs with no chart rows (`engine/cli/candidate-source.ts`). Those stores get no recommendation today.
- A generic fit word gives ease good to about one size either way. The spread within one fit word is about 5 cm of circumference each side of the center, which is about one size step, and adjacent fit words differ by less than that. On the 14 shirts, one constant ease per fit type held under one size step only for 3 oversized Uniqlo shirts.
- Ease is roughly constant across sizes within one product (Uniqlo paired charts: flat from M to XL, 0 to 2 cm lower at the largest sizes). It differs by product family, so the fit word alone does not pin it.
- Reviews are underused. Height, weight and usual size are extracted but never used or sent to Supabase, and fit votes are stored as one percentage per product, not per size.

## 9. Three approaches
- A. Body-range matching: match the shopper's body to the store's body ranges, stored in their own field.
- B. Estimate garment numbers from the body chart plus fit-type ease, then run the existing engine.
- C. Similar-reviewer matching: reviewers of similar height and weight, the size they bought, what they said.

## 10. Proposed choice: A as the base, with C's review data layered on. B rejected.
Why A: it uses only numbers the store published, so no measurement is invented (the core rule: missing = null). It keeps body ranges apart from pit-to-pit chest, which avoids the body-versus-flat chest mix-up.
Why C's review data: reviews are the one other signal these stores have. Per-size fit votes can move the pick by at most one size. C as a stand-alone method is not chosen because cells of height by weight by size would be sparse.
Why not B: it writes made-up centimetres into the garment chest, which breaks the missing = null rule. Its error (about one size) is as large as the gaps it must tell apart, so it would look precise and not be.

Rules proposed with the choice:
- Body ranges live in a separate field, never mixed with pit-to-pit chest.
- Confidence caps at medium.
- Reviews may shift the pick by at most one size, only with enough votes for that specific size. For products with a garment chart the rule in `engine/AGENTS.md` stays as it is (ties only, never overrides). This needs the team decision in #47.
- The recommendation carries a field saying whether it came from a garment chart or a body chart. Frontends show a disclaimer for the body-chart case, for example: "this brand only publishes body size charts; results may be less accurate than usual".
- First accuracy target from the repo owner: 85%. Proposed reading: the recommended size is right or one size off in 85% of eval cases. The exact definition is for the team to confirm.

## 11. Open questions
- Can reviews outrank measurements when only body charts exist (#47)?
- "Fits like your X" or "sized like your X" on body-chart stores (#48)? The owner's position so far is to flag the chart type and show the disclaimer rather than make up measurements.
- Kill-test thresholds (#46).
- How many stores expose size bought, height, weight and a fit answer (#45)?
