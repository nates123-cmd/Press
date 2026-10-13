-- The sign-in screen shows the members' faces before anyone is signed in,
-- so two read-only lookups are open to the anon role. They expose names,
-- short names, inks and headshots: never emails, phone handles or ids of
-- auth users. Whoever has the URL can see who is in the group; that is the
-- price of a sign-in screen with faces on it.

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

-- Which member an email belongs to, or nothing. Lets the screen say "that is
-- not Bne's address" without ever listing addresses.
create or replace function public.press_lookup(p_email text)
returns table (id uuid, display_name text, short_name text, color text, avatar_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, display_name, short_name, color, avatar_url
    from public.profiles
   where email is not null and lower(email) = lower(trim(p_email))
   limit 1
$$;
revoke all on function public.press_lookup(text) from public;
grant execute on function public.press_lookup(text) to anon, authenticated;
