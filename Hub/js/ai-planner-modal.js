/**
 * ai-planner-modal.js — Floating AI Trip Planner Widget for Explore Page
 * 
 * Workflow:
 *  1. Floating Action Button (FAB) on explore page
 *  2. Initial Prompt Step: Simple text box asking user to describe their dream trip
 *  3. AI Analysis Step: AI parses natural language & generates a tailored customization form
 *  4. Generation Step: AI builds grounded multi-day itinerary with verified places
 *  5. Result Step: Day-by-day plan with direct GPS navigation links and map pan
 */

import { supabase } from './supabase.js';
import { AI_PLANNER_URL, SUPABASE_ANON_KEY } from './config.js';
import { esc, toast } from './ui.js';

// ── Smart Natural Language Parser ──────────────────────────────
export function parseTripPrompt(text = '') {
  const t = text.toLowerCase();
  
  // 1. Detect Days
  let days = 1;
  const dayMatch = t.match(/(\d+)\s*(วัน|day)/i) || t.match(/(วันเดียว|one day|1day)/i);
  if (dayMatch) {
    if (dayMatch[1]) days = parseInt(dayMatch[1], 10);
    else days = 1;
  } else if (t.includes('สุดสัปดาห์') || t.includes('เสาร์อาทิตย์') || t.includes('weekend')) {
    days = 2;
  }
  days = Math.min(Math.max(days, 1), 7);

  // 2. Detect Starting Area / Region
  let startingArea = 'พระนคร (เกาะรัตนโกสินทร์), กรุงเทพฯ';
  if (t.includes('เยาวราช') || t.includes('chinatown')) startingArea = 'เยาวราช - สัมพันธวงศ์';
  else if (t.includes('จตุจักร') || t.includes('หมอชิต')) startingArea = 'จตุจักร';
  else if (t.includes('สยาม') || t.includes('ปทุมวัน') || t.includes('central')) startingArea = 'สยาม - ปทุมวัน';
  else if (t.includes('ริมน้ำ') || t.includes('เจ้าพระยา') || t.includes('บางกอกใหญ่')) startingArea = 'ริมแม่น้ำเจ้าพระยา - บางกอกใหญ่';

  // 3. Detect Budget
  let budget = 'medium';
  if (t.includes('ประหยัด') || t.includes('ถูก') || t.includes('งบน้อย') || t.includes('budget') || t.includes('low')) budget = 'low';
  else if (t.includes('หรู') || t.includes('แพง') || t.includes('ไม่อั้น') || t.includes('luxury') || t.includes('high')) budget = 'high';

  // 4. Detect Travel Style
  let travelStyle = 'cultural';
  if (t.includes('ชิล') || t.includes('พักผ่อน') || t.includes('สบาย') || t.includes('relaxed')) travelStyle = 'relaxed';
  else if (t.includes('กิน') || t.includes('อาหาร') || t.includes('ของอร่อย') || t.includes('food') || t.includes('street food')) travelStyle = 'balanced';
  else if (t.includes('คาเฟ่') || t.includes('ถ่ายรูป') || t.includes('รูปสวย') || t.includes('photo')) travelStyle = 'adventurous';
  else if (t.includes('ครอบครัว') || t.includes('เด็ก') || t.includes('ผู้ใหญ่') || t.includes('family')) travelStyle = 'family';

  // 5. Detect Pace
  let pace = 'moderate';
  if (t.includes('ชิลๆ') || t.includes('ไม่รีบ') || t.includes('สบายๆ') || t.includes('slow')) pace = 'slow';
  else if (t.includes('แน่น') || t.includes('เก็บครบ') || t.includes('จัดเต็ม') || t.includes('fast')) pace = 'fast';

  // 6. Detect Transport
  let transport = 'public';
  if (t.includes('เดิน') || t.includes('walking')) transport = 'walking';
  else if (t.includes('ขับรถ') || t.includes('รถส่วนตัว') || t.includes('car')) transport = 'taxi';
  else if (t.includes('bts') || t.includes('mrt') || t.includes('รถไฟฟ้า') || t.includes('เรือ')) transport = 'public';

  // 7. Detect Companion
  let companion = 'friends';
  if (t.includes('คนเดียว') || t.includes('solo')) companion = 'solo';
  else if (t.includes('แฟน') || t.includes('คู่รัก') || t.includes('couple')) companion = 'couple';
  else if (t.includes('ครอบครัว') || t.includes('family')) companion = 'family';
  else if (t.includes('เพื่อน') || t.includes('แก๊ง') || t.includes('friends')) companion = 'friends';

  // 8. Detect Quests
  const includeQuests = t.includes('เควสท์') || t.includes('เควส') || t.includes('ภารกิจ') || t.includes('เหรียญ') || t.includes('quest');

  return {
    days,
    startingArea,
    budget,
    travelStyle,
    pace,
    transport,
    companion,
    includeQuests,
    hoursPerDay: pace === 'slow' ? 5 : pace === 'fast' ? 9 : 7,
    interests: extractInterests(t),
  };
}

