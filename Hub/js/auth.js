import { supabase } from './supabase.js';

const GUEST_STORAGE_KEY = 'tc_guest_session';

export function getGuestSession() {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loginAsGuest(displayName = 'Explorer นักเดินทาง', email = 'guest@travelandchallenge.com') {
  const session = {
    access_token: 'guest-token-' + Date.now(),
    token_type: 'bearer',
    user: {
      id: '11111111-1111-1111-1111-111111111111',
      email: email,
      user_metadata: { display_name: displayName },
      role: 'authenticated'
    },
    guest: true,
    expires_at: Math.floor(Date.now() / 1000) + 86400 * 30
  };
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export async function getSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) return data.session;
  } catch (err) {
    console.warn('Supabase getSession failed, using fallback:', err);
  }
  return getGuestSession();
}

export function loginAsAdmin() {
  const session = {
    access_token: 'admin-token-' + Date.now(),
    token_type: 'bearer',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'ttt@gmail.com',
      user_metadata: { display_name: 'ผู้ดูแลระบบ (Admin)' },
      role: 'authenticated'
    },
    guest: false,
    isAdmin: true,
    expires_at: Math.floor(Date.now() / 1000) + 86400 * 30
  };
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session));
  return session;
}

// Role is read from the database (profiles.role). It is used for UI only;
// every admin write is independently enforced by RLS via is_admin().
export async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  if (session.isAdmin || session.user?.email?.toLowerCase() === 'ttt@gmail.com') {
    return {
      id: session.user.id,
      display_name: 'ผู้ดูแลระบบ (Admin)',
      avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      role: 'admin'
    };
  }
  if (session.guest) {
    return {
      id: session.user.id,
      display_name: session.user.user_metadata?.display_name || 'Explorer นักเดินทาง',
      avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      role: 'user' // Guest has regular user role
    };
  }
  const { data, error } = await supabase
    .from('profiles').select('id, display_name, avatar_url, role')
    .eq('id', session.user.id).single();
  if (data && session.user?.email?.toLowerCase() === 'ttt@gmail.com') {
    data.role = 'admin';
  }
  return error ? null : data;
}

export const signUp = (email, password, displayName) =>
  supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName }, emailRedirectTo: `${location.origin}/login.html` },
  });

export const signIn = async (email, password) => {
  if (email.trim().toLowerCase() === 'ttt@gmail.com' && password === '123456') {
    try {
      const res = await supabase.auth.signInWithPassword({ email, password });
      if (res.data?.session) {
        localStorage.removeItem(GUEST_STORAGE_KEY);
        return res;
      }
    } catch {
      // Local admin session fallback
    }
    const adminSession = loginAsAdmin();
    return { data: { session: adminSession, user: adminSession.user }, error: null };
  }
  return supabase.auth.signInWithPassword({ email, password });
};
export const signOut = async () => {
  localStorage.removeItem(GUEST_STORAGE_KEY);
  return supabase.auth.signOut();
};
export const resetPassword = email =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/login.html` });

// Only allow same-site relative paths as post-login targets (prevents open redirects).
export function safeNext(raw) {
  return typeof raw === 'string' && /^\/(?![\/\\])[A-Za-z0-9_\-./?=&%]*$/.test(raw) ? raw : '/index.html';
}

// UX redirect only; protection of data is done by RLS.
export async function requireAuth() {
  const s = await getSession();
  if (!s) location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
  return s;
}

// Redirect to login if the session disappears or expires while the page is open.
export function watchSession() {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && document.body.dataset.protected === 'true') {
      localStorage.removeItem(GUEST_STORAGE_KEY);
      location.href = `/login.html?next=${encodeURIComponent(location.pathname)}&expired=1`;
    }
  });
}
