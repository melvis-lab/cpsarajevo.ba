# cpsarajevo.ba

Website for Collection Premium Sarajevo (Collection Premium Paris, official partner for Sarajevo). Static site on Netlify.

- `index.html`, `prica/`: the public site
- `racun/`: customer account (email login link, reservations)
- `admin/`: admin dashboard (admins only, data from Supabase)
- `js/cp-backend.js`: Supabase client, cookie consent, click tracking, reservations
- `film/`, `img/`, `vendor/`: media and libraries
- `docs/`: integration notes and the SEO head snippet
- `en/`, `ar/`: English and Arabic pages. **Generated, do not edit by hand** (except the privacy pages).

## English (/en/) and Arabic (/ar/)

Each language has its own address: `/` Bosnian, `/en/` English, `/ar/` Arabic (right-to-left).
`en/index.html`, `en/prica/index.html`, `ar/index.html` and `ar/prica/index.html` are built from the Bosnian pages:

```
python3 tools/build_pages.py
```

Run it after every change to `index.html` or `prica/index.html`, and commit the result.
English comes from the `data-en` attributes; Arabic is looked up by that English text in
`tools/ar-home.json` and `tools/ar-prica.json`. The build stops and lists any string with no Arabic yet.
`js/i18n-ar.js` (generated) covers what JavaScript draws on the Arabic page (quiz, scent sheets, reviews).

- `css/ar.css`: Arabic fonts (Amiri, IBM Plex Sans Arabic) and right-to-left layout fixes
- `en/privatnost/`, `ar/privatnost/`: hand-written translations; update them when the Bosnian privacy page changes
- The Arabic pages play the English films. Bottle names stay in Latin letters.
- Old links with `?lang=en` forward to `/en/`.

## Reservations

The form saves to Supabase (admin) and Netlify Forms (email) at the same time and shows "thank you"
if either one worked. If both fail, the visitor gets a WhatsApp link with the reservation prefilled.
Each attempt is logged as event `reserve_saved` with label `db/no-db form/no-form`.

## Deploying (read before every deploy)

The Netlify site is **not** linked to GitHub: pushing does not deploy. Deploy only with

```
git pull
tools/deploy.sh          # production
tools/deploy.sh --draft  # preview URL only
```

The script stops if there are uncommitted changes, if your folder is behind `origin/main`,
if `en/`/`ar/` are out of date, or if a file in `social/MANIFEST.txt` is missing. It builds from
`git archive HEAD` (never `.git`, 600+ MB, which makes the upload fail) and checks `/`, `/en/`, `/ar/`
and every manifest file on cpsarajevo.ba and the netlify.app address afterwards.

Rules:
- Never deploy from an old working folder or by dragging a folder into Netlify. That is how `/en/`, `/ar/`
  and Buffer media were wiped on 21 and 23 Oct 2026.
- Buffer posts must use media on the Higgsfield CDN (d2ol7oe51mr4n9.cloudfront.net), never
  cpsarajevo.ba or netlify.app URLs. Anything under `social/` must be committed and listed in
  `social/MANIFEST.txt` (`find social -type f ! -name MANIFEST.txt | sort` after the header).
- Pages in subfolders (`/prica/`, `/racun/` …) use root-relative paths (`/img/...`), never `img/...`.