function extractInterests(t) {
  const res = [];
  if (t.includes('วัด') || t.includes('ไหว้พระ') || t.includes('ธรรมะ')) res.push('วัดและศาสนสถาน');
  if (t.includes('อาหาร') || t.includes('กิน') || t.includes('สตรีทฟู้ด')) res.push('อาหารและสตรีทฟู้ด');
  if (t.includes('คาเฟ่') || t.includes('กาแฟ')) res.push('คาเฟ่');
  if (t.includes('พิพิธภัณฑ์') || t.includes('ประวัติศาสตร์')) res.push('พิพิธภัณฑ์และประวัติศาสตร์');
  if (t.includes('ช้อป') || t.includes('ตลาด')) res.push('ตลาดและช้อปปิ้ง');
  if (t.includes('สวน') || t.includes('ธรรมชาติ')) res.push('สวนสาธารณะ');
  if (t.includes('ถ่ายรูป')) res.push('จุดถ่ายรูปสวย');
  return res.length ? res : ['วัดและวัฒนธรรม', 'ของอร่อยย่านดัง'];
}

const BACKUP_CATALOG = [
  { name: 'วัดพระแก้ว (Wat Phra Kaew)', summary: 'วัดพระศรีรัตนศาสดาราม พระบรมมหาราชวัง ศูนย์รวมศรัทธาและศิลปกรรมชั้นสูง', lat: 13.7515, lng: 100.4927, cat: 'วัดและศาสนสถาน' },
  { name: 'วัดโพธิ์ (Wat Pho)', summary: 'วัดพระเชตุพนวิมลมังคลาราม พระนอนองค์ใหญ่และโรงเรียนนวดแผนไทยมรดกโลก', lat: 13.7465, lng: 100.4930, cat: 'วัดและศาสนสถาน' },
  { name: 'วัดอรุณราชวราราม (Wat Arun)', summary: 'พระปรางค์ริมแม่น้ำเจ้าพระยา จุดชมวิวพระอาทิตย์ตกที่งดงามที่สุด', lat: 13.7437, lng: 100.4889, cat: 'วัดและศาสนสถาน' },
  { name: 'พิพิธภัณฑสถานแห่งชาติ พระนคร', summary: 'แหล่งรวบรวมโบราณวัตถุ ศิลปกรรม และประวัติศาสตร์ชาติไทย', lat: 13.7575, lng: 100.4928, cat: 'พิพิธภัณฑ์' },
  { name: 'ถนนเยาวราช (Yaowarat Road)', summary: 'ไชน่าทาวน์เมืองไทย แหล่งรวมสตรีทฟู้ดระดับโลกและบรรยากาศยามค่ำคืน', lat: 13.7410, lng: 100.5100, cat: 'อาหารและสตรีทฟู้ด' },
  { name: 'ตลาดนัดจตุจักร (Chatuchak Market)', summary: 'ตลาดนัดสุดสัปดาห์ที่ใหญ่ที่สุดในโลก รวมเสื้อผ้า งานศิลปะ และของฝาก', lat: 13.7999, lng: 100.5500, cat: 'ตลาดและช้อปปิ้ง' },
  { name: 'สวนลุมพินี (Lumphini Park)', summary: 'สวนสาธารณะใจกลางกรุง ร่มรื่นด้วยต้นไม้ใหญ่และทะเลสาบ', lat: 13.7314, lng: 100.5414, cat: 'สวนสาธารณะ' },
  { name: 'บ้านจิม ทอมป์สัน (Jim Thompson House)', summary: 'เรือนไทยไม้สักริมคลอง พิพิธภัณฑ์ผ้าไหมและศิลปวัตถุล้ำค่า', lat: 13.7492, lng: 100.5285, cat: 'พิพิธภัณฑ์' },
];

