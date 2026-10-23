// Collection Premium Sarajevo · sourcing engine (B2B outreach)
//
// Finds companies in BiH that could resell the perfumes (parfimerije, drogerije, butici, saloni, hoteli...)
// or buy them in bulk as New Year / holiday gifts (firme, banke, IT, agencije...), writes a personal email
// from Melvis in natural Bosnian, and sends it from melvis@hadzic.com only after Melvis approves it in the admin.
//
// POST {action, ...} with the admin's Supabase JWT (or x-cron-secret for the daily follow-up job)
//   find        {segment, city, category, count}  Claude searches the web, keeps only emails published on the company's own pages
//   check       {id} | {all:true}                 domain can receive mail (MX via DNS-over-HTTPS)
//   draft       {id}                              first email or follow-up, depending on the lead's step
//   draft_due   (cron)                            drafts follow-ups that came due this morning
//   send        {id, subject, body}               queues it in email_outbox (1 per minute, daily limit)
//   viber       {id}                              short Viber/WhatsApp message (Melvis sends it himself from his phone)
//   viber_sent  {id}                              marks it as sent on Viber
//   import      {rows:[...]}                      CSV import from a bought list or a chamber member list
//   jobs                                          last searches and how many leads they added
//   (send also takes attachments: [outreach_files.id]; the first email always gets the files marked first_email)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = Deno.env.get("SITE_URL") ?? "https://collection-premium-sarajevo.netlify.app";
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
const WORKSPACE = Deno.env.get("ANTHROPIC_WORKSPACE_ID") ?? "wrkspc_016PxM4V7oG9fmChYv4P1Dwa";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const anthropicKey = () => Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY,") ??
  Object.entries(Deno.env.toObject()).find(([k]) => k.replace(/[^A-Z_]/g, "") === "ANTHROPIC_API_KEY")?.[1];

async function setting(key: string) {
  const { data } = await sb.from("sourcing_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? "") as string;
}
async function cronSecret() {
  const { data } = await sb.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle();
  return data?.value as string | undefined;
}
async function isAdmin(req: Request) {
  const cron = req.headers.get("x-cron-secret");
  if (cron && cron === (await cronSecret())) return true;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const u = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await u.rpc("is_admin");
  return data === true;
}

// ---------- Claude ----------
async function claude(system: string, user: string, opts: { tools?: any[]; max?: number } = {}) {
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY nije postavljen");
  const headers: Record<string, string> = { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-workspace-id": WORKSPACE, "content-type": "application/json" };
  if (opts.tools?.some((x) => x.name === "web_fetch")) headers["anthropic-beta"] = "web-fetch-2025-09-10";
  let messages: any[] = [{ role: "user", content: user }];
  // server tools may pause a long turn; continue it a few times
  for (let i = 0; i < 4; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers,
      body: JSON.stringify({ model: MODEL, max_tokens: opts.max ?? 1200, system, messages, ...(opts.tools ? { tools: opts.tools } : {}) }),
    });
    if (!res.ok) {
      const t = await res.text();
      // web_fetch is newer; if this account doesn't have it, carry on with search only
      if (res.status === 400 && opts.tools?.some((x) => x.name === "web_fetch") && /web_fetch/i.test(t)) {
        opts = { ...opts, tools: opts.tools.filter((x) => x.name !== "web_fetch") }; delete headers["anthropic-beta"]; i--; continue;
      }
      throw new Error(`Claude ${res.status}: ${t.slice(0, 400)}`);
    }
    const out = await res.json();
    if (out.stop_reason === "pause_turn") { messages = [...messages, { role: "assistant", content: out.content }]; continue; }
    const text = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    if (!text.trim()) throw new Error(`Claude je vratio prazan odgovor (${out.stop_reason}; ${(out.content ?? []).map((c: any) => c.type).join(",")})`);
    return text;
  }
  throw new Error("Claude: pretraga je trajala predugo");
}
// tolerant: also accepts a missing closing tag (answer cut off at max_tokens)
const tag = (raw: string, n: string) => (raw.match(new RegExp(`<${n}>([\\s\\S]*?)(?:</${n}>|$)`))?.[1] ?? "").replace(/<\/?[a-z]+>/gi, "").trim();

