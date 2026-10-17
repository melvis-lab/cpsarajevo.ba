/* Collection Premium Sarajevo · backend client
 * Load after supabase-js:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
 *   <script src="/js/cp-backend.js" defer></script>
 *
 * What it does
 *  - cookie consent banner (Bosnian); nothing is tracked before "Prihvatam"
 *  - page views + clicks on links, buttons and anything with data-track="name"
 *  - quiz / reservation / video / share events via CP.track(type, {element, label})
 *  - CP.reserve({...}) saves a pre-order (guest or logged in), keeps UTM + referral
 *  - CP.auth: magic-link login for returning clients
 */
(function () {
  const SUPABASE_URL = 'https://wjbhenmqmpbccelqfddf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_OakQF8wdzIMEGqHmhhIeCw_e9gORbbs'; // publishable key, safe in the browser
  const CONSENT_KEY = 'cp_consent_v1';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
  });

  // ---------- small helpers ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

  function sessionId() {
    let id = null;
    try { id = sessionStorage.getItem('cp_sid'); } catch (e) {}
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 32);
      try { sessionStorage.setItem('cp_sid', id); } catch (e) {}
    }
    return id;
  }

  // UTM + referral: remember the first touch for this visit
  function campaign() {
    const p = new URLSearchParams(location.search);
    const saved = JSON.parse(store.get('cp_utm') || '{}');
    const now = {
      utm_source: p.get('utm_source') || saved.utm_source || null,
      utm_medium: p.get('utm_medium') || saved.utm_medium || null,
      utm_campaign: p.get('utm_campaign') || saved.utm_campaign || null,
      ref: p.get('ref') || saved.ref || null,
    };
    store.set('cp_utm', JSON.stringify(now));
    return now;
  }
  const utm = campaign();

  function device() {
    const w = window.innerWidth;
    return w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop';
  }

  // ---------- consent ----------
  const consent = () => store.get(CONSENT_KEY) === 'yes';

  function banner() {
    if (store.get(CONSENT_KEY) || isAdminPage) return;
    const b = document.createElement('div');
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Kolačići');
    b.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:110;max-width:560px;margin:0 auto;' +
      'background:#17120e;color:#f6efe3;border:1px solid #c9a46a55;border-radius:14px;padding:16px 18px;' +
      'font:14px/1.5 Jost,system-ui,sans-serif;box-shadow:0 10px 40px #0008';
    b.innerHTML =
      '<div style="margin-bottom:12px">Koristimo kolačiće da vidimo šta je posjetiocima zanimljivo na stranici. ' +
      'Bez tvog pristanka ništa ne bilježimo. <a href="/privatnost" style="color:#e2c58f">Privatnost</a></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
      '<button data-c="no" style="background:none;border:1px solid #f6efe355;color:#f6efe3;border-radius:999px;padding:8px 16px;cursor:pointer">Odbijam</button>' +
      '<button data-c="yes" style="background:#c9a46a;border:0;color:#0e0b09;border-radius:999px;padding:8px 18px;cursor:pointer;font-weight:600">Prihvatam</button></div>';
    b.addEventListener('click', (e) => {
      const c = e.target.getAttribute && e.target.getAttribute('data-c');
      if (!c) return;
      store.set(CONSENT_KEY, c);
      b.remove();
      if (c === 'yes') track('page_view');
    });
    document.body.appendChild(b);
  }

  // ---------- tracking ----------
  let userId = null;
  sb.auth.getSession().then(({ data }) => { userId = data.session ? data.session.user.id : null; });
  sb.auth.onAuthStateChange((_e, s) => { userId = s ? s.user.id : null; });

  const isAdminPage = location.pathname.startsWith('/admin');

  function track(type, extra) {
    if (!consent() || isAdminPage) return Promise.resolve();
    const row = {
      session_id: sessionId(),
      user_id: userId,
      type,
      path: cut(location.pathname + location.hash, 300),
      element: cut(extra && extra.element, 120),
      label: cut(extra && extra.label, 200),
      referrer: cut(document.referrer || null, 300),
      utm_source: cut(utm.utm_source, 80),
      utm_medium: cut(utm.utm_medium, 80),
      utm_campaign: cut(utm.utm_campaign, 120),
      device: device(),
      lang: cut(document.documentElement.lang || navigator.language, 10),
    };
    // insert only; visitors can never read events back
    return sb.from('events').insert(row).then(() => {}, () => {});
  }

  // every link, button and [data-track] element
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-track], a, button');
    if (!el || el.closest('[role="dialog"][aria-label="Kolačići"]')) return;
    const name = el.getAttribute('data-track') || el.id || (el.tagName === 'A' ? 'link' : 'button');
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
    const href = el.tagName === 'A' ? el.getAttribute('href') : null;
    track('click', { element: name, label: href ? label + ' → ' + href : label });
  }, { capture: true });

  // ---------- reservations ----------
  // fields: full_name, phone, email, product_slug, quantity, city, address, note, referral_code, consent (must be true)
  async function reserve(f) {
    if (!f || f.consent !== true) return { error: 'Potreban je pristanak za kontakt.' };
    const row = {
      user_id: userId,
      full_name: cut(f.full_name, 120),
      phone: cut(f.phone, 40),
      email: f.email ? cut(f.email.trim(), 160) : null,
      product_slug: f.product_slug,
      quantity: Math.max(1, Math.min(20, parseInt(f.quantity || 1, 10))),
      city: cut(f.city, 80),
      address: cut(f.address, 200),
      note: cut(f.note, 1000),
      referral_code: cut(f.referral_code || utm.ref, 40),
      utm_source: cut(utm.utm_source, 80),
      utm_medium: cut(utm.utm_medium, 80),
      utm_campaign: cut(utm.utm_campaign, 120),
      session_id: sessionId(),
      consent: true,
    };
    // no .select(): guests may insert but not read the row back
    const { error } = await sb.from('reservations').insert(row);
    if (error) return { error: 'Rezervacija nije prošla. Pokušaj ponovo ili nam piši na WhatsApp.' };
    track('reserve_submit', { element: 'reservation', label: row.product_slug + ' x' + row.quantity });
    if (window.fbq) window.fbq('track', 'Lead', { content_name: row.product_slug });
    return { ok: true };
  }

  // ---------- auth (magic link) ----------
  const auth = {
    async sendLink(email, redirectPath) {
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: location.origin + (redirectPath || '/racun/') },
      });
      return error ? { error: error.message } : { ok: true };
    },
    async user() { const { data } = await sb.auth.getUser(); return data.user || null; },
    async signOut() { await sb.auth.signOut(); },
  };

  window.CP = { sb, track, reserve, auth, consent, utm };

  function boot() {
    banner();
    if (consent()) track('page_view');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
