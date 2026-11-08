# Pearfit Scraper

```bash
cd webscraper
npm install
npm run dev
```

Open http://127.0.0.1:3000 and scrape. Fit numbers go to the shared Supabase project. The project URL and publishable key are already in `.env.example`, which the server reads on its own. Review text stays in the local SQLite file.

If the terminal says the fit store is not writable, open the Supabase SQL editor and run `supabase/fit_store.sql` once. That is a one-time step for the project. After it, every teammate can clone and push without it.
