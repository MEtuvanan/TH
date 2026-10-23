import { signIn, signUp, resetPassword, getSession, safeNext, loginAsGuest } from './auth.js';
import { esc } from './ui.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let mode = 'signin';

function show(text, type = 'error') {
  const m = $('msg');
  if (!m) return;
  m.hidden = false;
  m.className = `alert alert-${type === 'ok' ? 'ok' : 'error'}`;
  m.innerHTML = text;
}

function setMode(next) {
  mode = next;
  const up = mode === 'signup';
  $('title').textContent = up ? 'สมัครสมาชิก (Create account)' : 'เข้าสู่ระบบ (Sign in)';
  $('submit').innerHTML = up ? '<span>สร้างบัญชีผู้ใช้</span> <span class="btn-arrow">→</span>' : '<span>เข้าสู่ระบบ</span> <span class="btn-arrow">→</span>';
  $('toggle').textContent = up ? 'ฉันมีบัญชีอยู่แล้ว (Sign in)' : 'ยังไม่มีบัญชี? สมัครสมาชิกใหม่';
  $('tab-signin')?.setAttribute('aria-selected', String(!up));
  $('tab-signup')?.setAttribute('aria-selected', String(up));
  $('f-name').hidden = !up;
  $('pw-hint').hidden = !up;
  $('password').autocomplete = up ? 'new-password' : 'current-password';
  $('msg').hidden = true;
}

$('tab-signin')?.addEventListener('click', () => setMode('signin'));
$('tab-signup')?.addEventListener('click', () => setMode('signup'));
$('toggle')?.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

// Instant Demo / Guest Mode handler
$('btn-demo')?.addEventListener('click', () => {
  const name = $('name')?.value.trim() || 'Explorer นักเดินทาง';
  loginAsGuest(name);
  show('เข้าสู่ระบบแบบทดลองใช้งานสำเร็จ กำลังนำท่านเข้าสู่ระบบ...', 'ok');
  setTimeout(() => {
    location.href = safeNext(params.get('next'));
  }, 400);
});

$('forgot')?.addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) { show('กรุณากรอกอีเมลก่อน แล้วกด “Forgot password?”.'); $('email').focus(); return; }
  const { error } = await resetPassword(email);
  show(error ? 'ไม่สามารถส่งลิงก์รีเซ็ตรหัสผ่านได้ กรุณาลองใหม่อีกครั้ง' : 'หากอีเมลนี้มีอยู่ในระบบ ลิงก์สำหรับตั้งรหัสผ่านใหม่จะถูกส่งไปที่กล่องจดหมายของคุณ', error ? 'error' : 'ok');
});

function translateAuthError(err, currentMode) {
  const raw = err?.message || String(err || '');
  if (raw.includes('Invalid login credentials')) {
    return '❌ <strong>ไม่พบบัญชีนี้ หรือรหัสผ่านไม่ถูกต้อง</strong><br><span style="font-size:0.875rem">หากท่านยังไม่เคยสร้างบัญชี กรุณากดแท็บ <strong>"สมัครสมาชิก"</strong> ด้านบน หรือกดปุ่ม <strong>"⚡ เข้าสู่ระบบแบบทดลองใช้งาน (Demo)"</strong> ด้านล่างเพื่อเข้าชมได้ทันทีครับ</span>';
  }
  if (raw.includes('rate limit') || raw.includes('over_email_send_rate_limit')) {
    return '⚠️ <strong>ระบบส่งอีเมลยืนยันของ Supabase เต็มโควต้ารายชั่วโมง</strong><br><span style="font-size:0.875rem">• แนะนำให้ปิด <em>"Confirm email"</em> ใน Supabase Dashboard (Auth &gt; Providers &gt; Email)<br>• หรือกดปุ่ม <strong>"⚡ เข้าสู่ระบบแบบทดลองใช้งาน"</strong> ด้านล่างเพื่อเข้าสู่ระบบได้ทันที</span>';
  }
  if (raw.includes('Email not confirmed')) {
    return '⚠️ <strong>บัญชียังไม่ได้รับการยืนยันอีเมล</strong><br><span style="font-size:0.875rem">กรุณากดลิงก์ในอีเมลของคุณ หรือปิด <em>"Confirm email"</em> ใน Supabase Dashboard ครับ</span>';
  }
  if (raw.includes('User already registered')) {
    return 'ℹ️ อีเมลนี้เคยสมัครสมาชิกแล้ว กรุณากดแท็บ <strong>"เข้าสู่ระบบ"</strong>';
  }
  if (raw.includes('Password should be at least')) {
    return 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
  }
  return raw || 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง';
}

$('form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !$('email').validity.valid) { show('กรุณากรอกอีเมลที่ถูกต้อง (Enter a valid email address)'); return; }
  if (password.length < 6) { show('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร'); return; }

  $('submit').disabled = true;
  try {
    if (mode === 'signup') {
      const { data, error } = await signUp(email, password, $('name').value.trim() || email.split('@')[0]);
      if (error) throw error;
      if (!data.session) {
        show('✅ สร้างบัญชีสำเร็จ! หาก Supabase ของคุณเปิด Confirm email ไว้ กรุณากดยืนยันในอีเมล หรือปิด Confirm email ใน Dashboard แล้วเข้าสู่ระบบได้ทันทีครับ', 'ok');
        setMode('signin');
        return;
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) throw error;
    }
    location.href = safeNext(params.get('next'));
  } catch (err) {
    show(translateAuthError(err, mode));
  } finally {
    $('submit').disabled = false;
  }
});

(async () => {
  if (params.get('expired')) show('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
  if (await getSession() && !params.get('expired')) {
    location.href = safeNext(params.get('next'));
  }
})();
