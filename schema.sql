create table if not exists public.state (
  id integer primary key,
  days jsonb not null default '{}'::jsonb,
  shifts jsonb not null default '{}'::jsonb
);

alter table public.state enable row level security;

drop policy if exists "state_read" on public.state;
create policy "state_read" on public.state
  for select using (true);

drop policy if exists "state_insert" on public.state;
create policy "state_insert" on public.state
  for insert with check (true);

drop policy if exists "state_update" on public.state;
create policy "state_update" on public.state
  for update using (true) with check (true);
