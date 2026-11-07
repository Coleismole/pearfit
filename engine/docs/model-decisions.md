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
