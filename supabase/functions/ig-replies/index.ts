// Collection Premium Sarajevo · Instagram replies written by Claude
//
// GET  ?hub.mode=subscribe&hub.verify_token=..&hub.challenge=..  -> Meta webhook verification
// POST from Meta (X-Hub-Signature-256)                            -> new DM / comment
//      DMs: Claude answers on its own when it is sure, otherwise a draft waits in the admin panel
//      comments: ManyChat already replies publicly + sends the link; real questions get a draft for the admin
// POST {action} with the admin's Supabase JWT (or x-cron-secret)  -> send / skip / test from the admin panel
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY, META_APP_SECRET, IG_ACCESS_TOKEN
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = Deno.env.get("SITE_URL") ?? "https://collection-premium-sarajevo.netlify.app";
const GRAPH = "https://graph.instagram.com/v23.0";
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
// the API key is organisation-wide, so every call names the workspace it bills to
const WORKSPACE = Deno.env.get("ANTHROPIC_WORKSPACE_ID") ?? "wrkspc_016PxM4V7oG9fmChYv4P1Dwa";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// tolerate a stray comma or space typed into the secret name in the dashboard
const anthropicKey = () => Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY,") ??
  Object.entries(Deno.env.toObject()).find(([k]) => k.replace(/[^A-Z_]/g, "") === "ANTHROPIC_API_KEY")?.[1];

async function secret(key: string) {
  const { data } = await sb.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}

// ---------- what Claude knows ----------
// product notes use Bosnian words in replies
const BS = (t: string | null) => (t ?? "?").replace(/datulj[ae]/gi, "hurma");
const STORIES: Record<string, string> = {
  "Dubai": "topao kao jutarnja kahva na Baščaršiji i bogat kao zalazak sunca nad pustinjom; orijentalni gourmand, unisex",
  "Keos": "prije nego što se svijet probudi: šuma i magla, miran, čist i tiho siguran; više muški",
  "Alya": "zlatni sat, kad grad postane zlatan; topao, ostaje na koži do kasno u noć; više ženski",
  "Bellissima": "mamina haljina; ženstven i samouvjeren, miris koji se prenosi s generacije na generaciju",
  "Belle Parisienne": "otišla je iz Sarajeva s jednim koferom, Pariz joj je dao ostalo; svjež, cvjetni, ženski",
  "X": "prisustvo; za ljude koji uđu u prostoriju i promijene atmosferu; muški, duhan i med",
  "Love": "prvi sastanak, počela je kiša; nježan, cvjetni, romantičan",
  "Gourmand": "nanina nedjelja; toplo, slatko i sigurno",
  "Vanille": "svjež početak morske soli pa ruža i vanilija; mekan i čist",
  "Oud Secret": "tajanstven i snažan, oud i koža; za večer",
  "Safyr": "svjež citrusni, voćni, bijeli mošus; lagan za svaki dan",
  "Arabian Nights": "raskošan orijentalni, šafran, oud i ruža; za posebne prilike",
};

let KB: string | null = null;
async function knowledge() {
  if (KB) return KB;
  const { data } = await sb.from("products").select("name,notes_top,notes_heart,notes_base,size_ml").eq("active", true).order("sort");
  const list = (data ?? []).map((p: any) =>
    `- ${p.name}: ${STORIES[p.name] ?? ""}. Početak: ${BS(p.notes_top)}. Srce: ${BS(p.notes_heart)}. Baza: ${BS(p.notes_base)}. ${p.size_ml ?? 50} ml.`).join("\n");
  KB = list;
  return KB;
}

