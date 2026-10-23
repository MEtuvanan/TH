-- 001_foundation: profiles, admin role, geography, places. Deny-by-default RLS.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)), 40));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- Prevent self-promotion: ordinary users may only change display_name / avatar_url.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
create policy profiles_admin_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());
grant update (role) on public.profiles to authenticated; -- column grant; the trigger below limits it to admins

create or replace function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() and auth.uid() is not null then
    raise exception 'role change not permitted';
  end if;
  return new;
end $$;
create trigger trg_profiles_guard_role before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------- geography ----------
create table public.provinces (
  id serial primary key,
  name_en text not null unique,
  name_th text,
  created_at timestamptz not null default now()
);
create table public.districts (
  id serial primary key,
  province_id int not null references public.provinces(id),
  name_en text not null,
  name_th text,
  unique (province_id, name_en)
);
create table public.place_categories (
  id serial primary key,
  slug text not null unique,
  name text not null
);

-- ---------- places ----------
create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  summary text check (char_length(summary) <= 500),
  description text,
  province_id int not null references public.provinces(id),
  district_id int references public.districts(id),
  category_id int references public.place_categories(id),
  lat double precision not null check (lat between 5 and 21),
  lng double precision not null check (lng between 97 and 106),
  visitor_info text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  verified boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- publishing requires verification
  check (status <> 'published' or verified)
);
create index places_status_idx on public.places(status);
create index places_province_idx on public.places(province_id, district_id);
create trigger trg_places_updated before update on public.places
  for each row execute function public.set_updated_at();

create table public.place_images (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  url text not null,
  alt text not null default '',
  position int not null default 0
);
create index place_images_place_idx on public.place_images(place_id, position);

-- ---------- RLS ----------
alter table public.provinces enable row level security;
alter table public.districts enable row level security;
alter table public.place_categories enable row level security;
alter table public.places enable row level security;
alter table public.place_images enable row level security;

create policy provinces_read on public.provinces for select using (true);
create policy districts_read on public.districts for select using (true);
create policy categories_read on public.place_categories for select using (true);
create policy provinces_admin on public.provinces for all using (public.is_admin()) with check (public.is_admin());
create policy districts_admin on public.districts for all using (public.is_admin()) with check (public.is_admin());
create policy categories_admin on public.place_categories for all using (public.is_admin()) with check (public.is_admin());

create policy places_public_read on public.places for select using (status = 'published' or public.is_admin());
create policy places_admin_write on public.places for all using (public.is_admin()) with check (public.is_admin());

create policy place_images_read on public.place_images for select using (
  public.is_admin() or exists (select 1 from public.places p where p.id = place_id and p.status = 'published'));
create policy place_images_admin on public.place_images for all using (public.is_admin()) with check (public.is_admin());

-- Reference data only (no fabricated destinations).
insert into public.provinces (name_en, name_th) values ('Bangkok', 'กรุงเทพมหานคร') on conflict do nothing;
insert into public.place_categories (slug, name) values
  ('temple','Temple'),('museum','Museum'),('park','Park'),('market','Market'),('landmark','Landmark')
  on conflict do nothing;
