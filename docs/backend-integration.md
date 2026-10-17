# Backend integration — collection-premium-sarajevo

Paste this whole file into the website chat, together with the files in this zip.

## What exists already (do not recreate)

- Supabase project `collection-premium-sarajevo` (Frankfurt), URL `https://wjbhenmqmpbccelqfddf.supabase.co`,
  publishable key is inside `js/cp-backend.js` (safe for the browser).
- Tables: `profiles`, `products` (12 scents, slugs below), `reservations`, `events`, `admins`, plus admin views.
- Row-level security is on: visitors can only insert reservations and events, customers see only their own data,
  admin views and all rows are visible only to accounts in `admins`.

Product slugs: `dubai, vanille, oud-secret, safyr, arabian-nights, gourmand, love, x, belle-parisienne, bellissima, alya, keos`

## Please do

1. Copy into the site root, keeping the paths:
   `js/cp-backend.js`, `racun/index.html`, `admin/index.html`, `robots.txt`, `sitemap.xml`, `llms.txt`.
2. On every page, before `</body>`:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
   <script src="/js/cp-backend.js" defer></script>
   ```
   It shows the cookie banner and tracks page views and clicks only after "Prihvatam".
3. Reservation form → save through the backend:
   ```js
   const r = await CP.reserve({ full_name, phone, email, product_slug, quantity, city, address, note, referral_code, consent: true });
   if (r.ok) showThanks(); else showError(r.error);
   ```
   Add the required consent checkbox "Slažem se da me kontaktirate u vezi s rezervacijom." The scent select must use the slugs above.
   Keep the hidden honeypot field; if it is filled, don't call `CP.reserve`.
4. Events to fire:
   - quiz first answer: `CP.track('quiz_start')`
   - quiz result: `CP.track('quiz_result', { label: '<slug>' })`
   - reservation modal opens: `CP.track('reserve_open', { label: '<slug>' })`
   - film plays: `CP.track('video_play', { label: 'karavan' })`
   - quiz share button: `CP.track('share', { label: '<slug>' })`
   - add `data-track="hero-rezervisi"`, `data-track="hero-kviz"`, `data-track="kolekcija-<slug>"`, `data-track="whatsapp"` etc. to key buttons so the admin sees readable names.
5. Header and footer: add a "Moj račun" link to `/racun/`. Don't link `/admin/` anywhere.
6. SEO: put the contents of `head-seo-snippet.html` into the home page `<head>` (replace the old title/description),
   and add a visible "Pitanja" section with the same five questions and answers as the FAQ in the snippet.
   Keep all bottle names, notes and texts in the HTML itself (not only rendered by JavaScript), so Google and AI assistants can read them.
   Every image gets a Bosnian `alt`. The footer year: © 2026–2027.
7. When the .ba domain is live, replace `collectionpremium.ba` in robots.txt, sitemap.xml, llms.txt and the snippet if the final domain differs.
8. Deploy as usual. Do not change the Supabase schema from the site; ask in the backend chat instead.
