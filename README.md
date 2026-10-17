# cpsarajevo.ba

Website for Collection Premium Sarajevo (Collection Premium Paris, official partner for Sarajevo). Static site on Netlify.

- `index.html`, `prica/`: the public site
- `racun/`: customer account (email login link, reservations)
- `admin/`: admin dashboard (admins only, data from Supabase)
- `js/cp-backend.js`: Supabase client, cookie consent, click tracking, reservations
- `film/`, `img/`, `vendor/`: media and libraries
- `docs/`: integration notes and the SEO head snippet

Backend: Supabase project `collection-premium-sarajevo` (eu-central-1). Schema changes go through migrations, not from the site.
