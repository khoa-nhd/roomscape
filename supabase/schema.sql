-- Roomscape tables. Paste into the Supabase SQL editor and run once.

create table if not exists rooms (
  id text primary key,
  draft jsonb not null,          -- full game, including lock answers: never exposed to browsers
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id bigint generated always as identity primary key,
  room_id text not null,
  name text not null,
  ms integer not null,
  hints integer not null,
  created_at timestamptz not null default now()
);
create index if not exists runs_room_time on runs (room_id, ms, hints);

-- No policies on purpose: with row level security on and no policy, the public
-- (anon) key can read and write nothing. Only the server's service role key can.
alter table rooms enable row level security;
alter table runs enable row level security;

-- Wall photos. Public read, so players can load them by URL; writes go through the server.
insert into storage.buckets (id, name, public)
values ('rooms', 'rooms', true)
on conflict (id) do nothing;
