-- Dismiss: a per-person hide. The row leaves every tab for that person and
-- nobody else notices. Lives on reads, the per-person-per-article row.
alter table public.reads add column if not exists dismissed_at timestamptz;
