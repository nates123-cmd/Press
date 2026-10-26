-- Solo members: someone with a Press login and a feed of their own, walled
-- off from the group. A solo member sees only their own links, notes and
-- reads; the group never sees a solo member's links, comments, reads or
-- profile. Solo shares are always personal. Solo members stay off the face
-- picker and sign in with "Someone else" and their email.

alter table public.profiles add column if not exists solo boolean not null default false;

create or replace function public.press_is_solo(p_profile uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select solo from public.profiles where id = p_profile), false)
$$;
revoke all on function public.press_is_solo(uuid) from public, anon;
grant execute on function public.press_is_solo(uuid) to authenticated;

-- True when me and them may see each other: same person, or both in the group.
create or replace function public.press_sees(p_profile uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_profile = public.press_me()
      or (public.press_me() is not null
          and not public.press_is_solo(public.press_me())
          and not public.press_is_solo(p_profile))
$$;
revoke all on function public.press_sees(uuid) from public, anon;
grant execute on function public.press_sees(uuid) to authenticated;

drop policy if exists profiles_sel on public.profiles;
create policy profiles_sel on public.profiles for select to authenticated
  using (public.press_sees(id));

drop policy if exists shares_sel on public.shares;
create policy shares_sel on public.shares for select to authenticated
  using ((select public.press_me()) is not null
         and (profile_id = (select public.press_me())
              or (visibility = 'group' and public.press_sees(profile_id))));

drop policy if exists shares_ins on public.shares;
create policy shares_ins on public.shares for insert to authenticated
  with check (profile_id = (select public.press_me()) and source = 'app'
              and (visibility = 'personal' or not public.press_is_solo(profile_id)));

drop policy if exists shares_upd on public.shares;
create policy shares_upd on public.shares for update to authenticated
  using (profile_id = (select public.press_me()))
  with check (profile_id = (select public.press_me())
              and (visibility = 'personal' or not public.press_is_solo(profile_id)));

drop policy if exists reads_sel on public.reads;
create policy reads_sel on public.reads for select to authenticated
  using (public.press_sees(profile_id));

drop policy if exists comments_sel on public.comments;
create policy comments_sel on public.comments for select to authenticated
  using (public.press_sees(author_id));

-- A solo member sees an article only through a share of their own.
drop policy if exists articles_sel on public.articles;
create policy articles_sel on public.articles for select to authenticated
  using ((select public.press_me()) is not null
         and (not public.press_is_solo((select public.press_me()))
              or exists (select 1 from public.shares s
                          where s.article_id = articles.id and s.profile_id = (select public.press_me()))));

-- Adding a link: find or create the article by its canonical url. Definer,
-- because a solo member cannot see an article the group already has.
create or replace function public.press_ensure_article(p_canonical text, p_url text, p_site text, p_kind text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare aid uuid;
begin
  if public.press_me() is null then raise exception 'not a member'; end if;
  insert into public.articles (canonical_url, url, site, kind)
  values (p_canonical, p_url, p_site, p_kind)
  on conflict (canonical_url) do nothing
  returning id into aid;
  if aid is null then select id into aid from public.articles where canonical_url = p_canonical; end if;
  return aid;
end $$;
revoke all on function public.press_ensure_article(text, text, text, text) from public, anon;
grant execute on function public.press_ensure_article(text, text, text, text) to authenticated;

-- The face picker shows the group only.
create or replace function public.press_members()
returns table (id uuid, display_name text, short_name text, color text, avatar_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, display_name, short_name, color, avatar_url
    from public.profiles
   where email is not null and not solo
   order by is_me desc, created_at
$$;
revoke all on function public.press_members() from public;
grant execute on function public.press_members() to anon, authenticated;