// ---------- writing rules ----------
const BANNED = /(kopij|original|replik|dupe|inspirisan|\b\d+[.,]?\d*\s?(km|kn|eur|€|bam)\b)/i;
// Bosnian business mail: every paragraph and sentence starts with a capital letter, also the line after "Poštovani,"
const capitalize = (t: string) => t
  .replace(/(^|\n\s*\n)(\s*)(?!https?:|www\.)(\p{Ll})/gu, (_m, a, b, c) => a + b + c.toUpperCase())
  .replace(/(?<!\d)(?<!\b(?:npr|tj|br|god|str|ul|itd))([.!?])( +)(\p{Ll})/gu, (_m, a, b, c) => a + b + c.toUpperCase());
const clean = (t: string) => capitalize(t.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").replace(/[ \t]+\n/g, "\n").trim());

const STYLE = `KAKO PIŠEŠ:
- Pišeš kao Melvis lično, u prvom licu, kao čovjek koji šalje email drugom čovjeku. Nije reklama, nije newsletter.
- Bosanski jezik, ijekavica, kako se stvarno piše u poslovnim mailovima u Sarajevu. Persiraš (Vi/vaš), ali toplo i jednostavno.
- Kratke rečenice. Bez nabrajanja s tačkama, bez naslova, bez boldanja, bez emojija, bez uzvičnika.
- Najviše 120 do 150 riječi u tijelu maila.
- Zabranjene AI fraze i fraze iz prijevoda: "nadam se da ste dobro", "želio bih vas obavijestiti", "u današnjem svijetu", "jedinstvena prilika", "ne propustite", "s velikim zadovoljstvom", "vrhunski", "luksuzno iskustvo", "podignite na viši nivo", "obogatite", "savršen spoj", "radujem se vašem odgovoru", "stojim vam na raspolaganju za sva dodatna pitanja". Ne koristi crtice (—).
- Riječi: "sedmica" (ne "tjedan"), "hiljada" (ne "tisuća"), "saradnja" (ne "suradnja"), "uslovi" (ne "uvjeti"), "kahva" samo ako ima smisla, "historija".
- NIKAD ne spominji cijene, iznose, popuste u procentima, "kopiju", "original", "inspirisano", druge brendove parfema ni dizajnere.
- Ne izmišljaj ništa što nije u činjenicama: ni rokove isporuke, ni personalizaciju, ni ekskluzivnost. Ako nešto ne znaš, ponudi da se javiš s detaljima.
- Prva rečenica nakon pozdrava je o NJIMA (šta rade, zašto baš oni), tek onda ko si ti. Ako o firmi ne znaš ništa konkretno, kratko i iskreno: zašto ti se čini da bi im ovo odgovaralo.
- Jedan jasan i lagan sljedeći korak na kraju (kratak sastanak, da svratiš s testerima, ili da pošalješ ponudu). Nema pritiska.
- Svaka rečenica i svaki pasus počinju VELIKIM slovom. I prvi pasus poslije pozdrava: "Poštovani," pa novi red i "Vidio sam..." (ne "vidio sam...").
- Pozdrav: "Poštovani," ili "Poštovana gospođo X," / "Poštovani gospodine X," ako znaš ime kontakt osobe. Kraj: "Srdačan pozdrav," pa samo "Melvis" (potpis se dodaje automatski).`;

const EXAMPLE_RESELLER = `Primjer tona (preprodavač, ne kopiraj doslovno):
Predmet: Parfemi iz Pariza za vašu parfimeriju

Poštovani,

Pogledao sam vašu ponudu na Ferhadiji i vidim da držite mirise koje ljudi kupuju i za sebe i za poklon. Zato vam se javljam.

Zovem se Melvis Hadžić. Rođen sam u Rotterdamu, a nedavno sam se preselio u Sarajevo da otvorim Collection Premium Sarajevo, službenog partnera francuske kuće Collection Premium Paris. Imamo 12 mirisa u extrait koncentraciji, u bočicama od 50 ml. Prodaja kreće 1. januara, a do tada tražimo nekoliko partnera u BiH koji bi ih imali u ponudi.

Ako vam je zanimljivo, rado svratim s testerima da ih pomirišete, bez ikakve obaveze. Uslove za preprodaju vam mogu poslati već ove sedmice.

Srdačan pozdrav,
Melvis`;

const EXAMPLE_GIFT = `Primjer tona (firma, novogodišnji pokloni, ne kopiraj doslovno):
Predmet: Novogodišnji pokloni za vaš tim

Poštovani,

Kraj godine je blizu i pretpostavljam da i kod vas razmišljate šta pokloniti zaposlenima i klijentima. Zato vam pišem.

Zovem se Melvis Hadžić. Nedavno sam se iz Holandije preselio u Sarajevo i otvaram Collection Premium Sarajevo, službenog partnera francuske kuće Collection Premium Paris. Imamo 12 mirisa u extrait koncentraciji, bočice od 50 ml u poklon kutiji. Parfem je poklon koji se koristi svaki dan i ostane u sjećanju duže od korpe ili kalendara.

Ako planirate poklone ove godine, javite mi okvirni broj komada i do kada vam trebaju, pa vam pošaljem ponudu za tu količinu. Mogu i doći da mirise vidite i pomirišete.

Srdačan pozdrav,
Melvis`;

// personal sign-up link: the price list goes only to companies that register
const regLink = (lead: any) => `${SITE}/racun/?registracija=1&tip=${lead.segment === "poklon" ? "firma" : "preprodavac"}${lead.email ? "&email=" + encodeURIComponent(lead.email) : ""}`;

async function draftFor(lead: any) {
  const [ome, ponuda] = await Promise.all([setting("o_meni"), setting("ponuda")]);
  const followup = lead.step >= 1;
  let prev = "";
  if (followup) {
    const { data } = await sb.from("lead_log").select("subject,body").eq("lead_id", lead.id).like("kind", "poslano_%").order("created_at", { ascending: false }).limit(1);
    prev = data?.[0] ? `Predmet: ${data[0].subject}\n\n${data[0].body}` : "";
  }
  const system = `Pišeš poslovne emailove u ime Melvisa Hadžića. Jedini cilj: da firma odgovori.

O MELVISU (koristi samo ovo):
${ome}

ČINJENICE O PONUDI (samo ovo smiješ tvrditi):
${ponuda}
Web stranica: ${SITE}

${STYLE}

${lead.segment === "poklon" ? EXAMPLE_GIFT : EXAMPLE_RESELLER}

Vrati SAMO:
<predmet>predmet maila, najviše 7 riječi, bez dvotačke na kraju, bez "Ponuda" i bez velikih slova u svakoj riječi</predmet>
<tijelo>tijelo maila, od pozdrava do "Srdačan pozdrav,\\nMelvis"</tijelo>`;
  const who = [
    `Firma: ${lead.company}`, lead.category && `Djelatnost: ${lead.category}`, lead.city && `Grad: ${lead.city}`,
    lead.contact_name && `Kontakt osoba: ${lead.contact_name}`, lead.website && `Web: ${lead.website}`,
    lead.about && `Šta znamo o njima: ${lead.about}`, lead.note && `Melvisova bilješka: ${lead.note}`,
    `Link za registraciju (napiši ga tačno ovako, sam u svom redu): ${regLink(lead)}`,
  ].filter(Boolean).join("\n");
  const extra = followup
    ? " Kratko ih podsjeti da se registruju preko linka da bi prvi dobili cjenovnik."
    : " U jednoj rečenici spomeni da u prilogu šalješ katalog sa svih 12 mirisa, a u njemu su i novi travel spray od 10 ml i 7 mirisa za dom od 250 ml. Zamoli ih da se registruju na stranici preko linka, jer cjenovnik uskoro šaljemo samo registrovanim firmama. Registracija je besplatna. Link stavi sam u svom redu, prije pozdrava.";
  const task = followup
    ? `Ovo je KRATAK podsjetnik (najviše 60 riječi) firmi koja nije odgovorila na prvi mail prije nekoliko dana. Ne ponavljaj cijeli prvi mail. Ljubazno, bez prigovora što nisu odgovorili, jedna nova korisna rečenica (npr. da se pokloni za kraj godine naručuju ranije, ili da možeš ostaviti uzorke), i lako pitanje na koje se odgovara jednom rečenicom. Predmet počinje s "Re: " i ponavlja stari predmet.\n\nPrvi mail:\n${prev}`
    : /^veleprodaja/i.test(lead.category || "")
      ? "Napiši PRVI mail ovoj firmi: to je veleprodaja, distributer, lanac ili agencija za poklone. Pitaš da li bi htjeli uvrstiti mirise u svoj asortiman i nuditi ih svojim kupcima ili poslovnicama širom BiH. Ponudi kratak sastanak s testerima i katalogom. Ne obećavaj ekskluzivu ni rabate."
      : lead.segment === "poklon"
      ? "Napiši PRVI mail ovoj firmi: nudiš parfeme kao novogodišnje i praznične poklone za zaposlene i klijente, u većim količinama." + (/^velika firma/i.test(lead.category || "") ? " Firma je velika: spomeni da možete pripremiti poklone za veći broj zaposlenih i dogovoriti dostavu na više lokacija." : "") + " NE spominji da javna prodaja počinje 1. januara (pokloni im trebaju prije)."
      : "Napiši PRVI mail ovoj firmi: pitaš da li bi htjeli biti preprodavač (imati mirise u ponudi).";
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await claude(system, `${task}${extra}\n\n${who}`, { max: 3000 });
    last = raw;
    let subject = clean(tag(raw, "predmet")).replace(/^predmet:\s*/i, "");
    let body = clean(tag(raw, "tijelo"));
    if (!body) {                       // no tags: take "Predmet: ..." line and the rest
      const m = raw.match(/Predmet:\s*(.+)\n+([\s\S]+)/i);
      if (m) { subject = subject || clean(m[1]); body = clean(m[2].replace(/<\/?[a-z]+>/gi, "")); }
    }
    if (subject && body && /Melvis[^\n]*\s*$/.test(body)) return { subject, body, warn: BANNED.test(subject + " " + body) ? "Provjeri tekst: spominje cijenu ili zabranjenu riječ." : null };
  }
  throw new Error(`Claude nije vratio mail, pokušaj ponovo (${last.slice(0, 160).replace(/\s+/g, " ")})`);
}

