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
  thumb_url          text,                       -- small JPEG preview for the gallery grid
  sticker_json       jsonb not null default '[]'::jsonb,
  scene_json         jsonb,                      -- full editable scene (stickers + markup) for reopening
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- For databases created before thumb_url existed.
alter table public.projects add column if not exists thumb_url text;

-- Lets the gallery tell editable saves from flat ones without loading scene_json.
alter table public.projects add column if not exists has_editable_scene boolean
  generated always as ((scene_json -> 'objects') is not null) stored;

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
-- 50 MB per file. Watch the unit: file_size_limit is in BYTES — a value of
-- 1024 once made every upload fail with "The object exceeded the maximum
-- allowed size".
insert into storage.buckets (id, name, public, file_size_limit)
values ('images', 'images', true, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
values ('exports', 'exports', true, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Public read + anonymous upload for both buckets (MVP, no auth).
drop policy if exists "Public read images"   on storage.objects;
drop policy if exists "Public upload images" on storage.objects;
drop policy if exists "Public delete images" on storage.objects;
drop policy if exists "Public read exports"   on storage.objects;
drop policy if exists "Public upload exports" on storage.objects;
drop policy if exists "Public delete exports" on storage.objects;

create policy "Public read images" on storage.objects
  for select using (bucket_id = 'images');
create policy "Public upload images" on storage.objects
  for insert with check (bucket_id = 'images');
create policy "Public delete images" on storage.objects
  for delete using (bucket_id = 'images');

create policy "Public read exports" on storage.objects
  for select using (bucket_id = 'exports');
create policy "Public upload exports" on storage.objects
  for insert with check (bucket_id = 'exports');
create policy "Public delete exports" on storage.objects
  for delete using (bucket_id = 'exports');

-- ---------------------------------------------------------------------------
-- 30-day auto-delete
-- Every day at 03:17 UTC, pg_cron calls the cleanup-old-photos Edge Function
-- (supabase/functions/cleanup-old-photos), which deletes projects not saved
-- in 30 days along with their files. It has to be an Edge Function: Storage
-- refuses deletes made directly against storage.objects.
-- Deploy it first:  supabase functions deploy cleanup-old-photos --no-verify-jwt
-- and replace YOUR-REF below with the project ref.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('cleanup-old-photos')
where exists (select 1 from cron.job where jobname = 'cleanup-old-photos');

select cron.schedule(
  'cleanup-old-photos',
  '17 3 * * *',
  $$ select net.http_post(
       url := 'https://YOUR-REF.supabase.co/functions/v1/cleanup-old-photos',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
