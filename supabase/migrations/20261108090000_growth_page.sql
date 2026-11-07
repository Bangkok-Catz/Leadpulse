-- Growth page: funding and PR as two short pipelines, and two more ways an account can
-- come in so the Social tab can count where buyers came from.
--
-- ADDITIVE. Two new tables and a wider source list; no existing row changes.
--
-- growth_items: one row per program, investor, TV show, award, press story, event or
-- moment Pat is chasing. `track` is the tab it sits on (funding | pr). `stage` 1–5 is how
-- far it got (funding: watching, applying, submitted, pitching, in program; PR: idea,
-- planned, pitched, booked, published). `status` closes a row without deleting it
-- (missed, declined, done). `next_step` + `next_date` is what shows on This week and in
-- the morning Telegram; `waiting_since` marks "sent, waiting on them". Archived rows keep
-- `deleted_at`, as everywhere else, so Undo can bring them back.
--
-- growth_updates: what happened, logged from the page (a report sent, a call, a no).
--
-- companies.acquisition_source gains social_post (a normal post, not an ad) and press
-- (press, TV or an award). Same values as ACQUISITION_SOURCES in
-- src/utils/acquisition-source.ts.

create table if not exists public.growth_items (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('funding', 'pr')),
  name text not null check (length(btrim(name)) > 0),
  kind text not null check (kind in (
    'government', 'investor', 'accelerator', 'tv_show', 'award', 'pitch_event',
    'press', 'event', 'moment', 'social'
  )),
  offer text,
  stage smallint not null default 1 check (stage between 1 and 5),
  status text not null default 'open' check (status in ('open', 'missed', 'declined', 'done')),
  next_step text,
  next_date date,
  waiting_since date,
  url text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.growth_items is
  'Funding and PR the Growth page tracks: programs, investors, TV, awards, press, events, moments.';

create index if not exists growth_items_next_date_idx
  on public.growth_items (next_date)
  where deleted_at is null and status = 'open';

-- updated_at follows every edit (the Closed list sorts by it). Its own function: public has
-- no shared one.
create or replace function public.growth_items_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists growth_items_updated_at on public.growth_items;
create trigger growth_items_updated_at
  before update on public.growth_items
  for each row execute function public.growth_items_touch();

alter table public.growth_items enable row level security;
drop policy if exists "Read for anon" on public.growth_items;
create policy "Read for anon" on public.growth_items for select to public using (true);
drop policy if exists "Add for anon" on public.growth_items;
create policy "Add for anon" on public.growth_items for insert to public with check (true);
drop policy if exists "Edit for anon" on public.growth_items;
create policy "Edit for anon" on public.growth_items for update to public using (true) with check (true);

create table if not exists public.growth_updates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.growth_items(id) on delete cascade,
  happened_on date not null default current_date,
  note text not null check (length(btrim(note)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists growth_updates_item_idx on public.growth_updates (item_id, happened_on desc);

alter table public.growth_updates enable row level security;
drop policy if exists "Read for anon" on public.growth_updates;
create policy "Read for anon" on public.growth_updates for select to public using (true);
drop policy if exists "Add for anon" on public.growth_updates;
create policy "Add for anon" on public.growth_updates for insert to public with check (true);

alter table public.companies
  drop constraint if exists companies_acquisition_source_check;
alter table public.companies
  add constraint companies_acquisition_source_check
  check (acquisition_source is null or acquisition_source in (
    'outbound', 'meta_ad', 'referral', 'inbound_other', 'social_post', 'press'
  ));

comment on column public.companies.acquisition_source is
  'How the account was acquired: outbound | meta_ad | referral | inbound_other | social_post | press. null = not recorded.';
