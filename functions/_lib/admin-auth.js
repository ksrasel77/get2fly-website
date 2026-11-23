// Server-side staff authentication. The browser page is only a convenience: EVERY admin request is checked here.
// Steps: (1) Supabase confirms the login token is real, (2) optional email allow-list, (3) role read from the database with the
// service key (never from the browser), (4) optional two-step verification (MFA) check.
import * as L from './ledger.js';
import { Fail } from './http.js';
const b64json = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };

// need: 'read' (admin or support) or 'write' (admin only)
export async function requireStaff(request, env, need) {
  const m = /^Bearer\s+([\w.-]{20,4000})$/i.exec(request.headers.get('authorization') || '');
  if (!m) throw new Fail(401, 'Please sign in.', { code: 'signin_required' });
  if (!L.ledgerReady(env)) throw new Fail(503, 'Admin is not configured.', { code: 'not_configured' });
  const jwt = m[1];
  let user;
  try {
    const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + jwt } });
    if (!r.ok) throw new Fail(401, 'Please sign in again.', { code: 'signin_required' });
    user = await r.json();
  } catch (e) { if (e instanceof Fail) throw e; throw new Fail(503, 'The sign-in service is unavailable.', { code: 'auth_unavailable' }); }
  if (!user || !user.id) throw new Fail(401, 'Please sign in again.', { code: 'signin_required' });
  if (!user.email_confirmed_at && !user.confirmed_at) throw new Fail(403, 'Your email address is not confirmed.', { code: 'forbidden' });
  const allow = String(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) throw new Fail(403, 'This account is not allowed here.', { code: 'forbidden' });
  const prof = await L.find(env, 'profiles', `id=eq.${encodeURIComponent(user.id)}&select=role`);
  const role = prof && prof.role;
  if (role !== 'admin' && role !== 'support') throw new Fail(403, 'This account is not allowed here.', { code: 'forbidden' });
  if (need === 'write' && role !== 'admin') throw new Fail(403, 'Your account can view but not change payments.', { code: 'read_only' });
  if (String(env.ADMIN_REQUIRE_MFA) === 'true' && b64json(jwt).aal !== 'aal2') throw new Fail(403, 'Two-step verification is required.', { code: 'mfa_required' });
  return { id: user.id, email: user.email, role };
}