// short Viber / WhatsApp message for companies that only list a mobile number
async function viberFor(lead: any) {
  const [ome, ponuda] = await Promise.all([setting("o_meni"), setting("ponuda")]);
  const system = `Pišeš kratku Viber poruku u ime Melvisa Hadžića firmi koju ne poznaje. Cilj: da odgovore jednom rečenicom.

O MELVISU: ${ome}
ČINJENICE (samo ovo): ${ponuda}

PRAVILA:
- Bosanski, ijekavica, persiraš, prirodno kao što čovjek piše na Viberu poslovnom kontaktu. 35 do 60 riječi, dva ili tri kratka pasusa.
- Počni s "Dobar dan," pa odmah ko si (ime i jedna rečenica), pa zašto pišeš baš njima, pa jedno lagano pitanje.
- Bez linkova, bez emojija, bez uzvičnika, bez cijena, bez crtica (—), bez "kopija/original/inspirisano", bez AI fraza.
- ${lead.segment === "poklon" ? "Tema: parfemi kao novogodišnji pokloni za zaposlene ili klijente. Ne spominji datum otvaranja." : "Tema: da li bi htjeli imati mirise u ponudi (preprodaja). Ponudi da svratiš s testerima."}
- Završi s "Melvis, Collection Premium Sarajevo".
Vrati SAMO tekst poruke unutar <poruka></poruka>.`;
  const who = [`Firma: ${lead.company}`, lead.category && `Djelatnost: ${lead.category}`, lead.city && `Grad: ${lead.city}`,
    lead.contact_name && `Kontakt: ${lead.contact_name}`, lead.about && `O njima: ${lead.about}`].filter(Boolean).join("\n");
  const raw = await claude(system, who, { max: 1500 });
  const text = clean(tag(raw, "poruka") || raw.replace(/<\/?[a-z]+>/gi, ""));
  if (!text) throw new Error("Claude nije vratio poruku");
  return { text, warn: BANNED.test(text) ? "Provjeri tekst: spominje cijenu ili zabranjenu riječ." : null };
}

