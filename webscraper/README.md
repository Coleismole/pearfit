# Pearfit Scraper

```bash
cd webscraper
npm install
npm run dev
```

Open http://127.0.0.1:3000 and scrape. Fit numbers go to the shared Supabase project. A size chart on the page is saved in the local `size_chart` table (pit-to-pit chest, centimeters). The project URL and publishable key are already in `.env.example`, which the server reads on its own. Review text stays in the local SQLite file.

If the terminal says the fit store is not writable, or the page says `list_fit_catalog` is missing, open the Supabase SQL editor and run `supabase/fit_store.sql` once. That is a one-time step for the project. After it, every teammate can clone, push, and read the same fit rows.

The five products shown on an empty local database are samples. They are not scrapes. A headless scrape stops after 90 seconds. Public product URLs stay allowed.
