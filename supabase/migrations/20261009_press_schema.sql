-- Press: the Press Gang reading room.
--
-- Separate Supabase project (jmpdqbabqrxkvwvxjzpu), not the suite one. Four
-- people. Everything here is readable by any signed-in member and writable
-- only by its author; article rows are written by the Mac poller and the
-- Beelink fetcher through the service role.
--
-- A person exists as a `profiles` row BEFORE they ever sign in: the poller
-- attributes a share to a profile by iMessage handle. Sign-in binds
-- `profiles.user_id` to the auth user by email (trigger below). Nobody who is
-- not already in `profiles` can sign in: the auth trigger refuses them and the
-- app sends OTPs with shouldCreateUser: false.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users (id) on delete set null,
  email           text unique,                      -- lower-case, the invite
  display_name    text not null,
  short_name      text not null,                    -- what the margin shows
  color           text not null default '#1F4E79',  -- one per person, see DESIGN.md
  imessage_handle text unique,                      -- '+1617...'; null for the chat.db owner
  is_me           boolean not null default false,   -- the chat.db owner: is_from_me rows are theirs
  created_at      timestamptz not null default now()
);

-- The caller's own profile id. SECURITY DEFINER on purpose: the profiles
-- select policy itself calls this, and a policy that queried profiles
-- directly would recurse. It leaks nothing beyond the caller's own row id.
create or replace function public.press_me() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.profiles where user_id = auth.uid() limit 1
$$;
revoke all on function public.press_me() from public, anon;
grant execute on function public.press_me() to authenticated;