const SYSTEM = (kb: string, kind: "dm" | "comment") => `Ti odgovaraš na Instagram ${kind === "dm" ? "poruke (DM)" : "komentare"} u ime brenda Collection Premium Sarajevo, službenog partnera Collection Premium Paris u Sarajevu.

ČINJENICE (samo ovo smiješ tvrditi):
- 12 mirisa, extrait de parfum iz Pariza (najjača koncentracija, do 30% mirisnih ulja), bočice od 50 ml.
- Otvaramo 1. januara 2027. u Sarajevu.
- Cijena je zapečaćena i otkriva se 1. januara. Prvi je saznaju oni koji su rezervisali.
- Rezervacija je besplatna i bez obaveze, na stranici: ${SITE}
- Na stranici je kviz od 30 sekundi koji pomaže da nađeš svoj miris.
- Firme, saloni, butici, preprodavači i hoteli: sekcija "Za firme" na stranici (${SITE}/#partneri), javljamo se u roku od 2 radna dana.

MIRISI:
${kb}

JEZIK:
- Uvijek odgovaraj na bosanskom (ijekavica), i kad ti neko piše na srpskom ili hrvatskom.
- Na drugom jeziku (engleski, njemački, turski...) odgovaraj SAMO ako je klijent cijelu poruku napisao na tom jeziku. Jedna strana riječ ("hello", "price") nije razlog za promjenu jezika.

KAKO PIŠEŠ (najvažnije):
- Piši kao stvarna osoba iz Sarajeva koja odgovara u DM s telefona: jednostavno, toplo, opušteno, kratke rečenice. Ne kao firma i ne kao AI.
- Oslovljavaj sa "ti". Firme, salone i preprodavce oslovljavaj sa "Vi".
- 1 do 3 kratke rečenice. Bez uvoda i bez zaključka. Odmah odgovori na ono što je pitao.
- Bosanske riječi: hurma (ne datulja), kahva, narandža, hiljadu, sedmica. Pazi na padeže i rod.
- Najviše jedan emoji, i to ne u svakoj poruci. Bez crtica (— ili –), bez hashtagova, bez navodnika oko naziva mirisa, bez nabrajanja u listama.
- Zabranjene fraze (zvuče kao AI ili call centar): "Hvala na interesovanju", "Hvala na pitanju", "Rado ću pomoći", "Svakako!", "Odlično pitanje", "Odličan izbor", "Nadam se da ovo pomaže", "Slobodno se javi ako imaš još pitanja", "Stojimo na raspolaganju", "Poštovani", "S poštovanjem", "Drago nam je čuti", "lijepo je čuti".
- Ne ponavljaj sve činjenice u svakoj poruci. Reci samo ono što treba za ovo pitanje.
- Kad preporučuješ, predloži 1 ili 2 mirisa i u par riječi reci kakvi su (note ili osjećaj).
- Link daj samo kad vodi na sljedeći korak (rezervacija, kviz, firme), i to na kraju poruke.

PRIMJERI TONA:
Klijent: Koji miris za muža, voli tople mirise?
Ti: Za njega bih uzela X ili Dubai. X je med i duhanski list, a Dubai cimet, hurma i vanilija, baš za zimu. Možeš ga rezervisati bez plaćanja ovdje: ${SITE}
Klijent: Koliko košta?
Ti: Cijenu otkrivamo 1. januara, do tada je i za nas mala tajna 😊 Ko rezerviše sada, saznaje je među prvima, a rezervacija ništa ne košta: ${SITE}
Klijent: Imam butik u Banjaluci, zanima me saradnja
Ti: Super, hvala što ste se javili. Ostavite podatke na ${SITE}/#partneri i javljamo Vam se u roku od 2 radna dana s ponudom.
Klijent: Gdje ste tačno u Sarajevu?
Ti: Tačnu lokaciju još nismo objavili. Čim bude, javljamo ovdje na profilu. (status: ceka)

NIKAD:
- Ne navodi niti nagađaj cijenu, popust, raspon cijene ili poređenje cijena.
- Ne koristi riječi kopija, original, replika, dupe, inspirisan, "kao [neki drugi brend]". Ne poredi s drugim brendovima.
- Ne izmišljaj adresu, radno vrijeme, dostavu, načine plaćanja, rokove ni akcije. Ne spominji imena vlasnika ili zaposlenih.
- Ne daj medicinske savjete (alergije, trudnoća, koža).

STATUS:
- ceka: neko traži cijenu i nakon što je čuo da je zapečaćena, žali se ili je ljut, firma ili preprodavač želi uslove ili veću količinu, pita za dostavu, plaćanje, adresu, termin, original/kopiju ili nešto što nije u činjenicama, pita nešto lično ili zdravstveno, ili nisi siguran. I tada napiši najbolji prijedlog odgovora (bez izmišljanja), da ga vlasnik samo odobri ili doradi.
- preskoci: poruka ne traži odgovor (samo emoji, "hvala", spam, reklama, uvreda bez pitanja).
- auto: sve ostalo, kad si siguran da je odgovor tačan i u duhu pravila.

Odgovori TAČNO u ovom obliku, bez ičega drugog:
<odgovor>tekst poruke koju šaljemo klijentu</odgovor>
<status>auto ili ceka ili preskoci</status>
<razlog>kratko zašto, na bosanskom</razlog>`;