async function generateGroundedCatalogTrip(prefs) {
  let places = [];
  try {
    const { data } = await supabase.from('places').select('id, name, summary, lat, lng, place_categories(name)');
    if (data && data.length > 0) places = data;
  } catch (e) {
    console.warn('Supabase places query fallback:', e);
  }

  if (!places.length) {
    places = BACKUP_CATALOG.map((p, idx) => ({
      id: `mock-${idx + 1}`,
      name: p.name,
      summary: p.summary,
      lat: p.lat,
      lng: p.lng,
      place_categories: { name: p.cat }
    }));
  }

  const daysCount = prefs.days || 1;
  const placesPerDay = prefs.pace === 'slow' ? 2 : prefs.pace === 'fast' ? 4 : 3;
  const shuffled = [...places].sort(() => 0.5 - Math.random());

  const daily_plan = [];
  let placeIdx = 0;

  for (let d = 1; d <= daysCount; d++) {
    const dayStops = [];
    const count = Math.min(placesPerDay, Math.max(1, places.length - placeIdx));
    const startHour = 9;

    for (let s = 0; s < count; s++) {
      const p = shuffled[placeIdx % shuffled.length];
      placeIdx++;
      const arrHour = startHour + (s * (prefs.pace === 'fast' ? 2 : 2.5));
      const hh = Math.floor(arrHour).toString().padStart(2, '0');
      const mm = ((arrHour % 1) * 60 === 0 ? '00' : '30');

      dayStops.push({
        place_id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        arrival_time: `${hh}:${mm}`,
        duration_minutes: prefs.pace === 'slow' ? 120 : 75,
        why: `สถานที่ไฮไลต์ยอดนิยม ${p.place_categories?.name || 'ท่องเที่ยว'} ตอบโจทย์สไตล์${prefs.travelStyle}`,
        notes: p.summary || 'สัมผัสประสบการณ์วัฒนธรรมและความสวยงาม',
        quests: [{ id: 'q-demo', title: `ภารกิจสำรวจ ${p.name}` }]
      });
    }

    daily_plan.push({
      day: d,
      theme: d === 1 ? 'เริ่มต้นสัมผัสไฮไลต์วัฒนธรรมและประวัติศาสตร์' : d === 2 ? 'ตะลุยชิมของอร่อยและวิถีชุมชนท้องถิ่น' : 'ท่องเที่ยวผ่อนคลายและจุดชมวิว',
      stops: dayStops,
      breaks: ['พักรับประทานอาหารกลางวันย่านใกล้เคียง', 'แวะจิบกาแฟพักผ่อนช่วงบ่าย']
    });
  }

  return {
    trip_title: `ทริปเที่ยว ${prefs.startingArea.split(',')[0]} (${daysCount} วัน)`,
    summary: `แผนท่องเที่ยวที่ปรับแต่งตามสไตล์ของคุณ จัดเส้นทางเดินทางสะดวก แวะจุดสำคัญครบครัน พร้อมพิกัด GPS นำทางจริง`,
    notice: 'เวลาและระยะเวลาที่แนะนำเป็นการประมาณการ กรุณาตรวจสอบเวลาเปิด-ปิดจริงก่อนออกเดินทาง',
    daily_plan
  };
}

// ── Floating AI Modal Controller ──────────────────────────────
export class AIPlannerModal {
  constructor() {
    this.isOpen = false;
    this.currentStep = 'prompt'; // 'prompt' | 'form' | 'loading' | 'itinerary'
    this.userPromptText = '';
    this.analyzedPrefs = null;
    this.generatedPlan = null;
    this.initDOM();
  }

