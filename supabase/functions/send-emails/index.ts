// Collection Premium Sarajevo · email sender
// POST (x-cron-secret) -> sends queued emails from public.email_outbox via SMTP (Gmail, port 465)
// GET ?unsub=<token>   -> unsubscribes from the daily countdown and shows a small page
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SITE = Deno.env.get("SITE_URL") ?? "https://collection-premium-sarajevo.netlify.app";
const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-emails`;
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const OPENING = Date.UTC(2027, 0, 1);

// ---------- design ----------
const C = { ink: "#0e0b09", ink2: "#17120e", paper: "#f8f2e8", card: "#fffaf3", gold: "#b8935a", gold2: "#e2c58f", text: "#2a221b", muted: "#7a6b5a", line: "#e6d9c4" };
const serif = "'Playfair Display', Georgia, 'Times New Roman', serif";
const sans = "'Jost', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 6px"><tr><td style="border-radius:999px;background:${C.gold}">
  <a href="${href}" style="display:inline-block;padding:15px 34px;font-family:${sans};font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:${C.ink};text-decoration:none;font-weight:600">${esc(label)}</a></td></tr></table>`;
}
function rows(pairs: [string, unknown][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${sans};font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.muted};width:38%;vertical-align:top">${esc(k)}</td>
     <td style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${sans};font-size:15px;color:${C.text}">${esc(v)}</td></tr>`).join("")}</table>`;
}
function layout(o: { pre: string; eyebrow: string; title: string; body: string; footer?: string; hero?: string }) {
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(o.title.replace(/<[^>]+>/g, ""))}</title>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=Playfair+Display:ital,wght@0,500;1,400&display=swap" rel="stylesheet">
<style>@media only screen and (max-width:620px){.pad{padding:30px 22px 26px!important}.h1{font-size:27px!important;line-height:1.22!important}.big{font-size:66px!important}.outer{padding:14px 8px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.pre)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper}"><tr><td align="center" class="outer" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-radius:22px;overflow:hidden;background:${C.card};box-shadow:0 20px 50px -30px rgba(40,25,10,.45)">
<tr><td align="center" style="background:${C.ink};padding:30px 24px 26px">
  <a href="${SITE}"><img src="${SITE}/img/email/logo.png" width="150" alt="Collection Premium Sarajevo" style="display:block;border:0;width:150px;height:auto"></a>
</td></tr>
${o.hero ?? ""}
<tr><td style="padding:40px 44px 34px" class="pad">
  <p style="margin:0 0 12px;font-family:${sans};font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:${C.gold}">${esc(o.eyebrow)}</p>
  <h1 class="h1" style="margin:0 0 18px;font-family:${serif};font-weight:500;font-size:32px;line-height:1.18;color:${C.text}">${o.title}</h1>
  <div style="font-family:${sans};font-size:16px;line-height:1.65;color:${C.text}">${o.body}</div>
</td></tr>
<tr><td align="center" style="background:${C.ink};padding:26px 30px;font-family:${sans};font-size:12px;line-height:1.7;color:#bcae99">
  <span style="font-family:${serif};font-style:italic;font-size:15px;color:${C.gold2}">Nevidljiv oku. Nezaboravan duši.</span><br>
  Collection Premium Sarajevo · Službeni partner Collection Premium Paris<br>
  <a href="https://www.instagram.com/collectionpremiumsarajevo/" style="color:${C.gold2};text-decoration:none">Instagram</a> &nbsp;·&nbsp; <a href="${SITE}" style="color:${C.gold2};text-decoration:none">Web stranica</a>
  ${o.footer ? `<br><br>${o.footer}` : ""}