// ---------- finding companies ----------
const SEGMENT_HINT: Record<string, string> = {
  preprodavac: "firme koje bi mogle PREPRODAVATI parfeme: parfimerije, drogerije, kozmetičke radnje, butici i concept store, saloni ljepote i frizerski saloni s prodajom, apoteke s kozmetikom, hotelski shopovi, poklon radnje. Preskoči cvjećare, štamparije, firme za odjeću bez kozmetike i firme koje parfeme nikad ne bi držale.",
  poklon: "firme koje kupuju NOVOGODIŠNJE POKLONE za zaposlene i klijente u većim količinama: banke, osiguranja, IT i softverske firme, telekomi, advokatske i konsultantske kancelarije, marketinške agencije, auto saloni, nekretnine, veće proizvodne i trgovinske firme, hoteli",
  // stored as segment "preprodavac", category starts with "Veleprodaja"
  veleprodaja: "VELEPRODAJA I LANCI koji kupuju veće količine i dalje prodaju širom BiH: distributeri i uvoznici parfema i kozmetike (djelatnost 46.45 trgovina na veliko parfemima i kozmetikom), veledrogerije i veleprodaje kozmetike, lanci parfumerija i drogerija s nabavkom u BiH, lanci apoteka, duty free i aerodromski shopovi, lanci hotela, veći online shopovi kozmetike, agencije za korporativne poklone i promotivni materijal (one prodaju poklone firmama). Traži firme s više poslovnica ili s prodajom po cijeloj BiH. Kontakt: nabavka@, prodaja@, komercijala@ ili ime direktora/komercijaliste ako je javno.",
  // stored as segment "poklon"
  korporacije: "NAJVEĆE FIRME u BiH (po prihodu ili broju zaposlenih, npr. s rang lista najvećih firmi FIA/APIF, CompanyWall, Bisnode) koje kupuju poklone za stotine zaposlenih ili ključne klijente: banke, telekomi, osiguranja, elektroprivrede, trgovački lanci, farmacija, IT firme s više od 100 zaposlenih, proizvođači, naftne kompanije. Kontakt: HR, marketing ili ured uprave (hr@, marketing@, kabinet@, info@).",
};
const SEGMENT_DB: Record<string, string> = { preprodavac: "preprodavac", poklon: "poklon", veleprodaja: "preprodavac", korporacije: "poklon" };
const FIND_SYSTEM = `Ti si istraživač koji pronalazi stvarne firme u Bosni i Hercegovini za poslovnu saradnju. Imaš alat za pretragu weba, a ako imaš i web_fetch, otvori kontakt stranicu firme da vidiš email svojim očima.

PRAVILA:
- Svaka firma mora stvarno postojati i raditi danas. Provjeri na njenoj vlastitoj web stranici, Facebook ili Instagram stranici.
- Email uzimaš SAMO ako je javno objavljen na vlastitoj stranici firme (kontakt stranica, footer, Facebook "About"). Nikad ga ne pogađaj i ne sastavljaj (ne izmišljaj info@domena). Ako emaila nema, ostavi prazno.
- Prednost imaju opći poslovni emailovi (info@, prodaja@, kontakt@, marketing@, hr@ za poklone zaposlenima) umjesto ličnih.
- Telefon također uzmi samo ako je javno objavljen. Mobilni brojevi (060 do 067) su posebno korisni jer im možemo pisati na Viber. Firma bez emaila ali s javnim mobilnim brojem je dobra.
- U "izvor" stavi tačan URL stranice gdje si vidio email ili telefon.
- "o_njima" je jedna kratka rečenica na bosanskom o tome šta firma radi i zašto je dobra za ovu saradnju (konkretno: lokacija, šta prodaju, veličina tima...).
- Preskoči lance koji sigurno imaju centralnu nabavku u inostranstvu (npr. velike međunarodne drogerije), osim ako je cilj poklon za zaposlene.
- Ne ponavljaj firme s liste "već imamo".

Na kraju vrati SAMO JSON niz unutar <firme></firme>:
<firme>[{"firma":"","djelatnost":"","grad":"","web":"","email":"","telefon":"","kontakt_osoba":"","o_njima":"","izvor":""}]</firme>`;

