-- The public page offers "Comment", which signs a member in and opens the
-- full reader on the same article. For that it needs the article id (an
-- opaque uuid; RLS still guards the row) and how many comments are waiting.
-- The comments themselves stay members-only.

drop function if exists public.press_public_article(text);
create function public.press_public_article(p_token text)
returns table (id uuid, url text, site text, status text, title text, byline text, dek text,
               published_at timestamptz, hero_image_url text, hero_caption text,
               content_html text, word_count integer, comment_count integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.url, a.site, a.status, a.title, a.byline, a.dek, a.published_at, a.hero_image_url,
         a.hero_caption, a.content_html, a.word_count,
         (select count(*)::int from public.comments c where c.article_id = a.id)
    from public.articles a
   where a.share_token is not null and a.share_token = p_token
   limit 1
$$;
revoke all on function public.press_public_article(text) from public;
grant execute on function public.press_public_article(text) to anon, authenticated;