async function askClaude(kind: "dm" | "comment", text: string, history: { status: string; text: string | null; draft: string | null }[]) {
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY nije postavljen");
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  const push = (role: "user" | "assistant", content: string) => {
    if (!content) return;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + content;
    else msgs.push({ role, content });
  };
  // each stored row is one incoming message plus the reply we actually sent (if any)
  for (const h of history) {
    push("user", h.text ?? "");
    if ((h.status === "poslano_auto" || h.status === "poslano") && h.draft)
      push("assistant", `<odgovor>${h.draft}</odgovor>\n<status>auto</status>\n<razlog></razlog>`);
  }
  if (msgs.length && msgs[0].role === "assistant") msgs.shift();
  if (msgs.length && msgs[msgs.length - 1].role === "user") msgs[msgs.length - 1].content += "\n" + text;
  else msgs.push({ role: "user", content: text });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-workspace-id": WORKSPACE, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, system: SYSTEM(await knowledge(), kind), messages: msgs }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  const raw = (out.content ?? []).map((c: any) => c.text ?? "").join("");
  const tag = (n: string) => raw.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]?.trim();
  const status = (tag("status") ?? "").toLowerCase();
  const r = tag("odgovor") !== undefined
    ? { reply: tag("odgovor"), needs_human: status !== "auto" && status !== "preskoci", skip: status === "preskoci", reason: tag("razlog") ?? "" }
    : { reply: raw.trim(), needs_human: true, skip: false, reason: "Odgovor nije bio u očekivanom obliku" };
  let reply = String(r.reply ?? "").replace(/\s*[—–]\s*/g, ", ").trim();
  // last safety net for brand rules
  const banned = /(kopij|original|replik|dupe|inspirisan|\d+\s?(km|kn|eur|€|bam)\b)/i;
  let needs = !!r.needs_human, reason = r.reason ?? "";
  if (banned.test(reply)) { needs = true; reason = (reason ? reason + "; " : "") + "odgovor je spomenuo zabranjenu riječ ili cijenu"; }
  return { reply, needs_human: needs, skip: !!r.skip && !needs, reason };
}

