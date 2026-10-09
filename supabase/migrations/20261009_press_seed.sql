-- Seed the chat.db owner. Everyone else is created by the poller the first
-- time their handle shows up in the chat (placeholder name = last four digits
-- of the number) and named/invited later with scripts/invite.mjs. Phone
-- numbers never live in this repo: it is public for GitHub Pages.
insert into public.profiles (email, display_name, short_name, color, is_me) values
  ('nates123@gmail.com', 'Nate', 'Nate', '#1F4E79', true)
on conflict do nothing;
