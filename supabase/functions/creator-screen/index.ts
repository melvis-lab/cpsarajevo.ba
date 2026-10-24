// Collection Premium Sarajevo · first-round screening of creator applications
//
// POST { id } with x-cron-secret (called by the database when an applicant confirms the email) or an admin JWT.
// Claude judges how well the profile fits a perfume brand and stores: screen_fit (dobar|mozda|ne), screen_score 0-100,
// screen_reason (one Bosnian sentence). Clear misfits are moved to "odbijen" (reversible in the admin; the thank-you
// email only goes out from 1 November).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
const WORKSPACE = Deno.env.get("ANTHROPIC_WORKSPACE_ID") ?? "wrkspc_016PxM4V7oG9fmChYv4P1Dwa";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const anthropicKey = () => Deno.env.get("ANTHROPIC_API_KEY") ??
  Object.entries(Deno.env.toObject()).find(([k]) => k.replace(/[^A-Z_]/g, "") === "ANTHROPIC_API_KEY")?.[1];

// optional: bio and recent captions through the official API (only works while the Instagram token is valid)
async function igContext(handle: string) {
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!token) return null;
  const f = `business_discovery.username(${handle}){biography,followers_count,media_count,media.limit(8){caption}}`;
  try {
    const r = await fetch(`https://graph.instagram.com/v23.0/me?fields=${encodeURIComponent(f)}&access_token=${encodeURIComponent(token)}`);
    const d = (await r.json())?.business_discovery;
    if (!d) return null;
    return { bio: d.biography ?? "", followers: d.followers_count ?? null, posts: d.media_count ?? null,
      captions: (d.media?.data ?? []).map((m: any) => String(m.caption ?? "").slice(0, 200)).filter(Boolean) };
  } catch { return null; }
}

const SYSTEM = `Ti radiš prvi krug provjere prijava za program kreatora brenda Collection Premium Sarajevo (parfemi, extrait de parfum iz Pariza, otvaranje 1. januara 2027. u Sarajevu).

KOGA TRAŽIMO (10 kreatora, Sarajevo i okolina):
- Najbolji fit: ljepota, make-up, njega kože, moda i stil, lifestyle, mame i porodica, luksuz, putovanja, uređenje doma. Publika uglavnom žene 20 do 45 godina.
- Srednji fit: hrana i kafa, općeniti lifestyle bez jasne teme, humor ako je elegantan.
- Slab fit: fitness i sport, gaming, tehnologija, auto-moto, politika, prank sadržaj, muški sadržaj bez veze s njegom ili stilom.
- Uslovi: javni profil, 1.000 do 30.000 pratilaca, stvarni pratioci, stvarne objave.

ZNAKOVI LAŽNE ILI NEOZBILJNE PRIJAVE:
- ime se ne slaže s Instagram profilom ili emailom bez ikakvog objašnjenja
- prazna ili prekopirana poruka, poruka koja zvuči kao naš oglas
- 0 objava, vrlo malo pratilaca, privatan profil

Ocjena: 70 do 100 dobar fit, 40 do 69 možda, ispod 40 ne odgovara. Ocijeni prijavu. Budi pošten: ne odbijaj nekoga samo zato što nema poruke, ali tema profila (iz imena profila, poruke ili izabrane teme) je najvažnija.
Odgovori TAČNO ovako, bez ičega drugog:
<ocjena>broj od 0 do 100</ocjena>
<fit>dobar ili mozda ili ne</fit>
<razlog>jedna kratka rečenica na bosanskom, najviše 12 riječi, npr. "Fitness profil, ne odgovara parfemima." ili "Beauty i make-up, publika žene, odličan fit."</razlog>`;

async function screen(c: any) {
  const ig = await igContext(c.instagram);
  const facts = [
    `Ime i prezime: ${c.full_name}`,
    `Instagram: @${c.instagram}`,
    `Email: ${c.email}`,
    `Izabrana tema sadržaja: ${c.niche ?? "nije navedeno"}`,
    `Poruka: ${c.note ? `"${c.note}"` : "nema poruke"}`,
    c.ig_followers != null ? `Pratioci (provjereno): ${c.ig_followers}, objave: ${c.ig_posts}, angažman: ${c.ig_er ?? "?"}%` : (ig ? `Pratioci (provjereno): ${ig.followers}, objave: ${ig.posts}` : "Instagram brojevi: nisu dostupni"),
    ig?.bio ? `Bio: "${ig.bio}"` : "",
    ig?.captions?.length ? `Zadnje objave:\n- ${ig.captions.join("\n- ")}` : "",
  ].filter(Boolean).join("\n");
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY nije postavljen");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-workspace-id": WORKSPACE, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 200, system: SYSTEM, messages: [{ role: "user", content: facts }] }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const raw = ((await r.json()).content ?? []).map((x: any) => x.text ?? "").join("");
  const tag = (n: string) => raw.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? "";
  let score = Math.max(0, Math.min(100, parseInt(tag("ocjena"), 10) || 0));
  // the label always follows the score, so the admin never shows "maybe" next to 30
  let fit = score >= 70 ? "dobar" : score >= 40 ? "mozda" : "ne";
  let reason = tag("razlog").replace(/\s*[—–]\s*/g, ", ").slice(0, 200);
  // hard rules from verified numbers
  const fol = c.ig_followers ?? ig?.followers, posts = c.ig_posts ?? ig?.posts;
  if (posts === 0 || (fol != null && fol < 500)) { fit = "ne"; score = Math.min(score, 15); reason = `Premalo pratilaca ili nema objava (${fol ?? "?"} pratilaca, ${posts ?? "?"} objava).`; }
  return { screen_score: score, screen_fit: fit, screen_reason: reason };
}

async function allowed(req: Request) {
  const c = req.headers.get("x-cron-secret");
  if (c) { const { data } = await sb.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle(); if (data?.value && c === data.value) return true; }
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const u = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await u.rpc("is_admin");
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await allowed(req))) return json({ error: "forbidden" }, 403);
  const { id, auto_reject = true } = await req.json().catch(() => ({}));
  const { data: c } = await sb.from("creators").select("*").eq("id", id).maybeSingle();
  if (!c) return json({ error: "Nema kreatora" }, 404);
  try {
    const s = await screen(c);
    const patch: Record<string, unknown> = { ...s, screened_at: new Date().toISOString() };
    // clear misfits leave the "new" pile on their own; Melvis can still pick them ("Ipak odaberi")
    if (auto_reject && c.status === "novi" && s.screen_fit === "ne") {
      patch.status = "odbijen";
      patch.admin_note = `Automatski: ${s.screen_reason}`;
    }
    await sb.from("creators").update(patch).eq("id", c.id);
    return json({ ok: true, ...s, auto_rejected: patch.status === "odbijen" });
  } catch (e) {
    await sb.from("creators").update({ screen_reason: "Provjera nije uspjela: " + String((e as Error).message).slice(0, 150), screened_at: new Date().toISOString() }).eq("id", c.id);
    return json({ ok: false, error: String((e as Error).message) });
  }
});
