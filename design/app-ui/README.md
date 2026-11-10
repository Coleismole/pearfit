# Pearfit app UI design

UI design for Pearfit, an app that helps shoppers see how clothes will fit by comparing them with clothes they already own.

The screens were made on a Claude design canvas. The `.dc.html` files are the canvas source and display properly only on the canvas, so use them as a visual reference for building the app.

## Screens

| # | File | Screen |
|---|------|--------|
| 1 | `Onboarding.dc.html` | Onboarding: add 1–3 owned items per category |
| 2 | `Main.dc.html` | Home: product-link search bar and tag scanner |
| 3 | `ScanResult.dc.html` | Tag scanned: brand, SKU, category, fit score, save as owned or planned |
| 4 | `Wardrobe.dc.html` | Wardrobe (owned); also contains every wardrobe page |
| 5 | `ItemDetail.dc.html` | Item page, planning to buy |
| 6 | `Analysis.dc.html` | Suitability analysis: score, size suggestion, similar items, reviews |
| 7 | `Compare.dc.html` | Side-by-side compare of a new item and an owned one |
| 8 | `LinkError.dc.html` | Couldn't read link |
| 9 | `Account.dc.html` | Account and settings |
| 10 | `WardrobePlanned.dc.html` | Wardrobe, planning to buy tab |
| 11 | `Category.dc.html` | Category page |
| 12 | `ItemOwned.dc.html` | Item page, owned |
| 13 | `AddCategory.dc.html` | Add category |
| 14 | `ComparePicker.dc.html` | Compare picker pop-up with similarity scores |
| 15 | `CompareResult.dc.html` | Wardrobe compare result (A vs B) |
| – | `FlowDiagram.dc.html` | Diagram of how the screens connect |

`screens/canvas.json` holds the canvas layout. All screen files are in `screens/`.

All product names, measurements and scores are sample data.
