-- PriceTag Studio — Supabase schema
-- Run this in the Supabase Dashboard -> SQL Editor (or via `supabase db push`).
-- App runs WITHOUT auth, so projects are anonymous (user_id is null) and the
-- policies below allow public (anon) access. Tighten these if you add auth.

-- ---------------------------------------------------------------------------
-- projects table
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid,                       -- nullable: no auth in MVP
  original_image_url text,
  final_image_url    text,
  sticker_json       jsonb not null default '[]'::jsonb,
  scene_json         jsonb,                      -- full editable scene (stickers + markup) for reopening
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- keep updated_at fresh on every update
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- MVP has no auth, so we allow anonymous read/write. Replace these with
-- user-scoped policies (auth.uid() = user_id) once auth is added.
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;

drop policy if exists "Public can read projects"   on public.projects;
drop policy if exists "Public can insert projects" on public.projects;
drop policy if exists "Public can update projects" on public.projects;
drop policy if exists "Public can delete projects" on public.projects;

create policy "Public can read projects"   on public.projects for select using (true);
create policy "Public can insert projects" on public.projects for insert with check (true);
create policy "Public can update projects" on public.projects for update using (true) with check (true);
create policy "Public can delete projects" on public.projects for delete using (true);

-- ---------------------------------------------------------------------------
-- Storage buckets: images (originals) + exports (final renders)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('exports', 'exports', true)
on conflict (id) do nothing;

-- Public read + anonymous upload for both buckets (MVP, no auth).
drop policy if exists "Public read images"   on storage.objects;
drop policy if exists "Public upload images" on storage.objects;
drop policy if exists "Public read exports"   on storage.objects;
drop policy if exists "Public upload exports" on storage.objects;

create policy "Public read images" on storage.objects
  for select using (bucket_id = 'images');
create policy "Public upload images" on storage.objects
  for insert with check (bucket_id = 'images');

create policy "Public read exports" on storage.objects
  for select using (bucket_id = 'exports');
create policy "Public upload exports" on storage.objects
  for insert with check (bucket_id = 'exports');
