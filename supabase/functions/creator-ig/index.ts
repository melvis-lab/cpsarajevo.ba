// Collection Premium Sarajevo · creator Instagram check (admin only)
// POST { id } with the admin's session token -> reads the public Instagram profile and stores
// followers, following, posts, average likes/comments of the last 12 posts and engagement rate.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function isAdmin(auth: string | null) {
  if (!auth) return false;
  const userClient = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await userClient.rpc("is_admin");
  return data === true;
}

async function profile(handle: string) {
  const r = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, {
    headers: {
      "x-ig-app-id": "936619743392459",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0",
      "Accept": "application/json",
    },
  });
  if (r.status === 404) throw new Error("Profil ne postoji");
  if (!r.ok) throw new Error(`Instagram ne odgovara (${r.status}), upiši brojeve ručno`);
  const u = (await r.json())?.data?.user;
  if (!u) throw new Error("Profil ne postoji ili je skriven");
  const posts = (u.edge_owner_to_timeline_media?.edges ?? []).map((e: any) => e.node).slice(0, 12);
  const likes = posts.map((n: any) => n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0);
  const comments = posts.map((n: any) => n.edge_media_to_comment?.count ?? 0);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const followers = u.edge_followed_by?.count ?? null;
  const al = avg(likes), ac = avg(comments);
  return {
    ig_full_name: u.full_name ?? null,
    ig_pic: u.profile_pic_url_hd ?? u.profile_pic_url ?? null,
    ig_followers: followers,
    ig_following: u.edge_follow?.count ?? null,
    ig_posts: u.edge_owner_to_timeline_media?.count ?? null,
    ig_private: !!u.is_private,
    ig_avg_likes: al === null ? null : Math.round(al),
    ig_avg_comments: ac === null ? null : Math.round(ac * 10) / 10,
    ig_er: followers && al !== null ? Math.round(((al + (ac ?? 0)) / followers) * 10000) / 100 : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req.headers.get("Authorization")))) return json({ error: "forbidden" }, 403);
  const { id } = await req.json().catch(() => ({}));
  const { data: c } = await sb.from("creators").select("id,instagram").eq("id", id).maybeSingle();
  if (!c) return json({ error: "Nema kreatora" }, 404);
  try {
    const p = await profile(c.instagram);
    await sb.from("creators").update({ ...p, ig_checked_at: new Date().toISOString(), ig_error: null }).eq("id", c.id);
    return json({ ok: true, ...p });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    await sb.from("creators").update({ ig_checked_at: new Date().toISOString(), ig_error: msg }).eq("id", c.id);
    return json({ ok: false, error: msg });
  }
});
