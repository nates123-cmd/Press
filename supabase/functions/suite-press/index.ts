// suite-press: Press Gang for the native Suite app's home edition.
//
// Read-only. Returns what Press's own Unread tab would show Nate (src/components/Feed.jsx
// `decorated` + `unread`), plus new comments on group articles since he last looked.
// Headline, site and who shared it only, never article text or share notes.
//
// Auth: `x-suite-token` == SUITE_TOKEN secret (same token as suite-glance on the suite
// project). Deployed --no-verify-jwt. "Me" = the profile with is_me = true.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("SUITE_TOKEN") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function sameToken(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const COLS = `id, site, kind, status, title, created_at,
  shares (profile_id, shared_at, visibility),
  comments (author_id, created_at, resolved_at),
  reads (profile_id, read_at, last_seen_at, dismissed_at, moved_at)`;

async function feed() {
  const [{ data: profiles, error: pe }, { data: rows, error: ae }] = await Promise.all([
    db.from("profiles").select("id, short_name, display_name, is_me"),
    db.from("articles").select(COLS).order("created_at", { ascending: false }).limit(200),
  ]);
  if (pe || ae) throw new Error((pe ?? ae)!.message);
  const me = profiles!.find((p) => p.is_me);
  if (!me) throw new Error("no is_me profile");
  const name = (id: string) => {
    const p = profiles!.find((x) => x.id === id);
    return p?.short_name || p?.display_name || "Someone";
  };

  // Same decoration as Feed.jsx, minus the parts that need the signed-in client.
  const decorated = rows!.map((a: any) => {
    const mine = a.reads.find((r: any) => r.profile_id === me.id);
    const seen = mine?.last_seen_at || "1970";
    const live = a.comments.filter((c: any) => !c.resolved_at);
    const group = a.shares.filter((s: any) => s.visibility !== "personal");
    const moved = !!mine?.moved_at && group.length > 0;
    return {
      id: a.id, title: a.title, site: a.site, status: a.status,
      inGroup: group.length > 0 && !moved,
      isRead: !!mine?.read_at,
      isDismissed: !!mine?.dismissed_at,
      isLink: a.kind === "link" || a.status === "link_only",
      newComments: live.filter((c: any) => c.created_at > seen && c.author_id !== me.id).length,
      sharers: [...new Set(group.map((s: any) => s.profile_id))].filter((id) => id !== me.id).map(name),
      latest: group.reduce((m: string, s: any) => (s.shared_at > m ? s.shared_at : m), ""),
    };
  }).filter((a) => a.inGroup && !a.isDismissed)
    .sort((a, b) => (a.latest < b.latest ? 1 : -1));

  const unread = decorated.filter((a) => !a.isRead && !a.isLink && a.status !== "failed");
  const talk = decorated.filter((a) => a.newComments > 0);
  const pick = (a: any) => ({
    id: a.id, title: a.title || a.site || "Untitled", site: a.site,
    sharers: a.sharers, new_comments: a.newComments,
  });
  return {
    unread: unread.length,
    new_comments: talk.reduce((n, a) => n + a.newComments, 0),
    items: unread.slice(0, 3).map(pick),
    talk: talk.slice(0, 3).map(pick),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!sameToken(req.headers.get("x-suite-token") ?? "", TOKEN)) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    return json({ ok: true, ...(await feed()) });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
