-- Long-press row actions.
--
-- Delete: anyone may delete their own shares, iMessage ones included. The
-- poller's watermark only moves forward, so a deleted iMessage share is not
-- re-ingested. An article whose last visible share is gone drops out of every
-- feed on its own (the app hides articles with no visible share).
--
-- Move to Just me: a person may flip their own shares between group and
-- personal. For an article someone else sent, reads.moved_at takes it off
-- that one person's group tabs and puts it under their "Just me" tab;
-- nobody else notices.
drop policy if exists shares_del on public.shares;
create policy shares_del on public.shares for delete to authenticated
  using (profile_id = (select public.press_me()));
grant delete on public.shares to authenticated;

drop policy if exists shares_upd on public.shares;
create policy shares_upd on public.shares for update to authenticated
  using (profile_id = (select public.press_me()))
  with check (profile_id = (select public.press_me()));
grant update (visibility) on public.shares to authenticated;

alter table public.reads add column if not exists moved_at timestamptz;
