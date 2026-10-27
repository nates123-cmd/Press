-- Solo members go back on the sign-in faces with everyone else. Only the
-- feed is walled off; the picker exposes names and headshots, nothing more.
create or replace function public.press_members()
returns table (id uuid, display_name text, short_name text, color text, avatar_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, display_name, short_name, color, avatar_url
    from public.profiles
   where email is not null
   order by is_me desc, created_at
$$;
revoke all on function public.press_members() from public;
grant execute on function public.press_members() to anon, authenticated;
