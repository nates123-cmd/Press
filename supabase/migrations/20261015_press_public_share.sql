-- Share one article outside the group.
--
-- A member taps Share in the reader; the article gets an unguessable token
-- (once, then reused) and the link #/s/<token> opens a read-only copy with no
-- sign-in. Only the article itself goes out: title, byline, dek, hero, body.
-- Never comments, shares, notes, readers or who sent it. Anyone holding the
-- link can read it, the way a gift link works; nothing lists tokens.

alter table public.articles add column if not exists share_token text unique;

-- Members only. Returns the article's token, minting it on first use.
create or replace function public.press_share_article(p_article_id uuid)
returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare tok text;
begin
  if public.press_me() is null then raise exception 'not a member'; end if;
  select share_token into tok from public.articles where id = p_article_id;
  if not found then raise exception 'no such article'; end if;
  if tok is null then
    tok := translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');
    update public.articles set share_token = tok
     where id = p_article_id and share_token is null
    returning share_token into tok;
    if tok is null then
      select share_token into tok from public.articles where id = p_article_id;
    end if;
  end if;
  return tok;
end $$;
revoke all on function public.press_share_article(uuid) from public, anon;
grant execute on function public.press_share_article(uuid) to authenticated;

-- Anyone with the token. The article and nothing else.
create or replace function public.press_public_article(p_token text)
returns table (url text, site text, status text, title text, byline text, dek text,
               published_at timestamptz, hero_image_url text, hero_caption text,
               content_html text, word_count integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select url, site, status, title, byline, dek, published_at, hero_image_url,
         hero_caption, content_html, word_count
    from public.articles
   where share_token is not null and share_token = p_token
   limit 1
$$;
revoke all on function public.press_public_article(text) from public;
grant execute on function public.press_public_article(text) to anon, authenticated;
