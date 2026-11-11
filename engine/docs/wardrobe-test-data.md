# Wardrobe Test Data — Pilot 1

Collected from 3 people. Last updated 2026-10-30.

## How to use this

- Each person is a **separate test set**. The scorer compares a candidate garment only against the **same person's** owned shirts (filter by `owner`).
- Do NOT pool all shirts into one wardrobe — a shirt that fits Person 1 says nothing about Person 2's body.
- Copy the JSON block below into the data file for the scorer.

## Read before trusting the results (3 data caveats)

1. The `label` (great/tight/loose) is a forced mapping and should be reviewed. Most of the original fit notes are about **length** ("slightly shorter", "a bit too long") or are **mixed** ("compressed on sleeves, loose elsewhere, but good fit"), which don't map cleanly to great/tight/loose. The original wording is kept in `fit_note` — check the label calls against it, especially `uniqlo-normal-1`, `banana-republic-essential`, and the "length too long" shirts. If the ground-truth labels are wrong, a correct algorithm will look broken.
2. Most complaints here are about **length**, but the seed weights make length the *least* important dimension. For this group that's a mismatch — watch for it. (This is the kind of thing the test is meant to reveal, not a bug to fix yet.)
3. Few shirts per person (2–5) and mixed sizes. Results are directional, not proof.

**Still missing:** candidate shirts with known correct answers. The data below is only the wardrobes. To actually score the algorithm you need "pretend you're shopping for this" candidates per person, each with the known right outcome.

## JSON

```json
[
  {
    "owner": "person1",
    "id": "nike-sportswear-fabric",
    "size": "XL",
    "label": "great",
    "measurements": { "chest_cm": 57.5, "length_cm": 70, "sleeve_cm": 23 },
    "fit_note": "good"
  },
  {
    "owner": "person1",
    "id": "uniqlo-normal-1",
    "size": "XL",
    "label": "great",
    "measurements": { "chest_cm": 58, "length_cm": 64.5, "sleeve_cm": 22.5 },
    "fit_note": "slightly shorter on the length"
  },
  {
    "owner": "person1",
    "id": "uniqlo-normal-2",
    "size": "XL",
    "label": "loose",
    "measurements": { "chest_cm": 61.5, "length_cm": 72.5, "sleeve_cm": 23.5 },
    "fit_note": "oversized fit"
  },
  {
    "owner": "person1",
    "id": "nike-tee-loose-white",
    "size": "XL",
    "label": "tight",
    "measurements": { "chest_cm": 56, "length_cm": 69, "sleeve_cm": 20 },
    "fit_note": "slightly shorter on the length, more compressed"
  },
  {
    "owner": "person1",
    "id": "nike-tee-loose-black",
    "size": "XL",
    "label": "tight",
    "measurements": { "chest_cm": 52.5, "length_cm": 68, "sleeve_cm": 20 },
    "fit_note": "slightly shorter on the length, more compressed"
  },
  {
    "owner": "person2",
    "id": "uniqlo-boxy-charcoal",
    "size": "M",
    "label": "loose",
    "measurements": { "chest_cm": 55.5, "length_cm": 65.4, "sleeve_cm": 22.6 },
    "fit_note": "baggy and cropped - really nice"
  },
  {
    "owner": "person2",
    "id": "ralph-lauren-polo-blue",
    "size": "M",
    "label": "great",
    "measurements": { "chest_cm": 51, "length_cm": 66.4, "sleeve_cm": 23.2 },
    "fit_note": "perfect"
  },
  {
    "owner": "person2",
    "id": "hm-brown-tee",
    "size": "US20",
    "label": "great",
    "measurements": { "chest_cm": 49, "length_cm": 66.6, "sleeve_cm": 21.7 },
    "fit_note": "perfect"
  },
  {
    "owner": "person2",
    "id": "hm-regular-standard",
    "size": "M",
    "label": "tight",
    "measurements": { "chest_cm": 52.7, "length_cm": 68.6, "sleeve_cm": 23.5 },
    "fit_note": "too tight on the neck"
  },
  {
    "owner": "person2",
    "id": "banana-republic-essential",
    "size": "S",
    "label": "great",
    "measurements": { "chest_cm": 49.8, "length_cm": 67.5, "sleeve_cm": 21 },
    "fit_note": "compressed on sleeves, loose everywhere else but good fit"
  },
  {
    "owner": "person3",
    "id": "uniqlo-airism-oversized",
    "size": "XS",
    "label": "loose",
    "measurements": { "chest_cm": 47, "length_cm": 58, "sleeve_cm": 22.5 },
    "fit_note": "loose, baggy sleeves"
  },
  {
    "owner": "person3",
    "id": "smartwool",
    "size": "S",
    "label": "great",
    "measurements": { "chest_cm": 44, "length_cm": 58, "sleeve_cm": 19 },
    "fit_note": "a little long"
  },
  {
    "owner": "person3",
    "id": "stay-freaky-nike",
    "size": "M",
    "label": "great",
    "measurements": { "chest_cm": 46, "length_cm": 62, "sleeve_cm": 21 },
    "fit_note": "chest good, length a bit too long"
  },
  {
    "owner": "person3",
    "id": "jack-jones-original",
    "size": "M",
    "label": "great",
    "measurements": { "chest_cm": 45, "length_cm": 60, "sleeve_cm": 19 },
    "fit_note": "chest is good, length a bit too long"
  }
]
```
