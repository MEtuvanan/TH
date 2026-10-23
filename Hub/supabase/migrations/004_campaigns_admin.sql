-- 004_campaigns_admin: campaigns, audit log, admin analytics, atomic quest-content save, place image bucket.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  image_url text,
  status text not null default 'draft' check (status in ('draft','published','paused','ended','archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.campaign_places (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  place_id uuid not null references public.places(id),
  primary key (campaign_id, place_id)
);
create table public.campaign_quests (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  quest_id uuid not null references public.quests(id),
  primary key (campaign_id, quest_id)
);
create table public.campaign_participants (
  campaign_id uuid not null references public.campaigns(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  row_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function public.campaign_is_open(c public.campaigns) returns boolean
language sql stable as $$
  select c.status = 'published' and (c.starts_at is null or c.starts_at <= now())
     and (c.ends_at is null or c.ends_at > now());
$$;

alter table public.campaigns enable row level security;
alter table public.campaign_places enable row level security;
alter table public.campaign_quests enable row level security;
alter table public.campaign_participants enable row level security;
alter table public.audit_logs enable row level security;

create policy campaigns_read on public.campaigns for select using (public.campaign_is_open(campaigns) or public.is_admin());
create policy campaigns_admin on public.campaigns for all using (public.is_admin()) with check (public.is_admin());
create policy cp_read on public.campaign_places for select using (
  public.is_admin() or exists (select 1 from public.campaigns c where c.id = campaign_id and public.campaign_is_open(c)));
create policy cp_admin on public.campaign_places for all using (public.is_admin()) with check (public.is_admin());
create policy cq_read on public.campaign_quests for select using (
  public.is_admin() or exists (select 1 from public.campaigns c where c.id = campaign_id and public.campaign_is_open(c)));
create policy cq_admin on public.campaign_quests for all using (public.is_admin()) with check (public.is_admin());
create policy cpart_read on public.campaign_participants for select using (user_id = auth.uid() or public.is_admin());
create policy audit_admin_read on public.audit_logs for select using (public.is_admin());

-- Audit trigger for admin-managed tables.
create or replace function public.log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (actor_id, action, table_name, row_id, details)
  values (auth.uid(), tg_op, tg_table_name, r->>'id', jsonb_build_object('title', coalesce(r->>'title', r->>'name'), 'status', r->>'status'));
  return coalesce(new, old);
end $$;
create trigger audit_places after insert or update or delete on public.places for each row execute function public.log_audit();
create trigger audit_quests after insert or update or delete on public.quests for each row execute function public.log_audit();
create trigger audit_campaigns after insert or update or delete on public.campaigns for each row execute function public.log_audit();
create trigger audit_characters after insert or update or delete on public.characters for each row execute function public.log_audit();

create or replace function public.join_campaign(p_campaign_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.campaigns;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into c from public.campaigns where id = p_campaign_id;
  if not found or not public.campaign_is_open(c) then raise exception 'campaign not joinable'; end if;
  insert into public.campaign_participants (campaign_id, user_id) values (p_campaign_id, auth.uid())
    on conflict do nothing;
end $$;

-- Replace all questions/options/answer keys of a quest in one transaction.
-- p_questions: [{"prompt":"..","options":[{"label":"..","correct":true}, ...]}]
create or replace function public.admin_save_quest_content(p_quest_id uuid, p_questions jsonb, p_checkin_code text default null)
returns void language plpgsql security definer set search_path = public as $$
declare qn jsonb; op jsonb; qid uuid; oid uuid; qi int := 0; oi int; n_correct int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  delete from public.quest_questions where quest_id = p_quest_id;
  for qn in select * from jsonb_array_elements(coalesce(p_questions, '[]')) loop
    select count(*) into n_correct from jsonb_array_elements(qn->'options') o where (o->>'correct')::boolean;
    if n_correct <> 1 then raise exception 'each question needs exactly one correct option'; end if;
    insert into public.quest_questions (quest_id, position, prompt) values (p_quest_id, qi, qn->>'prompt') returning id into qid;
    oi := 0;
    for op in select * from jsonb_array_elements(qn->'options') loop
      insert into public.quest_options (question_id, label, position) values (qid, op->>'label', oi) returning id into oid;
      if (op->>'correct')::boolean then insert into public.quest_answer_keys (option_id) values (oid); end if;
      oi := oi + 1;
    end loop;
    qi := qi + 1;
  end loop;
  if p_checkin_code is not null and trim(p_checkin_code) <> '' then
    insert into public.quest_secrets (quest_id, checkin_code) values (p_quest_id, trim(p_checkin_code))
      on conflict (quest_id) do update set checkin_code = excluded.checkin_code;
  else
    delete from public.quest_secrets where quest_id = p_quest_id;
  end if;
  insert into public.audit_logs (actor_id, action, table_name, row_id, details)
    values (auth.uid(), 'CONTENT', 'quests', p_quest_id::text, jsonb_build_object('questions', jsonb_array_length(coalesce(p_questions, '[]'))));
end $$;

-- Real metrics only; the client treats a 0 denominator as "no data".
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'published_places', (select count(*) from places where status = 'published'),
    'published_quests', (select count(*) from quests where status = 'published'),
    'active_campaigns', (select count(*) from campaigns c where public.campaign_is_open(c)),
    'quest_starts', (select count(*) from user_quests),
    'quest_completions', (select count(*) from user_quests where status = 'completed'),
    'quests', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title,
        'starts', (select count(*) from user_quests u where u.quest_id = q.id),
        'completions', (select count(*) from user_quests u where u.quest_id = q.id and u.status = 'completed')))
        from quests q), '[]'),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title,
        'participants', (select count(*) from campaign_participants p where p.campaign_id = c.id)))
        from campaigns c), '[]'),
    'places', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', p.id, 'name', p.name, 'completions', count(u.id)) x
        from places p join quest_places qp on qp.place_id = p.id
        join user_quests u on u.quest_id = qp.quest_id and u.status = 'completed'
        group by p.id, p.name order by count(u.id) desc limit 10) t), '[]')
  );
end $$;

revoke all on function public.join_campaign(uuid), public.admin_save_quest_content(uuid, jsonb, text), public.admin_stats() from public, anon;
grant execute on function public.join_campaign(uuid), public.admin_save_quest_content(uuid, jsonb, text), public.admin_stats() to authenticated;

-- Public bucket for destination photos; only admins may write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-images', 'place-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy place_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'place-images' and public.is_admin());
create policy place_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'place-images' and public.is_admin());
