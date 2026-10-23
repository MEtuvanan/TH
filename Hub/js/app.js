import { getProfile, signOut, getSession, watchSession } from './auth.js';
import { esc } from './ui.js';
import { getLang, toggleLang, t } from './i18n.js';

const NAV = [
  ['/explore.html',    'nav_explore',    '/explore'],
  ['/quests.html',     'nav_quests',     '/quests'],
  ['/collection.html', 'nav_collection', '/collection'],
  ['/journal.html',    'nav_journal',    '/journal'],
  ['/calendar.html',   'nav_calendar',   '/calendar'],
];

// Apply saved language on boot
document.documentElement.lang = getLang();

function renderNav() {
  const el = document.getElementById('site-nav');
  if (!el) return;
  const cleanHere = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const lang = getLang();
  const langBtnLabel = lang === 'th' ? '🇬🇧 EN' : '🇹🇭 TH';
  const langBtnTitle = lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย';

  el.innerHTML = `
    <a class="brand" href="/index.html">
      <span class="brand-badge">TH</span>
      Travel <span>&amp;</span> Challenge
    </a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Toggle menu">☰</button>
    <ul id="nav-links" class="nav-links">
      ${NAV.map(([h, key, clean]) => {
        const label = t(key);
        const isCurrent = cleanHere === clean || location.pathname === h;
        return `<li><a href="${h}" ${isCurrent ? 'aria-current="page"' : ''}>${esc(label)}</a></li>`;
      }).join('')}
      <li>
        <button class="btn btn-small btn-lang" id="lang-toggle" title="${langBtnTitle}" type="button">${langBtnLabel}</button>
      </li>
      <li id="nav-auth"></li>
    </ul>`;

  const btn = el.querySelector('.nav-toggle');
  btn.addEventListener('click', () => {
    const open = el.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.classList.contains('open')) {
      el.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });

  document.getElementById('lang-toggle').addEventListener('click', () => {
    toggleLang();
    renderNav();
    renderFooter();
    renderAuth();
  });
}

function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.className = 'site-footer';
  el.innerHTML = `<div class="container footer-grid">
    <div class="footer-brand">
      <a class="brand" href="/index.html"><span class="brand-badge">TH</span> Travel <span>&amp;</span> Challenge</a>
      <p class="meta">${t('nav_explore') === 'สำรวจสถานที่' ? 'เปลี่ยนทุกการเดินทางให้กลายเป็นผจญภัย ค้นพบสถานที่จริงทั่วไทย พิชิตเควสท์ สะสมรางวัล ปลดล็อกตัวละคร และบันทึกไดอารี่การเดินทาง' : 'Turn every trip into an adventure. Discover authentic destinations across Thailand, complete quests, earn token rewards, collect characters, and keep a personal travel diary.'}</p>
    </div>
    <nav aria-label="Footer"><ul class="footer-links">
      <li><strong>${t('nav_explore')}</strong></li>
      <li><a href="/explore.html">${t('nav_explore')}</a></li>
      <li><a href="/quests.html">${t('nav_quests')}</a></li>
      <li><a href="/collection.html">${t('nav_collection')}</a></li>
    </ul></nav>
    <nav aria-label="Account"><ul class="footer-links">
      <li><strong>${t('nav_profile')} &amp; ${t('nav_journal')}</strong></li>
      <li><a href="/profile.html">${t('nav_profile')}</a></li>
      <li><a href="/journal.html">${t('nav_journal')}</a></li>
      <li><a href="/calendar.html">${t('nav_calendar')}</a></li>
      <li><a href="/login.html">${t('nav_signin')} / สมัครสมาชิก</a></li>
    </ul></nav>
  </div>
  <div class="container footer-bottom">
    <p class="meta">© 2026 Travel and Challenge. ${getLang() === 'th' ? 'ครอบคลุมทุกจังหวัดทั่วไทย พร้อมข้อมูลที่ผ่านการตรวจสอบแล้ว' : 'Nationwide coverage with verified destinations.'}</p>
  </div>`;
}

async function renderAuth() {
  const slot = document.getElementById('nav-auth');
  if (!slot) return;
  const session = await getSession();
  if (!session) {
    slot.innerHTML = `<a class="btn btn-small btn-secondary nav-btn" href="/login.html">${t('nav_signin')}</a>`;
    return;
  }
  const p = await getProfile();
  const isGuest = session.guest;
  slot.innerHTML = `
    <a class="nav-user-pill" href="/profile.html">
      <span class="user-avatar-icon">👤</span>
      <span>${esc(p?.display_name || (isGuest ? 'Guest Explorer' : 'Profile'))}</span>
      ${isGuest ? '<span style="font-size:.7rem;background:rgba(245,158,11,.2);color:#d97706;padding:.1rem .4rem;border-radius:8px;font-weight:700">DEMO</span>' : ''}
    </a>
    <button class="btn btn-small btn-secondary" id="logout" type="button">${t('nav_signout')}</button>`;
  slot.style.display = 'contents';
  document.getElementById('logout').addEventListener('click', async () => {
    await signOut();
    location.href = '/index.html';
  });
}

renderNav();
renderFooter();
renderAuth();
watchSession();
