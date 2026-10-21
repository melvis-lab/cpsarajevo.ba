# cpsarajevo.ba

Website for Collection Premium Sarajevo (Collection Premium Paris, official partner for Sarajevo). Static site on Netlify.

- `index.html`, `prica/`: the public site
- `racun/`: customer account (email login link, reservations)
- `admin/`: admin dashboard (admins only, data from Supabase)
- `js/cp-backend.js`: Supabase client, cookie consent, click tracking, reservations
- `film/`, `img/`, `vendor/`: media and libraries
- `docs/`: integration notes and the SEO head snippet
- `ar/`: Arabic pages (right-to-left). **Generated, do not edit by hand.**

## Arabic version (/ar/)

`ar/index.html` and `ar/prica/index.html` are built from the Bosnian pages:

```
python3 tools/build_ar.py
```

Run it after every change to `index.html` or `prica/index.html`, and commit the result.
It writes the Arabic text straight into the HTML (crawlable by Google and AI assistants) and
regenerates `js/i18n-ar.js` for the parts JavaScript draws (quiz, scent sheets, reviews).
It stops and lists the strings if any English text (`data-en`) has no Arabic yet:
add them to `tools/ar-home.json` or `tools/ar-prica.json` (keyed by the English text).

- `css/ar.css`: Arabic fonts (Amiri, IBM Plex Sans Arabic) and right-to-left layout fixes
- `ar/privatnost/index.html`: hand-written Arabic privacy page (update it when the Bosnian one changes)
- The Arabic pages play the English films. Bottle names stay in Latin letters.

Backend: Supabase project `collection-premium-sarajevo` (eu-central-1). Schema changes go through migrations, not from the site.
