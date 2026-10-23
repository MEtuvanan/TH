-- 006_seed_bangkok: districts, characters and DRAFT destinations.
-- Places are inserted as draft / unverified on purpose. Coordinates are approximate
-- and NO opening hours, fees or visitor info are included. An admin must check each
-- place (coordinates, details) and then mark it verified + published in the dashboard.

do $$
declare
  bkk int;
begin
  select id into bkk from public.provinces where name_en = 'Bangkok';

  insert into public.districts (province_id, name_en, name_th) values
    (bkk, 'Phra Nakhon', 'พระนคร'),
    (bkk, 'Bangkok Yai', 'บางกอกใหญ่'),
    (bkk, 'Chatuchak', 'จตุจักร'),
    (bkk, 'Samphanthawong', 'สัมพันธวงศ์'),
    (bkk, 'Pathum Wan', 'ปทุมวัน')
  on conflict (province_id, name_en) do nothing;

  insert into public.places (name, summary, province_id, district_id, category_id, lat, lng, status, verified)
  select v.name, v.summary, bkk,
         (select id from public.districts d where d.province_id = bkk and d.name_en = v.district),
         (select id from public.place_categories c where c.slug = v.cat),
         v.lat, v.lng, 'draft', false
  from (values
    ('Wat Phra Kaew',        'Temple of the Emerald Buddha, within the Grand Palace grounds.', 'Phra Nakhon',     'temple',   13.7515, 100.4927),
    ('Wat Pho',              'Temple known for the Reclining Buddha and traditional massage school.', 'Phra Nakhon', 'temple', 13.7465, 100.4930),
    ('Wat Arun',             'Riverside temple on the Chao Phraya, known for its central prang.', 'Bangkok Yai', 'temple',   13.7437, 100.4889),
    ('National Museum Bangkok','Museum of Thai art and history.',                              'Phra Nakhon',     'museum',   13.7575, 100.4928),
    ('Chatuchak Weekend Market','Large market area in northern Bangkok.',                      'Chatuchak',       'market',   13.7999, 100.5500),
    ('Yaowarat Road',        'Main street of Bangkok''s Chinatown.',                           'Samphanthawong',  'landmark', 13.7410, 100.5100),
    ('Lumphini Park',        'Public park in central Bangkok.',                                'Pathum Wan',      'park',     13.7314, 100.5414),
    ('Jim Thompson House',   'Museum house of the American silk entrepreneur.',                'Pathum Wan',      'museum',   13.7492, 100.5285)
  ) as v(name, summary, district, cat, lat, lng)
  where not exists (select 1 from public.places p where p.name = v.name);
end $$;

insert into public.characters (name, description, rarity, unlock_hint)
select * from (values
  ('Tuk-Tuk Pal',   'A cheerful three-wheeled guide.',          'common', 'Complete your first quest.'),
  ('Little Yak',    'A temple guardian in miniature.',          'rare',   'Complete temple quests.'),
  ('Kinnaree Star', 'A graceful half-bird, half-human spirit.', 'epic',   'Complete a campaign.'),
  ('Lotus Sprite',  'A calm companion from the lotus pond.',    'common', 'Write a travel diary entry.')
) as v(name, description, rarity, unlock_hint)
where not exists (select 1 from public.characters c where c.name = v.name);