// Read the JSON list even when the answer was cut off: keep every complete {...} object.
function parseFirms(raw: string): any[] {
  const body = tag(raw, "firme") || raw;
  try { const v = JSON.parse(body); if (Array.isArray(v)) return v; } catch { /* fall through */ }
  const out: any[] = [];
  let depth = 0, start = -1, inStr = false, escNext = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (escNext) escNext = false; else if (c === "\\") escNext = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}" && depth > 0) { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(body.slice(start, i + 1))); } catch { /* skip broken one */ } start = -1; } }
  }
  return out;
}
const normName = (s: string) => s.toLowerCase().replace(/\b(d\.?\s?o\.?\s?o\.?|d\.?\s?d\.?|a\.?\s?d\.?|s\.?\s?p\.?|obrt)\b/g, "").replace(/[^a-z0-9čćšđž]+/g, " ").trim();

async function runFind(job: number, p: { segment: string; city: string; category?: string; count?: number }) {
  const n = Math.min(Math.max(Number(p.count) || 10, 3), 15);
  const wide = p.segment === "veleprodaja" || p.segment === "korporacije";
  const city = (p.city || "").trim();
  const allBih = !city || /^(bih|cijela bih|sve|bosna)/i.test(city);
  try {
    const { data: have } = await sb.from("leads").select("company").limit(2000);
    const knownSet = new Set((have ?? []).map((r: any) => normName(r.company)));
    const known = (have ?? []).map((r: any) => r.company).join("; ").slice(0, 6000);
    const where = allBih ? "cijela Bosna i Hercegovina" : `${city} (BiH)${wide ? ", a ako ih tamo nema dovoljno, i sjedišta u drugim gradovima BiH koja pokrivaju taj grad" : ""}`;
    const prompt = `Pronađi ${n} firmi. Područje: ${where}.
Tip: ${SEGMENT_HINT[p.segment] ?? SEGMENT_HINT.preprodavac}${p.category ? `\nFokus na: ${p.category}.` : ""}
Polje "o_njima" najviše 25 riječi. Ne piši ništa izvan <firme></firme> osim kratkih bilješki dok tražiš.
Već imamo (ne ponavljaj): ${known || "ništa"}`;
    const raw = await claude(FIND_SYSTEM, prompt, { max: 16000, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: wide ? 8 : 6 }, { type: "web_fetch_20250910", name: "web_fetch", max_uses: 8, max_content_tokens: 5000 }] });
    const list = parseFirms(raw);
    if (!list.length) throw new Error("Claude nije vratio listu firmi. Pokušaj ponovo s manjim brojem (5 ili 10).");
    const dbSeg = SEGMENT_DB[p.segment] ?? "preprodavac";
    let added = 0, dup = 0;
    for (const f of list) {
      if (!f?.firma) continue;
      const key = normName(String(f.firma));
      if (knownSet.has(key)) { dup++; continue; }
      knownSet.add(key);
      const email = String(f.email ?? "").trim().toLowerCase().replace(/^mailto:/, "");
      // keep the filter clean: "Sarajevo (Ilidža)" -> "Sarajevo", the area goes into "about"
      let fc = String(f.grad || city || "").trim();
      let about = f.o_njima || null;
      const m = fc.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
      if (m) { fc = m[1].trim(); about = [about, "Lokacija: " + m[2]].filter(Boolean).join(" "); }
      const cat = p.segment === "veleprodaja" ? "Veleprodaja / lanac" + (f.djelatnost ? ": " + f.djelatnost : "")
        : p.segment === "korporacije" ? "Velika firma" + (f.djelatnost ? ": " + f.djelatnost : "") : (f.djelatnost || p.category || null);
      const row = {
        company: String(f.firma).trim(), segment: dbSeg, category: cat,
        city: fc || null, website: f.web || null, email: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : null,
        phone: f.telefon || null, contact_name: f.kontakt_osoba || null, about, source_url: f.izvor || null,
        source: "Claude web pretraga", found_by: "claude",
      };
      const { data: ins, error } = await sb.from("leads").insert(row).select("id,email").maybeSingle();
      if (!error && ins) { added++; if (ins.email) await checkLead(ins.id, ins.email); }
    }
    await sb.from("lead_log").update({ detail: JSON.stringify({ ...p, gotovo: true, nadjeno: list.length, dodano: added, duplikati: dup }) }).eq("id", job);
  } catch (e) {
    await sb.from("lead_log").update({ detail: JSON.stringify({ ...p, gotovo: true, greska: String((e as Error)?.message ?? e).slice(0, 300) }) }).eq("id", job);
  }
}

