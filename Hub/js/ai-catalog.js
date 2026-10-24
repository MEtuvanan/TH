// ai-catalog.js — load every published place on the site for AI grounding
import { supabase } from './supabase.js';
import { enrichPlaceData } from './places-data.js';

const PAGE = 1000;

function publishedQuest(q) {
  if (!q) return false;
  if (q.status && q.status !== 'published') return false;
  if (q.approval_status === 'pending' || q.approval_status === 'rejected') return false;
  return true;
}

export async function loadAiCatalog() {
  const rows = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from('places')
      .select(`
        id, name, summary, description, visitor_info, opening_hours, entry_fee,
        history, highlights, tips, lat, lng, approval_status, status,
        provinces(name_th, name_en),
        districts(name_th, name_en),
        place_categories(name),
        quest_places(quests(id, title, difficulty, reward_tokens, status, approval_status))
      `)
      .eq('status', 'published')
      .order('name')
      .range(from, from + PAGE - 1);

    let { data, error } = await query;
    if (error && String(error.message || '').includes('quest_places')) {
      const retry = await supabase
        .from('places')
        .select(`
          id, name, summary, description, visitor_info, opening_hours, entry_fee,
          history, highlights, tips, lat, lng, approval_status, status,
          provinces(name_th, name_en),
          districts(name_th, name_en),
          place_categories(name)
        `)
        .eq('status', 'published')
        .order('name')
        .range(from, from + PAGE - 1);
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return rows
    .filter(p => p.approval_status !== 'pending' && p.approval_status !== 'rejected')
    .map(p => {
      const e = enrichPlaceData(p);
      const quests = (p.quest_places || [])
        .map(qp => qp.quests)
        .filter(publishedQuest)
        .map(q => ({
          id: q.id,
          title: q.title,
          difficulty: q.difficulty || '',
          tokens: q.reward_tokens || 0
        }));
      return {
        id: p.id,
        name: e.name_display || p.name,
        name_en: e.name_en_display || p.name,
        category: p.place_categories?.name || '',
        province: p.provinces?.name_th || p.provinces?.name_en || '',
        district: p.districts?.name_th || p.districts?.name_en || '',
        summary: String(e.summary_display || p.summary || '').slice(0, 400),
        description: String(e.description_display || p.description || '').slice(0, 500),
        visitor_info: e.visitor_info_display || p.visitor_info || '',
        opening_hours: e.opening_hours_display || p.opening_hours || '',
        entry_fee: e.entry_fee_display || p.entry_fee || '',
        transportation: e.transportation_display || p.tips || '',
        best_time: e.best_time_display || '',
        highlights: (e.highlights_display || []).map(h => h.title).filter(Boolean).slice(0, 4),
        lat: p.lat,
        lng: p.lng,
        quests
      };
    });
}

export function formatCatalogForPrompt(catalog) {
  const compact = catalog.length > 40;
  return catalog.map((c, i) => {
    const loc = [c.district, c.province].filter(Boolean).join(', ');
    const q = c.quests.length
      ? `เควสท์ในเว็บ: ${c.quests.map(x => `${x.title}${x.tokens ? ` (${x.tokens} โทเคน)` : ''}`).join('; ')}`
      : '';
    const hl = c.highlights.length ? `จุดเด่น: ${c.highlights.join(', ')}` : '';
    if (compact) {
      return `${i + 1}. [ID:${c.id}] ${c.name}${loc ? ` (${loc})` : ''} | ${c.category || ''} | ${c.summary}${c.opening_hours ? ` | เวลา: ${c.opening_hours}` : ''}${q ? ` | ${q}` : ''}`;
    }
    return `${i + 1}. [ID:${c.id}] ${c.name}${loc ? ` — ${loc}` : ''} (${c.category || 'สถานที่'})
สรุป: ${c.summary || c.description || '—'}
${c.opening_hours ? `เวลาเปิด-ปิดในระบบ: ${c.opening_hours}` : 'เวลาเปิด-ปิด: ยังไม่มีในระบบ'}
${c.entry_fee ? `ค่าเข้าชมในระบบ: ${c.entry_fee}` : ''}
${c.visitor_info ? `คำแนะนำนักท่องเที่ยว: ${c.visitor_info}` : ''}
${c.transportation ? `การเดินทาง: ${c.transportation}` : ''}
${c.best_time ? `ช่วงเวลาที่เหมาะ: ${c.best_time}` : ''}
${hl}
${q}
พิกัด: ${c.lat}, ${c.lng}`.replace(/\n{3,}/g, '\n\n').trim();
  }).join('\n\n');
}

export function buildTravelAiSystemPrompt(catalog) {
  if (!catalog.length) {
    return `คุณคือผู้ช่วยในเว็บ Travel & Challenge ตอนนี้ยังไม่มีสถานที่ที่เผยแพร่ในระบบ
ห้ามแนะนำสถานที่ท่องเที่ยวใดๆ จากความรู้ทั่วไป บอกผู้ใช้ว่ายังไม่มีข้อมูลสถานที่ในเว็บ`;
  }

  const names = catalog.map(c => c.name).join(', ');
  return `คุณคือ "Travel & Challenge AI" ผู้ช่วยในเว็บนี้เท่านั้น ตอบเป็นภาษาไทยที่สุภาพและชัดเจน

กฎเด็ดขาด:
- ใช้ข้อมูลจากรายการ "สถานที่ในเว็บนี้" เท่านั้น นี่คือสถานที่ทั้งหมดที่มีในระบบ (${catalog.length} แห่ง): ${names}
- ห้ามกล่าวถึง แนะนำ หรือวางแผนไปยังสถานที่ ร้านอาหาร ตลาด วัด ย่าน หาด หรือจังหวัดที่ไม่มีในรายการ แม้จะเป็นที่รู้จักในชีวิตจริง
- ถ้าผู้ใช้ถามที่ที่ไม่อยู่ในรายการ ให้บอกตรงๆ ว่าแอปนี้ยังไม่มีสถานที่นั้น แล้วเสนอทางเลือกจากรายการที่มีเท่านั้น
- ห้ามแต่งเวลาเปิด-ปิด ค่าเข้าชม เควสท์ หรือพิกัด ใช้เท่าที่มีในข้อมูลด้านล่าง ถ้าไม่มีในข้อมูลให้บอกว่ายังไม่มีข้อมูลในระบบ
- คำแนะนำและการวางแผนทริปต้องอิงสถานที่ในรายการ และใส่ place_id ให้ตรงกับ ID ในรายการ
- เมื่อผู้ใช้ขอจัดทริป เส้นทาง หรือโปรแกรมเที่ยว ให้วางแผนจากสถานที่ในรายการ แล้วปิดท้ายด้วยบล็อก \`\`\`json:itinerary
- การถามตอบทั่วไปไม่ต้องใส่ json:itinerary

สถานที่ในเว็บนี้ (ข้อมูลครบจากระบบ):
${formatCatalogForPrompt(catalog)}

รูปแบบ json:itinerary (ทุก stop ต้องมี place_id จากรายการด้านบนเท่านั้น):
\`\`\`json:itinerary
{
  "trip_title": "ชื่อทริป",
  "summary": "สรุปจากสถานที่ในเว็บ",
  "total_days": 1,
  "daily_plan": [
    {
      "day": 1,
      "theme": "ธีม",
      "stops": [
        {
          "place_id": "uuid จากรายการ",
          "name": "ชื่อตามรายการ",
          "arrival_time": "09:00",
          "duration_minutes": 90,
          "why": "เหตุผลจากข้อมูลในเว็บ",
          "notes": "คำแนะนำจากข้อมูลในเว็บ",
          "lat": 13.75,
          "lng": 100.49
        }
      ]
    }
  ]
}
\`\`\``;
}

function matchPlace(stop, catalog) {
  if (!stop || !catalog.length) return null;
  if (stop.place_id) {
    const byId = catalog.find(c => c.id === stop.place_id);
    if (byId) return byId;
  }
  const name = String(stop.name || '').trim().toLowerCase();
  if (!name) return null;
  return catalog.find(c => {
    const n = (c.name || '').toLowerCase();
    const en = (c.name_en || '').toLowerCase();
    return n === name || en === name || n.includes(name) || name.includes(n) || (en && (en.includes(name) || name.includes(en)));
  }) || null;
}

function groundStop(stop, catalog) {
  const place = matchPlace(stop, catalog);
  if (!place) return null;
  return {
    ...stop,
    place_id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng
  };
}

export function groundItinerary(itinerary, catalog) {
  if (!itinerary || !catalog?.length) return null;

  if (Array.isArray(itinerary.daily_plan)) {
    itinerary.daily_plan = itinerary.daily_plan
      .map(day => ({
        ...day,
        stops: (day.stops || []).map(s => groundStop(s, catalog)).filter(Boolean)
      }))
      .filter(day => day.stops.length);
    if (!itinerary.daily_plan.length) return null;
    itinerary.stops = itinerary.daily_plan.flatMap(d => d.stops);
    return itinerary;
  }

  if (Array.isArray(itinerary.stops)) {
    itinerary.stops = itinerary.stops.map(s => groundStop(s, catalog)).filter(Boolean);
    if (!itinerary.stops.length) return null;
    return itinerary;
  }

  return null;
}
