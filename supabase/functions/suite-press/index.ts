// suite-press: Press Gang for the native Suite app's home edition.
//
// POST {} (or no body): read-only summary. POST {action:"just_me", url, note?}: save a link as a
// personal ("Just me") share, see justMe() below.
//
// The summary returns what Press's own Unread tab would show Nate (src/components/Feed.jsx
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

// ── "Just me" from the Suite share sheet. Mirrors src/lib/press.js shareUrl() with
// visibility 'personal'; canonicalize() mirrors src/lib/url.js (itself a mirror of the poller)
// so the dedupe key matches every other way a link gets into Press. Keep all three in step. ──
const TRACKERS = new Set([
  "smid", "rsrc", "fbclid", "gclid", "igshid", "igsh", "si", "ref", "ref_src", "ref_url", "feature",
  "mc_cid", "mc_eid", "unlocked_article_code", "campaign_id", "emc", "nl", "te", "referringsource",
  "sgrp", "pvid", "ck", "ss", "user_id", "regi_id", "uri", "share", "cmpid", "ncid", "source", "s", "t",
  "mibextid", "mkt_tok", "ito", "ocid", "cid", "xid", "via", "srsltid", "sfnsn", "rbclickid", "gift",
  "giftcopy", "leadsource", "wt.mc_id", "searchresultposition", "stkn", "img_index", "partner", "sh", "ref_",
]);
const LINK_HOSTS = new Set([
  "youtube.com", "youtu.be", "open.spotify.com", "x.com", "twitter.com", "instagram.com", "tiktok.com",
  "podcasts.apple.com", "music.apple.com", "reddit.com", "imgur.com", "tenor.com", "giphy.com",
  "apps.apple.com", "maps.app.goo.gl", "maps.google.com",
]);

function canonicalize(raw: string) {
  const u = new URL(raw.trim());
  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (host.startsWith("m.") && host.split(".").length >= 3) host = host.slice(2);
  const path = u.pathname.replace(/\/+$/, "") || "/";
  let keep: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    const kl = k.toLowerCase();
    if (TRACKERS.has(kl) || kl.startsWith("utm_")) continue;
    keep.push([k, v]);
  }
  if (host === "youtube.com") keep = keep.filter(([k]) => k === "v");
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const q = new URLSearchParams(keep).toString();
  return `https://${host}${path}${q ? "?" + q : ""}`;
}

async function justMe(rawUrl: string, note: string) {
  if (!/^https?:\/\//i.test(rawUrl)) return json({ ok: false, error: "not a link" }, 400);
  const canon = canonicalize(rawUrl);
  const site = new URL(canon).hostname;
  const { data: me } = await db.from("profiles").select("id").eq("is_me", true).single();
  if (!me) return json({ ok: false, error: "no is_me profile" }, 500);

  let { data: art } = await db.from("articles").select("id").eq("canonical_url", canon).maybeSingle();
  if (!art) {
    const { data, error } = await db.from("articles")
      .insert({ canonical_url: canon, url: rawUrl, site, kind: LINK_HOSTS.has(site) ? "link" : "article" })
      .select("id").single();
    if (error) return json({ ok: false, error: error.message }, 500);
    art = data;
  }
  const { data: dup } = await db.from("shares").select("id").eq("article_id", art!.id).eq("profile_id", me.id).limit(1);
  if (dup?.length) return json({ ok: true, id: art!.id, message: "Already in Press" });

  const { error } = await db.from("shares").insert({
    article_id: art!.id, profile_id: me.id, raw_url: rawUrl, note: note || null, source: "app", visibility: "personal",
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, id: art!.id, message: `Saved to Press (just you) · ${site}` });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!sameToken(req.headers.get("x-suite-token") ?? "", TOKEN)) return json({ ok: false, error: "unauthorized" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body = feed */ }
  try {
    if (body.action === "just_me") return await justMe(String(body.url ?? ""), String(body.note ?? ""));
    return json({ ok: true, ...(await feed()) });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
