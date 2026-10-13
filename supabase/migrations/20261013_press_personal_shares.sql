-- Personal shares. A link someone adds "just for me" is a share nobody else
-- can see: it never shows in the group feed and never reaches the others'
-- clients at all (the select policy below). iMessage shares are always group.
alter table public.shares
  add column if not exists visibility text not null default 'group'
  check (visibility in ('group', 'personal'));

drop policy if exists shares_sel on public.shares;
create policy shares_sel on public.shares for select to authenticated
  using ((select public.press_me()) is not null
         and (visibility = 'group' or profile_id = (select public.press_me())));

drop policy if exists shares_ins on public.shares;
create policy shares_ins on public.shares for insert to authenticated
  with check (profile_id = (select public.press_me()) and source = 'app');

drop policy if exists shares_del on public.shares;
create policy shares_del on public.shares for delete to authenticated
  using (profile_id = (select public.press_me()) and source = 'app');
grant delete on public.shares to authenticated;

create index if not exists shares_visibility_idx on public.shares (visibility, profile_id);