// ---------- email check ----------
const FREE = /@(gmail|hotmail|outlook|yahoo|live|icloud|bih\.net|net\.hr)\./i;
async function checkLead(id: number, email: string) {
  const domain = email.split("@")[1];
  let ok = false, note = "";
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`);
    const d = await r.json();
    ok = d.Status === 0 && (d.Answer ?? []).some((a: any) => a.type === 15);
    note = ok ? (FREE.test(email) ? "Ispravan (privatni mail servis)" : "Ispravan") : "Domena ne prima emailove";
  } catch { note = "Provjera nije uspjela"; }
  await sb.from("leads").update({ email_ok: ok, email_check: note, updated_at: new Date().toISOString() }).eq("id", id);
  return { ok, note };
}

// ---------- actions ----------
async function action(body: any) {
  const a = body.action;

  if (a === "find") {
    // one search at a time: a double click used to start two identical searches
    const { data: open } = await sb.from("lead_log").select("id,created_at,detail").eq("kind", "pretraga")
      .gt("created_at", new Date(Date.now() - 6 * 60000).toISOString()).order("created_at", { ascending: false }).limit(5);
    const running = (open ?? []).find((j: any) => { try { return !JSON.parse(j.detail || "{}").gotovo; } catch { return false; } });
    if (running) return json({ started: running.id, already: true });
    const { data: job } = await sb.from("lead_log").insert({ kind: "pretraga", detail: JSON.stringify({ ...body, gotovo: false }) }).select("id").single();
    // @ts-ignore EdgeRuntime exists on Supabase
    EdgeRuntime.waitUntil(runFind(job!.id, body));
    return json({ started: job!.id });
  }
  if (a === "jobs") {
    const { data } = await sb.from("lead_log").select("id,created_at,detail").eq("kind", "pretraga").order("created_at", { ascending: false }).limit(10);
    return json({ jobs: (data ?? []).map((j: any) => {
      const d = JSON.parse(j.detail || "{}");
      // the background worker has a time limit; a search that never reported back was stopped
      if (!d.gotovo && Date.now() - new Date(j.created_at).getTime() > 7 * 60000) { d.gotovo = true; d.greska = "Pretraga je prekinuta (trajala predugo). Pokušaj ponovo s 5 ili 10 firmi."; }
      return { id: j.id, at: j.created_at, ...d };
    }) });
  }
  if (a === "check") {
    const q = sb.from("leads").select("id,email").not("email", "is", null);
    const { data } = body.all ? await q.is("email_ok", null).limit(100) : await q.eq("id", body.id);
    const out = [];
    for (const l of data ?? []) out.push({ id: l.id, ...(await checkLead(l.id, l.email)) });
    return json({ checked: out });
  }
  if (a === "import") {
    // also reads CompanyWall / komora exports: naziv, mjesto/sjediste, djelatnost, prihod, broj_zaposlenih
    const { data: have } = await sb.from("leads").select("company").limit(5000);
    const seen = new Set((have ?? []).map((x: any) => normName(x.company)));
    const rows = (body.rows ?? []).slice(0, 2000).map((r: any) => {
      const seg = String(r.segment ?? "").toLowerCase();
      const extra = [r.prihod && `Prihod: ${r.prihod}`, (r.broj_zaposlenih ?? r.zaposleni) && `Zaposleni: ${r.broj_zaposlenih ?? r.zaposleni}`].filter(Boolean).join(", ");
      const dj = r.category ?? r.djelatnost ?? null;
      return {
        company: String(r.company ?? r.firma ?? r.naziv ?? "").trim(),
        segment: /poklon|korpor/.test(seg) ? "poklon" : "preprodavac",
        category: /veleprod/.test(seg) ? "Veleprodaja / lanac" + (dj ? ": " + dj : "") : /korpor/.test(seg) ? "Velika firma" + (dj ? ": " + dj : "") : dj,
        city: r.city ?? r.grad ?? r.mjesto ?? r.sjediste ?? null, website: r.website ?? r.web ?? null,
        email: String(r.email ?? "").trim().toLowerCase() || null, phone: r.phone ?? r.telefon ?? null,
        contact_name: r.contact_name ?? r.kontakt ?? r.direktor ?? null, about: [r.about ?? r.o_njima, extra].filter(Boolean).join(" ") || null,
        source: r.source ?? body.source ?? "CSV import", found_by: "import",
      };
    }).filter((r: any) => r.company);
    let added = 0, skipped = 0;
    for (const r of rows) {
      const k = normName(r.company);
      if (seen.has(k)) { skipped++; continue; }
      seen.add(k);
      const { error } = await sb.from("leads").insert(r); error ? skipped++ : added++;
    }
    return json({ added, skipped });
  }
  if (a === "draft_due") {
    const { data } = await sb.from("leads").select("*").eq("status", "followup").is("body", null).limit(40);
    let n = 0;
    for (const l of data ?? []) {
      try { const d = await draftFor(l); await sb.from("leads").update({ subject: d.subject, body: d.body, updated_at: new Date().toISOString() }).eq("id", l.id); n++; } catch { /* next time */ }
    }
    return json({ drafted: n });
  }

  const { data: lead } = await sb.from("leads").select("*").eq("id", body.id).maybeSingle();
  if (!lead) return json({ error: "Nema te firme" }, 404);

  if (a === "viber") {
    const v = await viberFor(lead);
    await sb.from("leads").update({ viber_text: v.text, updated_at: new Date().toISOString() }).eq("id", lead.id);
    return json(v);
  }
  if (a === "viber_sent") {
    await sb.from("leads").update({ viber_sent_at: new Date().toISOString(), status: ["nova", "nacrt"].includes(lead.status) ? "poslano" : lead.status, updated_at: new Date().toISOString() }).eq("id", lead.id);
    await sb.from("lead_log").insert({ lead_id: lead.id, kind: "viber", body: body.text ?? lead.viber_text });
    return json({ ok: true });
  }
  if (a === "draft") {
    const d = await draftFor(lead);
    await sb.from("leads").update({ subject: d.subject, body: d.body, status: lead.status === "nova" ? "nacrt" : lead.status, updated_at: new Date().toISOString() }).eq("id", lead.id);
    return json(d);
  }
  if (a === "send") {
    const subject = clean(String(body.subject ?? lead.subject ?? "")), text = clean(String(body.body ?? lead.body ?? ""));
    if (!lead.email) return json({ error: "Firma nema email" }, 400);
    if (lead.email_ok === false) return json({ error: "Email ne prima poštu (provjera domene)" }, 400);
    if (["odjava", "nije_zainteresovan"].includes(lead.status)) return json({ error: "Firma je tražila da joj se više ne javljamo" }, 400);
    if (!subject || !text) return json({ error: "Prazan mail" }, 400);
    const limit = Number(await setting("dnevni_limit")) || 40;
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { count } = await sb.from("email_outbox").select("id", { count: "exact", head: true }).eq("template", "outreach").gte("created_at", since.toISOString());
    if ((count ?? 0) >= limit) return json({ error: `Dnevni limit od ${limit} mailova je dostignut. Ostatak sutra.` }, 429);
    const step = lead.step >= 1 ? 2 : 1;
    if (step === 2 && lead.step >= 2) return json({ error: "Podsjetnik je već poslan" }, 400);
    // attachments: the first email always carries the catalog, the rest is Melvis's pick
    const { data: files } = await sb.from("outreach_files").select("id,name,url,first_email").eq("active", true);
    const picked = new Set((body.attachments ?? []).map(Number));
    const att = (files ?? []).filter((f: any) => picked.has(f.id) || (step === 1 && f.first_email)).map((f: any) => ({ id: f.id, name: f.name, url: f.url }));
    const { error } = await sb.from("email_outbox").insert({
      to_email: lead.email, template: "outreach", dedupe_key: `lead-${lead.id}-${step}`,
      data: { lead_id: lead.id, step, subject, body: text, contact: lead.contact_name, attachments: att },
    });
    if (error) return json({ error: error.code === "23505" ? "Ovaj mail je već u redu za slanje" : error.message }, 400);
    await sb.from("leads").update({ subject, body: text, status: "u_redu", attachments: att.map((a: any) => a.id), updated_at: new Date().toISOString() }).eq("id", lead.id);
    return json({ queued: true, step, attachments: att.map((a: any) => a.name) });
  }
  return json({ error: "nepoznata akcija" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await isAdmin(req))) return json({ error: "forbidden" }, 403);
  try { return await action(await req.json()); }
  catch (e) { return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500); }
});