</td></tr></table>
</td></tr></table></body></html>`;
}
const p = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
const hi = (name: unknown) => (name ? `${esc(String(name).split(" ")[0])}, ` : "");
const KIND: Record<string, string> = { firma: "firma", preprodavac: "preprodavač", salon: "salon / butik", drugo: "partner", kupac: "kupac" };
const daysLeft = (d: Date) => Math.max(0, Math.round((OPENING - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000));

// a different scent and a different line every day
const LINES = [
  "Extrait de parfum je najjača koncentracija mirisa. Do 30% mirisnih ulja znači da te miris prati od jutarnje kahve do večeri.",
  "Najbolje mjesto za parfem je koža koja je topla: zapešće, vrat i iza uha. Ne trljaj zapešća, pusti da se miris sam razvije.",
  "Miris se mijenja tokom dana: prvo osjetiš početak, nakon sat vremena srce, a navečer bazu. Zato vrijedi pričekati prije nego odlučiš.",
  "Dobar poklon nije najskuplji poklon. Dobar poklon je onaj koji se pamti svaki put kad ga neko osjeti.",
  "Pariz je dao recept, Sarajevo daje dušu. Svaka bočica je napravljena da traje, a ne da se potroši za mjesec.",
  "Ako ne znaš koji miris je tvoj, kviz na stranici te vodi kroz pet pitanja i daje ti odgovor za minutu.",
  "Rezervacija je besplatna i bez obaveze. Kad otvorimo, javljamo se prvo onima koji su rezervisali.",
  "Parfem čuvaj na tamnom i hladnom mjestu, daleko od kupatila. Toplina i svjetlo su najveći neprijatelji mirisa.",
  "Na tkanini miris traje duže nego na koži. Jedan sprej na šal ili kaput i ostavljaš trag cijeli dan.",
  "Cijena se otkriva 1. januara. Svi koji rezervišu saznaju je prvi.",
  "Topli mirisi poput vanilije, ambre i ouda najljepši su u hladnim mjesecima. Svježi citrusi su za ljeto i jutra.",
  "Najljepši kompliment je kad te neko pita: šta to nosiš?",
];
type Product = { slug: string; name: string; notes_top: string | null; notes_heart: string | null; notes_base: string | null; sort: number };
let PRODUCTS: Product[] | null = null;
async function products() {
  if (!PRODUCTS) { const { data } = await sb.from("products").select("slug,name,notes_top,notes_heart,notes_base,sort").eq("active", true).order("sort"); PRODUCTS = (data ?? []) as Product[]; }
  return PRODUCTS;
}

// ---------- templates ----------
async function render(t: string, d: Record<string, any>, to: string): Promise<{ subject: string; html: string }> {
  const admin = `${SITE}/admin/`;
  switch (t) {
    case "welcome": return {
      subject: "Dobro došli u Collection Premium Sarajevo",
      html: layout({ pre: "Tvoje mjesto prije svih je osigurano. Evo šta slijedi do 1. januara.", eyebrow: "Dobrodošlica", title: `${hi(d.name)}drago nam&nbsp;je<br><em style="color:${C.gold}">što si tu.</em>`,
        body: p("Tvoj račun je otvoren. Od sada si među prvima koji saznaju sve o otvaranju Collection Premium Sarajevo, 1. januara 2027.") +
          p("<b>Šta slijedi:</b> svako jutro ti šaljemo kratko pismo s odbrojavanjem do otvaranja i jednim mirisom dana: priča, note i kako ga nositi.") +
          p("Već sada možeš rezervisati svoj miris, bez plaćanja. Ako još ne znaš koji je tvoj, kviz ti ga pronađe za minutu.") +
          button("Pronađi svoj miris", `${SITE}/?kviz=1#kviz`) +
          `<p style="margin:10px 0 0;text-align:center;font-size:14px"><a href="${SITE}/racun/" style="color:${C.gold}">Moj račun</a></p>` }) };
    case "welcome_b2b": return {
      subject: "Primili smo vašu registraciju · Collection Premium Sarajevo",
      html: layout({ pre: "Hvala na registraciji. Pregledamo je i javljamo se u roku od 2 radna dana.", eyebrow: "Registracija za firme", title: `Hvala, ${esc(d.company || d.name || "")}.`,
        body: p(`Primili smo registraciju (${esc(KIND[d.type] ?? "partner")}). Svaki partnerski račun lično pregledamo prije odobrenja.`) +
          p("<b>Šta slijedi:</b> u roku od 2 radna dana dobit ćete email s odobrenjem i daljim koracima. Do tada vam svako jutro šaljemo kratko odbrojavanje do otvaranja 1. januara.") +
          p("Ako imate pitanje odmah, odgovorite na ovaj email.") }) };
    case "approved": return {
      subject: "Vaš račun je odobren · Collection Premium Sarajevo",
      html: layout({ pre: "Dobrodošli kao partner Collection Premium Sarajevo.", eyebrow: "Odobreno", title: `Dobrodošli,<br><em style="color:${C.gold}">${esc(d.company || d.name || "partneru")}.</em>`,
        body: p("Vaš račun je odobren. Sada imate pristup partnerskom dijelu i javit ćemo vam se s ponudom i uslovima prije otvaranja 1. januara.") +
          p("Prijavite se emailom s kojim ste se registrovali. Link za prijavu stiže na vaš email.") +
          button("Prijavi se", `${SITE}/racun/`) }) };
    case "partner_approved": return {
      subject: "Dobrodošli kao partner · Collection Premium Sarajevo",
      html: layout({ pre: "Vaša prijava je odobrena. Otvorite partnerski račun u jednom koraku.", eyebrow: "Partnerstvo odobreno", title: `Dobrodošli,<br><em style="color:${C.gold}">${esc(d.company || "partneru")}.</em>`,
        body: p(`${hi(d.name)}vaša prijava za saradnju je odobrena. Radujemo se zajedničkom otvaranju 1. januara.`) +
          p("<b>Sljedeći korak:</b> otvorite partnerski račun. Račun s ovim emailom bit će odobren automatski, bez čekanja.") +
          button("Otvori partnerski račun", `${SITE}/racun/?registracija=1&tip=${encodeURIComponent(d.kind === "drugo" ? "firma" : d.kind || "firma")}&email=${encodeURIComponent(d.email || to)}`) +
          p(`<span style="color:${C.muted};font-size:14px">Javit ćemo vam se i telefonom s ponudom, testerima i mirisnim trakama za vaš prostor.</span>`) }) };
    case "rejected": return {
      subject: "Vaša registracija · Collection Premium Sarajevo",
      html: layout({ pre: "Hvala na interesu za saradnju.", eyebrow: "Registracija", title: "Hvala na interesu.",
        body: p(`${hi(d.name)}hvala što ste se prijavili. Trenutno ne možemo otvoriti partnerski račun za ${esc(d.company || "vašu firmu")}.`) +
          p("To ne mora biti zauvijek. Kad proširimo mrežu partnera, rado ćemo vam se javiti. Do tada ste dobrodošli kao kupac.") +
          button("Pogledaj kolekciju", `${SITE}/#kolekcija`) }) };
    case "partner_received": return {
      subject: "Primili smo vaš zahtjev · Collection Premium Sarajevo",
      html: layout({ pre: "Javljamo se u roku od 2 radna dana.", eyebrow: "Za firme i preprodavače", title: `Hvala, ${esc(d.company || d.name || "")}.`,
        body: p(`${hi(d.name)}primili smo vaš zahtjev za saradnju (${esc(KIND[d.kind] ?? "partner")}).`) +
          p("Javljamo se u roku od 2 radna dana. Kad odobrimo saradnju, dobit ćete email s linkom za partnerski račun.") +
          p(`<span style="color:${C.muted};font-size:14px">Pitanje? Samo odgovorite na ovaj email.</span>`) }) };
    case "reservation_confirm": return {
      subject: `Tvoj miris je rezervisan: ${d.product}`,
      html: layout({ pre: "Bez plaćanja. Javljamo se prvo tebi, prije otvaranja 1. januara.", eyebrow: "Rezervacija", title: `${esc(d.product)}<br><em style="color:${C.gold}">je tvoj.</em>`,
        hero: `<tr><td align="center" style="background:${C.paper};padding:30px 0 6px"><img src="${SITE}/img/email/${esc(d.slug)}.png" width="120" alt="${esc(d.product)}" style="display:block;border:0;width:120px;height:auto"></td></tr>`,
        body: p(`${hi(d.name)}tvoja rezervacija je zaprimljena.`) + rows([["Miris", d.product], ["Količina", d.quantity], ["Plaćanje", "Ništa sada"], ["Otvaranje", "1. januar 2027."]]) +
          p("Prije otvaranja javljamo se prvo tebi s cijenom i načinom preuzimanja ili dostave. Do tada ti svako jutro stiže kratko odbrojavanje.") +
          button("Moje rezervacije", `${SITE}/racun/`) }) };
    case "countdown": {
      const day = d.day ? new Date(d.day + "T00:00:00Z") : new Date();
      const left = daysLeft(day), list = await products();
      const idx = Math.floor(day.getTime() / 86400000);
      const pr = list.length ? list[idx % list.length] : null, line = LINES[idx % LINES.length];
      const big = left === 0 ? "Danas" : left === 1 ? "Sutra" : String(left);
      const small = left === 0 ? "otvaramo" : left === 1 ? "otvaramo" : left % 10 === 1 && left !== 11 ? "dan do otvaranja" : "dana do otvaranja";
      const subject = left === 0 ? "Danas otvaramo. Tvoj miris te čeka." : left === 1 ? "Sutra otvaramo · Collection Premium Sarajevo" : `${left} dana do 1. januara · Miris dana: ${pr?.name ?? ""}`;
      const unsub = `${FN_URL}?unsub=${d.unsub}`;
      return { subject, html: layout({
        pre: pr ? `Miris dana: ${pr.name}. ${pr.notes_top ?? ""}` : "Odbrojavanje do otvaranja.",
        eyebrow: "Odbrojavanje · 1. januar 2027.",
        hero: `<tr><td align="center" style="background:${C.ink2};padding:34px 20px 30px;border-top:1px solid #2a2017">
          <div class="big" style="font-family:${serif};font-size:84px;line-height:1;color:${C.gold2}">${big}</div>
          <div style="margin-top:8px;font-family:${sans};font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:#bcae99">${small}</div></td></tr>`,
        title: pr ? `Miris dana: <em style="color:${C.gold}">${esc(pr.name)}</em>` : "Odbrojavanje",
        body: (pr ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 10px"><tr>
            <td width="130" valign="top" style="padding-right:18px"><img src="${SITE}/img/email/${pr.slug}.png" width="110" alt="${esc(pr.name)}" style="display:block;border:0;width:110px;height:auto;border-radius:14px"></td>
            <td valign="top">${rows([["Početak", pr.notes_top], ["Srce", pr.notes_heart], ["Baza", pr.notes_base]])}</td></tr></table>` : "") +
          `<p style="margin:8px 0 0;padding:18px 20px;background:${C.paper};border-left:3px solid ${C.gold};border-radius:6px;font-family:${serif};font-style:italic;font-size:17px;line-height:1.55;color:${C.text}">${esc(line)}</p>` +
          button(pr ? `Rezerviši ${pr.name}` : "Rezerviši svoj miris", `${SITE}/?utm_source=email&utm_medium=countdown&utm_campaign=odbrojavanje#kolekcija`),
        footer: `Primaš ovo jer si se prijavio/la na odbrojavanje. <a href="${unsub}" style="color:#bcae99">Odjavi se</a>` }) };
    }
    // ---------- to Melvis ----------
    case "admin_new_account": return {
      subject: `Novi račun: ${d.full_name || d.email} (${KIND[d.account_type] ?? d.account_type})${d.approval_status === "na_cekanju" ? " · čeka odobrenje" : ""}`,
      html: layout({ pre: "Nova registracija na stranici.", eyebrow: "Admin · nova registracija", title: d.approval_status === "na_cekanju" ? "Čeka tvoje odobrenje" : "Novi korisnik",
        body: rows([["Ime", d.full_name], ["Email", d.email], ["Telefon", d.phone], ["Tip", KIND[d.account_type] ?? d.account_type], ["Firma", d.company], ["Grad", d.city], ["Status", d.approval_status === "na_cekanju" ? "Čeka odobrenje" : "Odobren"], ["Odbrojavanje", d.newsletter ? "Da" : "Ne"]]) +
          button(d.approval_status === "na_cekanju" ? "Odobri u adminu" : "Otvori admin", `${admin}#korisnici`) }) };
    case "admin_new_reservation": return {
      subject: `Nova rezervacija: ${d.product} × ${d.quantity} · ${d.name}`,
      html: layout({ pre: `${d.name} je rezervisao/la ${d.product}.`, eyebrow: "Admin · nova rezervacija", title: `${esc(d.product)} × ${esc(d.quantity)}`,
        body: rows([["Kupac", d.name], ["Telefon", d.phone], ["Email", d.email], ["Grad", d.city], ["Napomena", d.note], ["Odakle", d.source], ["Kod", d.code]]) + button("Otvori rezervacije", `${admin}#rezervacije`) }) };
    case "admin_new_partner": return {
      subject: `Nova firma: ${d.company} (${KIND[d.kind] ?? d.kind}) · čeka odobrenje`,
      html: layout({ pre: `${d.company} se registrovala kao ${KIND[d.kind] ?? d.kind}.`, eyebrow: "Admin · firme i preprodavači", title: esc(d.company),
        body: rows([["Tip", KIND[d.kind] ?? d.kind], ["Kontakt", d.contact_name], ["Telefon", d.phone], ["Email", d.email], ["Grad", d.city], ["Količina", d.volume], ["Poruka", d.note]]) + button("Odobri u adminu", `${admin}#firme`) }) };
  }
  throw new Error("unknown template " + t);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const unsub = url.searchParams.get("unsub");
  if (req.method === "GET" && unsub) {
    const { data } = await sb.rpc("unsubscribe", { p_token: unsub });
    return Response.redirect(`${SITE}/odjava/?ok=${data ? 1 : 0}`, 302);
  }
  const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle();
  if (!sec?.value || req.headers.get("x-cron-secret") !== sec.value) return new Response("forbidden", { status: 403 });

  const user = Deno.env.get("SMTP_USER") ?? "melvis@hadzic.com", pass = Deno.env.get("SMTP_PASS");
  if (!pass) return new Response(JSON.stringify({ waiting: "SMTP_PASS not set; emails stay queued" }), { status: 503 });

  const { data: jobs } = await sb.from("email_outbox").select("*").or("status.eq.pending,and(status.eq.error,attempts.lt.3)").order("created_at").limit(25);
  if (!jobs?.length) return Response.json({ sent: 0 });
  await sb.from("email_outbox").update({ status: "sending" }).in("id", jobs.map((j) => j.id));

  const client = new SMTPClient({ connection: { hostname: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } } });
  let sent = 0;
  for (const j of jobs) {
    try {
      const { subject, html } = await render(j.template, j.data ?? {}, j.to_email);
      await client.send({ from: `Collection Premium Sarajevo <${user}>`, replyTo: user, to: j.to_email, subject, html,
        headers: j.template === "countdown" ? { "List-Unsubscribe": `<${FN_URL}?unsub=${j.data?.unsub}>` } : undefined });
      await sb.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: j.attempts + 1, error: null }).eq("id", j.id);
      sent++;
    } catch (e) {
      await sb.from("email_outbox").update({ status: "error", attempts: j.attempts + 1, error: String((e as Error)?.message ?? e).slice(0, 500) }).eq("id", j.id);
    }
  }
  await client.close();
  return Response.json({ sent, of: jobs.length });
});