// ---------- Instagram ----------
async function igSendDM(igUserId: string, text: string) {
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!token) throw new Error("IG_ACCESS_TOKEN nije postavljen");
  const res = await fetch(`${GRAPH}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: igUserId }, message: { text } }),
  });
  if (!res.ok) throw new Error(`Instagram ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
async function igReplyComment(commentId: string, text: string) {
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!token) throw new Error("IG_ACCESS_TOKEN nije postavljen");
  const res = await fetch(`${GRAPH}/${commentId}/replies`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });
  if (!res.ok) throw new Error(`Instagram ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
async function igUsername(igUserId: string) {
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!token) return null;
  try {
    const r = await fetch(`${GRAPH}/${igUserId}?fields=username&access_token=${encodeURIComponent(token)}`);
    if (!r.ok) return null;
    return (await r.json()).username ?? null;
  } catch { return null; }
}
async function validSignature(raw: string, header: string | null) {
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(raw)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function notifyAdmin(row: { id: number; kind: string; username: string | null; text: string | null; draft: string | null; reason: string | null }) {
  await sb.from("email_outbox").insert({
    to_email: "melvis@hadzic.com", template: "admin_ig_message", dedupe_key: `ig:${row.id}`,
    data: { kind: row.kind, username: row.username, text: row.text, draft: row.draft, reason: row.reason },
  });
}

// ---------- creators: fixed replies, no Claude needed ----------
// "CPS-1234" verifies a creator (the database trigger marks the profile), "KREATOR" gets the sign-up link.
const CODE = /CPS[\s-]?(\d{4})/i;
async function creatorReply(text: string, username: string | null): Promise<string | null> {
  const m = text.match(CODE);
  if (m) {
    const code = "CPS-" + m[1];
    const { data: c } = await sb.from("creators").select("full_name,instagram,dm_verified_at").eq("verify_code", code).maybeSingle();
    if (!c) return `Kod ${code} ne prepoznajemo. Provjeri kod iz emaila ili se prijavi ovdje: ${SITE}/kreatori/`;
    const first = String(c.full_name ?? "").split(" ")[0];
    if (username && username.toLowerCase() !== c.instagram) {
      return `Kod ${code} je prijavljen za profil @${c.instagram}, a poruka je stigla s @${username}. Pošalji kod s profila @${c.instagram} da potvrdiš prijavu.`;
    }
    return `Hvala${first ? ", " + first : ""}! Profil @${c.instagram} je potvrđen i tvoja prijava za kreatore je kompletna. Lično pregledamo profile i javljamo se emailom nakon 31. oktobra 🤍`;
  }
  if (/^\W*kreator(ka|i)?\W*$/i.test(text) || (/kreator/i.test(text) && text.length <= 60 && !/\?/.test(text))) {
    return `Super, drago nam je! Prijava za kreatore traje dvije minute: ${SITE}/kreatori/ Nakon prijave dobiješ kod koji nam pošalješ ovdje u poruci, i to je to. Prijave traju do 31. oktobra.`;
  }
  return null;
}

// ---------- handlers ----------
async function handleDM(ownId: string, ev: any) {
  const senderId = ev.sender?.id, msg = ev.message;
  if (!senderId || senderId === ownId || !msg || msg.is_echo || msg.is_deleted) return;
  if (ev.postback || msg.quick_reply) return;              // ManyChat buttons
  const text = (msg.text ?? "").trim();
  if (!text) return;                                       // stickers, photos, story reactions

  const username = await igUsername(senderId);
  const { data: row, error } = await sb.from("ig_messages")
    .insert({ kind: "dm", direction: "in", ig_user_id: senderId, username, mid: msg.mid, text })
    .select("id").single();
  if (error) return;                                       // duplicate delivery from Meta

  const fixed = await creatorReply(text, username).catch(() => null);
  if (fixed) {
    try {
      await igSendDM(senderId, fixed);
      await sb.from("ig_messages").update({ status: "poslano_auto", draft: fixed, reason: "Kreatori: automatski odgovor", sent_at: new Date().toISOString() }).eq("id", row.id);
    } catch (e) {
      await sb.from("ig_messages").update({ status: "greska", draft: fixed, error: String(e).slice(0, 500) }).eq("id", row.id);
    }
    return;
  }

  const { data: hist } = await sb.from("ig_messages").select("status,text,draft")
    .eq("ig_user_id", senderId).lt("id", row.id).in("status", ["poslano_auto", "poslano", "nova", "ceka", "preskoceno"])
    .order("created_at", { ascending: false }).limit(8);

  try {
    const ai = await askClaude("dm", text, (hist ?? []).reverse());
    if (ai.skip) {
      await sb.from("ig_messages").update({ status: "preskoceno", draft: ai.reply || null, reason: ai.reason }).eq("id", row.id);
      return;
    }
    const auto = (await secret("ig_ai_auto_send")) === "true";
    if (!ai.needs_human && auto && ai.reply) {
      await igSendDM(senderId, ai.reply);
      await sb.from("ig_messages").update({ status: "poslano_auto", draft: ai.reply, reason: ai.reason, sent_at: new Date().toISOString() }).eq("id", row.id);
    } else {
      const reason = ai.needs_human ? ai.reason : "Automatsko slanje je isključeno";
      await sb.from("ig_messages").update({ status: "ceka", draft: ai.reply, reason }).eq("id", row.id);
      await notifyAdmin({ id: row.id, kind: "dm", username, text, draft: ai.reply, reason });
    }
  } catch (e) {
    await sb.from("ig_messages").update({ status: "greska", error: String(e).slice(0, 500) }).eq("id", row.id);
  }
}

const QUESTION = /\?|koliko|cijen|cena|gdje|gde|kad[a]?\b|dostav|šalje|salje|kako|može li|moze li|imate li|price|how much|where|when/i;
async function handleComment(ownId: string, v: any) {
  const fromId = v.from?.id, text = (v.text ?? "").trim();
  if (!fromId || fromId === ownId || !text || v.parent_id) return;  // skip our own replies and replies in threads
  const { data: row, error } = await sb.from("ig_messages")
    .insert({ kind: "comment", direction: "in", ig_user_id: fromId, username: v.from?.username ?? null, media_id: v.media?.id ?? null, comment_id: v.id, mid: "c_" + v.id, text, status: "preskoceno", reason: "ManyChat je odgovorio" })
    .select("id").single();
  if (error || !QUESTION.test(text)) return;
  try {
    const ai = await askClaude("comment", text, []);
    if (ai.skip) return;
    await sb.from("ig_messages").update({ status: "ceka", draft: ai.reply, reason: ai.reason || "Komentar sa pitanjem" }).eq("id", row.id);
    await notifyAdmin({ id: row.id, kind: "comment", username: v.from?.username ?? null, text, draft: ai.reply, reason: ai.reason || "Komentar sa pitanjem" });
  } catch (e) {
    await sb.from("ig_messages").update({ status: "greska", error: String(e).slice(0, 500) }).eq("id", row.id);
  }
}

async function processWebhook(body: any) {
  for (const entry of body.entry ?? []) {
    const ownId = String(entry.id ?? "");
    for (const ev of entry.messaging ?? []) await handleDM(ownId, ev);
    for (const ch of entry.changes ?? []) if (ch.field === "comments") await handleComment(ownId, ch.value ?? {});
  }
}

async function isAdmin(req: Request) {
  const cron = req.headers.get("x-cron-secret");
  if (cron && cron === (await secret("cron_secret"))) return true;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const userClient = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await userClient.rpc("is_admin");
  return data === true;
}

async function adminAction(body: any) {
  const { action } = body;
  if (action === "test") {                                    // try a message without sending anything
    return json(await askClaude(body.kind === "comment" ? "comment" : "dm", String(body.text ?? ""), []));
  }
  if (action === "status") {
    return json({
      anthropic: !!anthropicKey(), meta_secret: !!Deno.env.get("META_APP_SECRET"), ig_token: !!Deno.env.get("IG_ACCESS_TOKEN"),
      auto_send: (await secret("ig_ai_auto_send")) === "true", model: MODEL,
    });
  }
  if (action === "auto") {
    await sb.from("app_secrets").update({ value: body.on ? "true" : "false" }).eq("key", "ig_ai_auto_send");
    return json({ auto_send: !!body.on });
  }
  const { data: row } = await sb.from("ig_messages").select("*").eq("id", body.id).maybeSingle();
  if (!row) return json({ error: "nema poruke" }, 404);
  if (action === "skip") {
    await sb.from("ig_messages").update({ status: "preskoceno" }).eq("id", row.id);
    return json({ ok: true });
  }
  if (action === "send") {
    const text = String(body.text ?? row.draft ?? "").trim();
    if (!text) return json({ error: "prazan odgovor" }, 400);
    try {
      if (row.kind === "dm") await igSendDM(row.ig_user_id, text);
      else await igReplyComment(row.comment_id, text);
      await sb.from("ig_messages").update({ status: "poslano", draft: text, sent_at: new Date().toISOString(), error: null }).eq("id", row.id);
      return json({ ok: true });
    } catch (e) {
      await sb.from("ig_messages").update({ error: String(e).slice(0, 500) }).eq("id", row.id);
      return json({ error: String(e) }, 502);
    }
  }
  return json({ error: "nepoznata akcija" }, 400);
}

// ---------- ManyChat bridge ----------
// ManyChat Pro "External Request": POST {source:"manychat", user_id, username, text} with header x-manychat-key.
// Returns {reply, auto}. ManyChat sends `reply` when it is not empty.
const HOLD = "Hvala ti na poruci 🤍 Ovo ću ti lično provjeriti i javljam ti se uskoro ovdje.";
async function manychat(body: any) {
  const text = String(body.text ?? "").trim();
  const userId = String(body.user_id ?? "");
  if (!text || !userId) return json({ reply: "", auto: false });
  // daily safety cap so a flood of messages can never run up the Claude bill
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await sb.from("ig_messages").select("id", { count: "exact", head: true }).gte("created_at", since);
  const { data: row } = await sb.from("ig_messages")
    .insert({ kind: "dm", direction: "in", ig_user_id: "mc_" + userId, username: body.username ?? null, mid: "mc_" + userId + "_" + Date.now(), text })
    .select("id").single();
  const fixed = await creatorReply(text, body.username ?? null).catch(() => null);
  if (fixed) {
    await sb.from("ig_messages").update({ status: "poslano_auto", draft: fixed, reason: "Kreatori: automatski odgovor", sent_at: new Date().toISOString() }).eq("id", row!.id);
    return json({ reply: fixed, auto: true });
  }
  if ((count ?? 0) > 600) {
    await sb.from("ig_messages").update({ status: "ceka", reason: "Dnevni limit dostignut" }).eq("id", row!.id);
    return json({ reply: HOLD, auto: false });
  }
  const { data: hist } = await sb.from("ig_messages").select("status,text,draft")
    .eq("ig_user_id", "mc_" + userId).lt("id", row!.id).order("created_at", { ascending: false }).limit(8);
  try {
    const ai = await askClaude("dm", text, (hist ?? []).reverse());
    if (ai.skip) {
      await sb.from("ig_messages").update({ status: "preskoceno", draft: ai.reply || null, reason: ai.reason }).eq("id", row!.id);
      return json({ reply: "", auto: false });
    }
    const auto = (await secret("ig_ai_auto_send")) === "true";
    if (!ai.needs_human && auto && ai.reply) {
      await sb.from("ig_messages").update({ status: "poslano_auto", draft: ai.reply, reason: ai.reason, sent_at: new Date().toISOString() }).eq("id", row!.id);
      return json({ reply: ai.reply, auto: true });
    }
    const reason = ai.needs_human ? ai.reason : "Automatsko slanje je isključeno";
    await sb.from("ig_messages").update({ status: "ceka", draft: ai.reply, reason }).eq("id", row!.id);
    await notifyAdmin({ id: row!.id, kind: "dm", username: body.username ?? null, text, draft: ai.reply, reason });
    return json({ reply: HOLD, auto: false });
  } catch (e) {
    await sb.from("ig_messages").update({ status: "greska", error: String(e).slice(0, 500) }).eq("id", row!.id);
    return json({ reply: HOLD, auto: false });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === (await secret("ig_verify_token")))
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (sig) {
    if (!(await validSignature(raw, sig))) return new Response("bad signature", { status: 401 });
    const body = JSON.parse(raw);
    // answer Meta right away, do the work in the background
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(processWebhook(body).catch((e) => console.error("webhook", e)));
    return new Response("ok", { status: 200 });
  }

  let body: any = {};
  try { body = JSON.parse(raw || "{}"); } catch { /* empty */ }
  const mcKey = req.headers.get("x-manychat-key");
  if (mcKey) {
    if (mcKey !== (await secret("manychat_key"))) return json({ error: "forbidden" }, 403);
    return manychat(body);
  }
  if (!(await isAdmin(req))) return json({ error: "forbidden" }, 403);
  try { return await adminAction(body); }
  catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