-- ---------------------------------------------------------------- articles
create table if not exists public.articles (
  id              uuid primary key default gen_random_uuid(),
  canonical_url   text not null unique,             -- tracking params stripped; the dedupe key
  url             text not null,                    -- first url seen, gift codes intact
  site            text not null,                    -- 'nytimes.com'
  kind            text not null default 'article' check (kind in ('article', 'link')),
  status          text not null default 'pending'
                  check (status in ('pending', 'ready', 'link_only', 'failed')),
  title           text,
  byline          text,
  dek             text,
  published_at    timestamptz,
  hero_image_url  text,
  hero_caption    text,
  content_html    text,                             -- sanitized subset, see fetcher/sanitize.mjs
  content_text    text,                             -- what comment anchors are measured against
  word_count      integer,
  attempts        integer not null default 0,
  fetch_error     text,
  fetched_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists articles_status_idx on public.articles (status, created_at);

-- ---------------------------------------------------------------- shares
-- One row per time someone dropped the link in the chat. Two people sending
-- the same article = two rows, one article.
create table if not exists public.shares (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references public.articles (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id),
  message_rowid   bigint,                           -- chat.db message.ROWID; null for in-app shares
  raw_url         text,
  note            text,                             -- the rest of the message, minus the url
  source          text not null default 'imessage' check (source in ('imessage', 'app')),
  shared_at       timestamptz not null default now(),
  unique (message_rowid, article_id)                -- one message can carry several links
);
create index if not exists shares_article_idx on public.shares (article_id);
create index if not exists shares_shared_at_idx on public.shares (shared_at desc);

-- ---------------------------------------------------------------- reads
-- Per person per article. read_at null = still unread. last_seen_at drives
-- the "new comments" badge in the feed.
create table if not exists public.reads (
  profile_id      uuid not null references public.profiles (id),
  article_id      uuid not null references public.articles (id) on delete cascade,
  read_at         timestamptz,
  last_seen_at    timestamptz not null default now(),
  progress        real not null default 0,
  primary key (profile_id, article_id)
);

-- ---------------------------------------------------------------- comments
-- Drive-style. quote/prefix/suffix anchor the comment to a passage of
-- content_text (W3C TextQuoteSelector). All three null = a comment on the
-- whole article. parent_id set = a reply in the thread.
create table if not exists public.comments (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references public.articles (id) on delete cascade,
  author_id       uuid not null references public.profiles (id),
  parent_id       uuid references public.comments (id) on delete cascade,
  quote           text,
  prefix          text,
  suffix          text,
  body            text not null,
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles (id),
  edited_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists comments_article_idx on public.comments (article_id, created_at);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.articles enable row level security;
alter table public.shares   enable row level security;
alter table public.reads    enable row level security;
alter table public.comments enable row level security;

revoke all on public.profiles, public.articles, public.shares, public.reads, public.comments from anon;
grant select, update (display_name, short_name, color) on public.profiles to authenticated;
grant select, insert on public.articles to authenticated;
grant select, insert on public.shares to authenticated;
grant select, insert, update, delete on public.reads to authenticated;
grant select, insert, update, delete on public.comments to authenticated;

-- Every member sees every row. Only a member (press_me() not null) sees anything.
drop policy if exists profiles_sel on public.profiles;
create policy profiles_sel on public.profiles for select to authenticated
  using ((select public.press_me()) is not null);
drop policy if exists profiles_upd on public.profiles;
create policy profiles_upd on public.profiles for update to authenticated
  using (id = (select public.press_me()))
  with check (id = (select public.press_me()));

drop policy if exists articles_sel on public.articles;
create policy articles_sel on public.articles for select to authenticated
  using ((select public.press_me()) is not null);
drop policy if exists articles_ins on public.articles;
create policy articles_ins on public.articles for insert to authenticated
  with check ((select public.press_me()) is not null);

drop policy if exists shares_sel on public.shares;
create policy shares_sel on public.shares for select to authenticated
  using ((select public.press_me()) is not null);
drop policy if exists shares_ins on public.shares;
create policy shares_ins on public.shares for insert to authenticated
  with check (profile_id = (select public.press_me()) and source = 'app');

drop policy if exists reads_sel on public.reads;
create policy reads_sel on public.reads for select to authenticated
  using ((select public.press_me()) is not null);
drop policy if exists reads_ins on public.reads;
create policy reads_ins on public.reads for insert to authenticated
  with check (profile_id = (select public.press_me()));
drop policy if exists reads_upd on public.reads;
create policy reads_upd on public.reads for update to authenticated
  using (profile_id = (select public.press_me()))
  with check (profile_id = (select public.press_me()));
drop policy if exists reads_del on public.reads;
create policy reads_del on public.reads for delete to authenticated
  using (profile_id = (select public.press_me()));

drop policy if exists comments_sel on public.comments;
create policy comments_sel on public.comments for select to authenticated
  using ((select public.press_me()) is not null);
drop policy if exists comments_ins on public.comments;
create policy comments_ins on public.comments for insert to authenticated
  with check (author_id = (select public.press_me()));
drop policy if exists comments_upd on public.comments;
create policy comments_upd on public.comments for update to authenticated
  using (author_id = (select public.press_me()))
  with check (author_id = (select public.press_me()));
drop policy if exists comments_del on public.comments;
create policy comments_del on public.comments for delete to authenticated
  using (author_id = (select public.press_me()));

-- Anyone in the group may resolve or reopen a thread, like Drive. The update
-- policy above only lets authors touch their own rows, so this goes through
-- a function that checks membership and touches only the resolve columns.
create or replace function public.press_resolve(comment_id uuid, resolved boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := public.press_me();
begin
  if me is null then raise exception 'not a member'; end if;
  update public.comments
     set resolved_at = case when resolved then now() else null end,
         resolved_by = case when resolved then me else null end
   where id = comment_id and parent_id is null;
end $$;
revoke all on function public.press_resolve(uuid, boolean) from public, anon;
grant execute on function public.press_resolve(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- auth binding
-- Runs as supabase_auth_admin when a user row is created. Refuses anyone not
-- invited, binds the invite to the auth user otherwise.
create or replace function public.press_on_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.profiles set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  get diagnostics n = row_count;
  if n = 0 and not exists (select 1 from public.profiles where user_id = new.id) then
    raise exception 'Press is invite only';
  end if;
  return new;
end $$;
revoke all on function public.press_on_auth_user() from public, anon, authenticated;
grant execute on function public.press_on_auth_user() to supabase_auth_admin;
drop trigger if exists press_on_auth_user on auth.users;
create trigger press_on_auth_user after insert on auth.users
  for each row execute function public.press_on_auth_user();

-- ---------------------------------------------------------------- realtime
do $$ begin
  alter publication supabase_realtime add table public.comments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.shares;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.articles;
exception when duplicate_object then null; end $$;
