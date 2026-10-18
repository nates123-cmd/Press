-- Fetch progress the app can show. Three pieces:
--   articles.claimed_at   the moment a reader started rendering this row,
--                         so "in queue" and "reading now" are different words.
--   press_workers         one heartbeat row per reader (beelink, mac). The app
--                         tells "still fetching" from "nothing is fetching".
--   press_retry(id)       a member asks for another go at a failed link.

alter table public.articles add column if not exists claimed_at timestamptz;
-- When the row last joined the queue: created_at at first, reset by a retry,
-- so "in queue 40s" counts from the retry and not from the week before.
alter table public.articles add column if not exists queued_at timestamptz not null default now();

create table if not exists public.press_workers (
  name          text primary key,                 -- 'beelink' | 'mac'
  last_seen_at  timestamptz not null default now(),
  last_ok_at    timestamptz,
  note          text                              -- 'bot wall', 'no chrome profile', null when fine
);
alter table public.press_workers enable row level security;
revoke all on public.press_workers from anon;
grant select on public.press_workers to authenticated;
drop policy if exists press_workers_sel on public.press_workers;
create policy press_workers_sel on public.press_workers for select to authenticated
  using (public.press_me() is not null);

do $$ begin
  alter publication supabase_realtime add table public.press_workers;
exception when duplicate_object then null; end $$;

-- Try again: back to the front of the queue with a clean slate. Members only.
create or replace function public.press_retry(p_article_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.press_me() is null then raise exception 'not a member'; end if;
  update public.articles
     set status = 'pending', attempts = 0, fetch_error = null, claimed_at = null, queued_at = now()
   where id = p_article_id and status in ('pending', 'failed');
end $$;
revoke all on function public.press_retry(uuid) from public, anon;
grant execute on function public.press_retry(uuid) to authenticated;
