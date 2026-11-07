-- Social tab: each channel's numbers, one row per channel per week, from Metricool.
--
-- ADDITIVE. One new table; nothing else changes.
--
-- A weekly Claude task (Monday morning, Bangkok) reads last week's numbers for every
-- channel linked in Metricool (brand 7936170) through the Metricool connector and
-- upserts them here. The app only reads. Metricool's free plan has no API, so the app
-- never calls Metricool itself and holds no Metricool key.
--
-- network: Metricool's name for the channel (instagram, facebook, tiktok, youtube,
-- googleBusinessProfile, threads, ...). period_start/period_end: the Monday–Sunday week.
-- followers: the count at the end of the week; followers_change: gained minus lost in
-- it. reach, views, interactions, posts: the week's totals. A number Metricool does not
-- give for a channel stays null (Google Business Profile has no followers).

create table if not exists public.social_snapshots (
  id uuid primary key default gen_random_uuid(),
  network text not null check (length(btrim(network)) > 0),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  followers integer,
  followers_change integer,
  reach integer,
  views integer,
  interactions integer,
  posts integer,
  source text not null default 'metricool',
  fetched_at timestamptz not null default now(),
  unique (network, period_start)
);

comment on table public.social_snapshots is
  'Weekly per-channel social numbers from Metricool, written by the weekly Claude task; the Social tab reads them.';

create index if not exists social_snapshots_period_idx on public.social_snapshots (period_start desc);

alter table public.social_snapshots enable row level security;
drop policy if exists "Read for anon" on public.social_snapshots;
create policy "Read for anon" on public.social_snapshots for select to public using (true);
