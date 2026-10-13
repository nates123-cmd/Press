-- Headshots, NYT-columnist style. Files live in the public `avatars` storage
-- bucket (created by scripts/avatars.mjs); the profile keeps the public url.
alter table public.profiles add column if not exists avatar_url text;
