// Collection Premium Sarajevo · creator Instagram check
//
// POST { id }                      admin JWT or x-cron-secret -> checks that creator's profile and stores the numbers
// POST { action:"exists", username } public (sign-up form)      -> { exists, followers, posts, private, source } or { unknown:true }
//
// Lookup order:
//   1. Instagram Graph API business_discovery (official, uses our own IG_ACCESS_TOKEN): works for creator and business accounts
//   2. the public web profile endpoint (often blocked from servers with 401/429)
// Personal accounts are invisible to (1); if (2) is blocked too the answer is "unknown", never a false "does not exist".
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const HANDLE = /^[a-z0-9._]{2,30}$/;

type Profile = {
  ig_full_name: string | null; ig_pic: string | null; ig_followers: number | null; ig_following: number | null; ig_posts: number | null;
  ig_private: boolean; ig_avg_likes: number | null; ig_avg_comments: number | null; ig_er: number | null; source: string;
};
class NotFound extends Error {}
class Unknown extends Error {}

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function finish(p: Omit<Profile, "ig_avg_likes" | "ig_avg_comments" | "ig_er">, likes: number[], comments: number[]): Profile {
  const al = avg(likes), ac = avg(comments);
  return {
    ...p,
    ig_avg_likes: al === null ? null : Math.round(al),
    ig_avg_comments: ac === null ? null : Math.round(ac * 10) / 10,
    ig_er: p.ig_followers && al !== null ? Math.round(((al + (ac ?? 0)) / p.ig_followers) * 10000) / 100 : null,
  };
}

// 1. official: business_discovery through our own Instagram professional account
async function viaGraph(handle: string): Promise<Profile> {
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!token) throw new Unknown("no token");
  const f = `business_discovery.username(${handle}){username,name,profile_picture_url,followers_count,follows_count,media_count,media.limit(12){like_count,comments_count}}`;
  let last = "";
  for (const base of ["https://graph.instagram.com/v23.0/me", "https://graph.facebook.com/v23.0/me"]) {
    const r = await fetch(`${base}?fields=${encodeURIComponent(f)}&access_token=${encodeURIComponent(token)}`);
    const j = await r.json().catch(() => ({}));
    const d = j?.business_discovery;
    if (r.ok && d) {
      const media = d.media?.data ?? [];
      return finish({ ig_full_name: d.name ?? null, ig_pic: d.profile_picture_url ?? null, ig_followers: d.followers_count ?? null, ig_following: d.follows_count ?? null,
        ig_posts: d.media_count ?? null, ig_private: false, source: "graph" }, media.map((m: any) => m.like_count ?? 0), media.map((m: any) => m.comments_count ?? 0));
    }
    // code 110 = "Cannot find user" for that username among professional accounts
    last += ` [${base.includes("facebook") ? "fb" : "ig"} ${r.status} ${j?.error?.code ?? ""} ${String(j?.error?.message ?? "").slice(0, 160)}]`;
    if (j?.error?.code === 110 || /cannot find user|invalid user id/i.test(j?.error?.message ?? "")) throw new Unknown("not a professional account");
  }
  throw new Unknown("graph unavailable" + last);
}

// 2. public web profile (blocked from many servers)
async function viaWeb(handle: string): Promise<Profile> {
  const r = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, {
    headers: { "x-ig-app-id": "936619743392459", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0", "Accept": "application/json" },
  });
  if (r.status === 404) throw new NotFound("Profil ne postoji");
  if (!r.ok) throw new Unknown(`Instagram ne odgovara (${r.status})`);
  const u = (await r.json().catch(() => null))?.data?.user;
  if (!u) throw new NotFound("Profil ne postoji");
  const posts = (u.edge_owner_to_timeline_media?.edges ?? []).map((e: any) => e.node).slice(0, 12);
  return finish({ ig_full_name: u.full_name ?? null, ig_pic: u.profile_pic_url_hd ?? u.profile_pic_url ?? null, ig_followers: u.edge_followed_by?.count ?? null,
    ig_following: u.edge_follow?.count ?? null, ig_posts: u.edge_owner_to_timeline_media?.count ?? null, ig_private: !!u.is_private, source: "web" },
    posts.map((n: any) => n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0), posts.map((n: any) => n.edge_media_to_comment?.count ?? 0));
}

async function lookup(handle: string): Promise<Profile> {
  try { return await viaGraph(handle); } catch (e) { if (!(e instanceof Unknown)) throw e; }
  return await viaWeb(handle);
}

async function cronOk(req: Request) {
  const c = req.headers.get("x-cron-secret");
  if (!c) return false;
  const { data } = await sb.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle();
  return !!data?.value && c === data.value;
}
async function isAdmin(auth: string | null) {
  if (!auth) return false;
  const userClient = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await userClient.rpc("is_admin");
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));

  // public: the sign-up form asks whether a handle is real before it submits
  if (body.action === "exists") {
    const h = String(body.username ?? "").trim().toLowerCase().replace(/^@/, "").replace(/^.*instagram\.com\//, "").replace(/[/?#].*$/, "");
    if (!HANDLE.test(h)) return json({ exists: false, reason: "format" });
    try {
      const p = await lookup(h);
      return json({ exists: true, followers: p.ig_followers, posts: p.ig_posts, private: p.ig_private, source: p.source });
    } catch (e) {
      if (e instanceof NotFound) return json({ exists: false, reason: "missing" });
      return json({ unknown: true });
    }
  }

  if (!(await cronOk(req)) && !(await isAdmin(req.headers.get("Authorization")))) return json({ error: "forbidden" }, 403);
  if (body.action === "probe") {                       // diagnostics: which lookup works for a handle
    const out: Record<string, unknown> = {};
    for (const [k, fn] of [["graph", viaGraph], ["web", viaWeb]] as const) {
      try { const p = await fn(String(body.username)); out[k] = { ok: true, followers: p.ig_followers, posts: p.ig_posts }; }
      catch (e) { out[k] = { ok: false, error: String((e as Error).message) }; }
    }
    return json(out);
  }
  const { data: c } = await sb.from("creators").select("id,instagram").eq("id", body.id).maybeSingle();
  if (!c) return json({ error: "Nema kreatora" }, 404);
  try {
    const { source, ...p } = await lookup(c.instagram);
    await sb.from("creators").update({ ...p, ig_checked_at: new Date().toISOString(), ig_error: null }).eq("id", c.id);
    return json({ ok: true, source, ...p });
  } catch (e) {
    const msg = e instanceof NotFound ? "Profil ne postoji" : "Instagram ne daje podatke za ovaj profil (lični profil ili blokada). Otvori profil i pogledaj sam.";
    await sb.from("creators").update({ ig_checked_at: new Date().toISOString(), ig_error: msg }).eq("id", c.id);
    return json({ ok: false, error: msg });
  }
});