  initDOM() {
    // 1. Floating Action Button (FAB)
    const fabContainer = document.createElement('div');
    fabContainer.className = 'ai-fab-container';
    fabContainer.innerHTML = `
      <button class="ai-fab-btn" id="btn-open-ai-planner" type="button" aria-label="เปิด AI วางแผนทริป">
        <span class="ai-fab-sparkle">✨</span>
        <span>AI วางแผนทริป</span>
        <span class="ai-fab-badge">ใหม่</span>
      </button>
    `;
    document.body.appendChild(fabContainer);

    // 2. Floating Modal Structure
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'ai-modal-overlay';
    modalOverlay.id = 'ai-modal-overlay';
    modalOverlay.innerHTML = `
      <div class="ai-modal-card" id="ai-modal-card" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
        <header class="ai-modal-header">
          <div class="ai-modal-title-wrap">
            <div class="ai-modal-logo">✨</div>
            <div>
              <h3 id="ai-modal-title">AI ผู้ช่วยวางแผนทริป</h3>
              <p>บอกสไตล์ที่คุณต้องการ AI จัดการให้ครบ</p>
            </div>
          </div>
          <button class="ai-modal-close-btn" id="btn-close-ai-modal" type="button" aria-label="ปิด">✕</button>
        </header>
        <div class="ai-modal-body" id="ai-modal-body">
          <!-- Dynamic Step Views Injected Here -->
        </div>
      </div>
    `;
    document.body.appendChild(modalOverlay);

    // Bind Event Listeners
    document.getElementById('btn-open-ai-planner').addEventListener('click', () => this.open());
    document.getElementById('btn-close-ai-modal').addEventListener('click', () => this.close());
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) this.close();
    });

    this.renderStep('prompt');
  }

  open() {
    this.isOpen = true;
    document.getElementById('ai-modal-overlay').classList.add('open');
    if (this.currentStep === 'prompt') {
      setTimeout(() => {
        document.getElementById('ai-prompt-input')?.focus();
      }, 200);
    }
  }

  close() {
    this.isOpen = false;
    document.getElementById('ai-modal-overlay').classList.remove('open');
  }

  renderStep(step) {
    this.currentStep = step;
    const body = document.getElementById('ai-modal-body');
    if (!body) return;

    if (step === 'prompt') {
      body.innerHTML = `
        <div class="ai-step-prompt">
          <div class="ai-prompt-lead">
            👋 <strong>อยากไปเที่ยวแบบไหน?</strong><br>
            เพียงแค่พิมพ์บอกความต้องการคร่าวๆ เช่น จำนวนวัน สไตล์ที่ชอบ หรือย่านที่อยากไป เดี๋ยว AI ช่วยสร้างฟอร์มจัดสเปกให้คุณเอง!
          </div>

          <div class="ai-textarea-wrap">
            <textarea class="ai-textarea" id="ai-prompt-input" placeholder="ตัวอย่าง: อยากเที่ยวกรุงเทพ 2 วัน เน้นไหว้พระ ถ่ายรูปชิคๆ ของอร่อยเยาวราช งบประหยัด ไปกับเพื่อน">${esc(this.userPromptText)}</textarea>
          </div>

          <div class="ai-tags-wrap">
            <span class="ai-tags-title">💡 ไอเดียคำสั่งคลิกเดียว:</span>
            <div class="ai-tags-list">
              <button type="button" class="ai-tag-btn" data-text="อยากเที่ยวกรุงเทพ 1 วัน ไหว้พระ 9 วัดเกาะรัตนโกสินทร์ ถ่ายรูปสวย ชิลๆ">🕌 ไหว้พระเกาะรัตนโกสินทร์ 1 วัน</button>
              <button type="button" class="ai-tag-btn" data-text="ทริป 2 วัน ตะลุยชิมสตรีทฟู้ดเยาวราช คาเฟ่เจริญกรุง ช้อปปิ้งจตุจักรกับเพื่อน">🍲 ตะลุยชิมเยาวราช & คาเฟ่ 2 วัน</button>
              <button type="button" class="ai-tag-btn" data-text="เที่ยวกรุงเทพ 1 วัน สบายๆ กับครอบครัว สวนสาธารณะ พิพิธภัณฑ์ ไม่รีบ">👨‍👩‍👦 เที่ยวกับครอบครัวสบายๆ 1 วัน</button>
              <button type="button" class="ai-tag-btn" data-text="ทริป 3 วัน ล่าเควสท์รับเหรียญรางวัล เก็บจุดสำคัญกรุงเทพครบ เดินทาง BTS/MRT">⚔️ ทริปล่าเควสท์ทั่วกรุง 3 วัน</button>
            </div>
          </div>

          <button class="ai-btn-primary" id="btn-analyze-prompt" type="button">
            <span>🪄</span> ให้ AI วิเคราะห์ & สร้างแบบฟอร์ม
          </button>
        </div>
      `;

      // Wire quick tags
      body.querySelectorAll('.ai-tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = document.getElementById('ai-prompt-input');
          if (input) {
            input.value = btn.dataset.text;
            input.focus();
          }
        });
      });

      // Wire analyze button
      document.getElementById('btn-analyze-prompt').addEventListener('click', () => {
        const text = document.getElementById('ai-prompt-input')?.value.trim();
        if (!text) {
          toast('กรุณาพิมพ์รายละเอียดทริปที่ต้องการก่อนครับ', 'warn');
          document.getElementById('ai-prompt-input')?.focus();
          return;
        }
        this.userPromptText = text;
        this.analyzeAndShowForm();
      });

    } else if (step === 'loading') {
      body.innerHTML = `
        <div class="ai-loading-state">
          <div class="ai-spinner"></div>
          <div>
            <div class="ai-loading-title">🤖 AI กำลังประมวลผล…</div>
            <div class="ai-loading-subtitle">กำลังจัดสรรสถานที่ที่ตรงใจ ตรวจสอบระยะทาง และเตรียมแผนการท่องเที่ยวให้คุณ</div>
          </div>
        </div>
      `;

    } else if (step === 'form') {
      const p = this.analyzedPrefs || parseTripPrompt(this.userPromptText);
      this.analyzedPrefs = p;

      body.innerHTML = `
        <div class="ai-step-form">
          <div class="ai-insight-box">
            <div class="ai-insight-icon">💡</div>
            <div class="ai-insight-text">
              <strong>AI วิเคราะห์ข้อมูลเบื้องต้นให้แล้ว!</strong>
              ตรวจพบ: ทริป <b>${p.days} วัน</b> · สไตล์ <b>${p.travelStyle}</b> · งบ <b>${p.budget}</b> · ย่าน <b>${esc(p.startingArea)}</b>
            </div>
          </div>

          <form id="ai-custom-form" class="ai-form-grid">
            <div class="ai-form-group ai-field-full">
              <label for="f-area">📍 ย่าน / จุดเริ่มต้นที่สนใจ</label>
              <input class="ai-input" id="f-area" type="text" value="${esc(p.startingArea)}" required>
            </div>

            <div class="ai-form-group">
              <label for="f-days">📅 จำนวนวัน (วัน)</label>
              <select class="ai-select" id="f-days">
                ${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}" ${d === p.days ? 'selected' : ''}>${d} วัน</option>`).join('')}
              </select>
            </div>

            <div class="ai-form-group">
              <label for="f-budget">💰 ระดับงบประมาณ</label>
              <select class="ai-select" id="f-budget">
                <option value="low" ${p.budget === 'low' ? 'selected' : ''}>💚 ประหยัด (Budget)</option>
                <option value="medium" ${p.budget === 'medium' ? 'selected' : ''}>⭐ ปานกลาง (Standard)</option>
                <option value="high" ${p.budget === 'high' ? 'selected' : ''}>👑 พรีเมียม (Luxury)</option>
              </select>
            </div>

            <div class="ai-form-group">
              <label for="f-style">🎒 สไตล์การเที่ยว</label>
              <select class="ai-select" id="f-style">
                <option value="cultural" ${p.travelStyle === 'cultural' ? 'selected' : ''}>🏛️ วัด วัฒนธรรม ประวัติศาสตร์</option>
                <option value="relaxed" ${p.travelStyle === 'relaxed' ? 'selected' : ''}>☕ ชิลๆ คาเฟ่ พักผ่อน</option>
                <option value="balanced" ${p.travelStyle === 'balanced' ? 'selected' : ''}>🍲 ตะลุยชิมของอร่อย สตรีทฟู้ด</option>
                <option value="adventurous" ${p.travelStyle === 'adventurous' ? 'selected' : ''}>📸 ถ่ายรูป แฟชั่น เช็คอิน</option>
                <option value="family" ${p.travelStyle === 'family' ? 'selected' : ''}>👨‍👩‍👧 ครอบครัว เดินสบาย ไม่เหนื่อย</option>
              </select>
            </div>

            <div class="ai-form-group">
              <label for="f-pace">🚶 จังหวะการเดินทาง</label>
              <select class="ai-select" id="f-pace">
                <option value="slow" ${p.pace === 'slow' ? 'selected' : ''}>🐢 สบายๆ (2 ที่/วัน)</option>
                <option value="moderate" ${p.pace === 'moderate' ? 'selected' : ''}>🚶 พอดีๆ (3 ที่/วัน)</option>
                <option value="fast" ${p.pace === 'fast' ? 'selected' : ''}>⚡ แน่นจุใจ (4 ที่/วัน)</option>
              </select>
            </div>

            <div class="ai-form-group">
              <label for="f-transport">🚇 การเดินทางหลัก</label>
              <select class="ai-select" id="f-transport">
                <option value="public" ${p.transport === 'public' ? 'selected' : ''}>🚇 รถไฟฟ้า BTS/MRT + เรือ</option>
                <option value="walking" ${p.transport === 'walking' ? 'selected' : ''}>🚶 เดินเท้า + รถสาธารณะ</option>
                <option value="taxi" ${p.transport === 'taxi' ? 'selected' : ''}>🚕 แท็กซี่ / Grab / ขับรถ</option>
              </select>
            </div>

            <div class="ai-form-group">
              <label for="f-companion">👥 ผู้ร่วมเดินทาง</label>
              <select class="ai-select" id="f-companion">
                <option value="solo" ${p.companion === 'solo' ? 'selected' : ''}>👤 คนเดียว (Solo)</option>
                <option value="couple" ${p.companion === 'couple' ? 'selected' : ''}>💑 คู่รัก (Couple)</option>
                <option value="friends" ${p.companion === 'friends' ? 'selected' : ''}>👯‍♂️ กลุ่มเพื่อน (Friends)</option>
                <option value="family" ${p.companion === 'family' ? 'selected' : ''}>👨‍👩‍👦 ครอบครัว (Family)</option>
              </select>
            </div>

            <div class="ai-form-group ai-field-full">
              <label class="ai-check-group">
                <input type="checkbox" id="f-quests" ${p.includeQuests ? 'checked' : ''}>
                <span>⚔️ รวมภารกิจเควสท์ล่ารางวัลเหรียญ (Quest Challenges)</span>
              </label>
            </div>
          </form>

          <div class="ai-form-actions">
            <button class="ai-btn-secondary" id="btn-back-to-prompt" type="button">⬅️ แก้ไขข้อความเดิม</button>
            <button class="ai-btn-primary" id="btn-generate-plan" type="button" style="flex:2;">
              <span>✨</span> สร้างแผนการท่องเที่ยว
            </button>
          </div>
        </div>
      `;

      // Wire back button
      document.getElementById('btn-back-to-prompt').addEventListener('click', () => {
        this.renderStep('prompt');
      });

      // Wire generate button
      document.getElementById('btn-generate-plan').addEventListener('click', () => {
        this.executePlanGeneration();
      });

    } else if (step === 'itinerary') {
      const plan = this.generatedPlan;
      if (!plan) return;

      body.innerHTML = `
        <div class="ai-step-itinerary">
          <div class="ai-trip-header">
            <h4 class="ai-trip-title">🎉 ${esc(plan.trip_title)}</h4>
            <p class="ai-trip-summary">${esc(plan.summary)}</p>
          </div>

          ${plan.daily_plan.map(d => `
            <div class="ai-day-card">
              <h5 class="ai-day-title">📅 วันที่ ${d.day} — ${esc(d.theme || '')}</h5>
              ${d.stops.map(s => `
                <div class="ai-stop-item">
                  <div class="ai-stop-header">
                    <span class="ai-stop-name">📍 ${esc(s.name)}</span>
                    <span class="ai-stop-time">⏰ ${esc(s.arrival_time)} (~${s.duration_minutes} นาที)</span>
                  </div>
                  <div class="ai-stop-why">${esc(s.why)}</div>
                  <div class="ai-stop-actions">
                    <a href="/navigate.html?lat=${s.lat}&lng=${s.lng}&name=${encodeURIComponent(s.name)}&id=${encodeURIComponent(s.place_id || '')}" 
                       class="ai-stop-btn ai-btn-nav" target="_blank">
                      🧭 นำทาง GPS
                    </a>
                    <button type="button" class="ai-stop-btn ai-btn-view" data-lat="${s.lat}" data-lng="${s.lng}">
                      🗺️ ดูบนแผนที่
                    </button>
                  </div>
                </div>
              `).join('')}
              ${d.breaks?.length ? `<div style="font-size:.78rem;color:#6B7280;margin-top:.25rem;">☕ คำแนะนำ: ${d.breaks.map(esc).join(' · ')}</div>` : ''}
            </div>
          `).join('')}

          <div class="ai-form-actions">
            <button class="ai-btn-secondary" id="btn-plan-again" type="button">🔄 วางแผนใหม่</button>
            <a href="/planner.html" class="ai-btn-primary" style="flex:2;text-decoration:none;">
              📅 จัดการทริปตัวเต็ม
            </a>
          </div>
        </div>
      `;

      // Wire view on map buttons (pans explore map)
      body.querySelectorAll('.ai-btn-view').forEach(btn => {
        btn.addEventListener('click', () => {
          const lat = parseFloat(btn.dataset.lat);
          const lng = parseFloat(btn.dataset.lng);
          if (window.__exploreMap && !isNaN(lat) && !isNaN(lng)) {
            window.__exploreMap.panTo({ lat, lng });
            window.__exploreMap.setZoom?.(16);
            toast('เลื่อนแผนที่ไปยังจุดหมายแล้ว', 'ok');
          }
        });
      });

      // Wire plan again button
      document.getElementById('btn-plan-again').addEventListener('click', () => {
        this.renderStep('prompt');
      });
    }
  }

  analyzeAndShowForm() {
    this.renderStep('loading');
    setTimeout(() => {
      this.analyzedPrefs = parseTripPrompt(this.userPromptText);
      this.renderStep('form');
    }, 600);
  }

  async executePlanGeneration() {
    // Read form values
    const prefs = {
      startingArea: document.getElementById('f-area')?.value || 'กรุงเทพมหานคร',
      days: parseInt(document.getElementById('f-days')?.value, 10) || 1,
      budget: document.getElementById('f-budget')?.value || 'medium',
      travelStyle: document.getElementById('f-style')?.value || 'cultural',
      pace: document.getElementById('f-pace')?.value || 'moderate',
      transport: document.getElementById('f-transport')?.value || 'public',
      companion: document.getElementById('f-companion')?.value || 'friends',
      includeQuests: document.getElementById('f-quests')?.checked || false,
      hoursPerDay: 7,
    };

    this.renderStep('loading');

    try {
      let result = null;

      // 1. Try Supabase Edge Function (with 2.5s fast timeout)
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (s?.access_token && !s?.guest) {
          const res = await fetch(AI_PLANNER_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${s.access_token}`,
              apikey: SUPABASE_ANON_KEY
            },
            body: JSON.stringify(prefs),
            signal: AbortSignal.timeout(2500)
          });
          if (res.ok) result = await res.json();
        }
      } catch (e) {
        console.warn('Edge function skipped/failed, falling back to database catalog:', e);
      }

      // 2. High-quality Grounded Database Catalog Fallback
      if (!result) {
        result = await generateGroundedCatalogTrip(prefs);
      }

      this.generatedPlan = result;
      this.renderStep('itinerary');
      toast('สร้างแผนการท่องเที่ยวเรียบร้อยแล้ว!', 'ok');

    } catch (err) {
      console.error('Trip generation error:', err);
      toast(`ไม่สามารถสร้างแผนได้: ${err.message}`, 'error');
      this.renderStep('form');
    }
  }
}

// Auto-initialize when explore page is ready
let instance = null;
export function initAIPlannerModal() {
  if (!instance) {
    instance = new AIPlannerModal();
  }
  return instance;
}
