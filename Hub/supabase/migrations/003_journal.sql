-- 003_journal: private travel diaries, photos, place links, private storage bucket.
-- Diaries are owner-only (no public visibility option in this MVP).

create table public.travel_diaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 150),
  body text check (char_length(body) <= 5000),
  travel_date date not null,
  mood text check (char_length(mood) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index travel_diaries_user_date_idx on public.travel_diaries(user_id, travel_date desc);
create trigger trg_diaries_updated before update on public.travel_diaries
  for each row execute function public.set_updated_at();

create table public.diary_photos (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references public.travel_diaries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  caption text check (char_length(caption) <= 300),
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (storage_path like user_id::text || '/%')
);
create index diary_photos_diary_idx on public.diary_photos(diary_id, position);

create table public.diary_place_links (
  diary_id uuid not null references public.travel_diaries(id) on delete cascade,
  place_id uuid not null references public.places(id),
  primary key (diary_id, place_id)
);

alter table public.travel_diaries enable row level security;
alter table public.diary_photos enable row level security;
alter table public.diary_place_links enable row level security;

create policy diaries_owner on public.travel_diaries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy photos_owner on public.diary_photos for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.travel_diaries d where d.id = diary_id and d.user_id = auth.uid()));

create policy links_owner on public.diary_place_links for all
  using (exists (select 1 from public.travel_diaries d where d.id = diary_id and d.user_id = auth.uid()))
  with check (exists (select 1 from public.travel_diaries d where d.id = diary_id and d.user_id = auth.uid()));

-- ---------- private storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diary-photos', 'diary-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- First path segment must be the user's own id.
create policy diary_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'diary-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy diary_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'diary-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy diary_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'diary-photos' and (storage.foldername(name))[1] = auth.uid()::text);
