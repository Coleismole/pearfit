# Docs index

Rules live in `AGENTS.md` files and load by folder. The files below are reference, read on demand.
Each fact has one home; link to it instead of copying it.

## Repo-wide (`docs/`)
| Doc | Read it when |
| --- | --- |
| `project-background.md` | You are new, or you question why the product is shaped this way |
| `data-format.md` | You read, write or convert a measurement, wardrobe or candidate |
| `fit-store.md` | You touch Supabase, SQLite, `fit_store.sql` or a key |
| `deploy.md` | You touch a generated file, a build script, a `vercel.json` or a workflow |

## Engine (`engine/`)
| Doc | Read it when |
| --- | --- |
| `engine/AGENTS.md` | You change anything in `engine/`, including the API handlers |
| `engine/README.md` | You run the engine, read the eval output or add data |
| `engine/docs/model-decisions.md` | You change what the engine optimizes for or what a correct case is |
| `engine/docs/wardrobe-test-data.md` | You need the team's real Pilot 1 wardrobes and their caveats |

## Scraper (`webscraper/`)
| Doc | Read it when |
| --- | --- |
| `webscraper/AGENTS.md` | You change anything in `webscraper/` |
| `webscraper/README.md` | You run the scraper, change how reviews are found or set up the fit store |
| `webscraper/SUPPORTED_STORES.md` | You add or re-test a store |
| `webscraper/tools/README.md` | You use a command-line tool around the scraper |

## App, site and design
| Doc | Read it when |
| --- | --- |
| `app/AGENTS.md` | You change anything in `app/` |
| `app/README.md` | You build a screen, or need the API contract the app relies on |
| `design/app-ui/README.md` | You need the screen designs the app was built from |
| `website/README.md` | You edit the marketing site, its demo or its analytics |

## Where a new doc goes
- A rule an agent must follow: the `AGENTS.md` of the narrowest folder that covers it.
- Reference for one area: that area's `README.md` or `docs/` folder.
- Reference that spans areas: here, plus a row in this index and in the root `AGENTS.md` table.
- Sample or exported data: `data/samples/`. Data the engine runs on stays in `engine/data/`.
