// Durable ledger on Supabase (Postgres REST). Every write FAILS CLOSED: if a record cannot be saved the caller must stop.
export class LedgerError extends Error { constructor(message, code, status, detail) { super(message); this.code = code; this.status = status; this.detail = detail || null; } }
export const ledgerReady = (env) => !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);

async function rest(env, method, path, body, prefer) {
  if (!ledgerReady(env)) throw new LedgerError('ledger is not configured', 'unconfigured');
  let r;
  try {
    // New-format keys (sb_secret_...) are not JWTs and must be sent in the apikey header ONLY. Old service_role keys (JWTs) also go in Authorization.
    const key = env.SUPABASE_SERVICE_KEY, isJwt = /^eyJ/.test(key);
    r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1${path}`, {
      method, headers: { apikey: key, ...(isJwt ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) { throw new LedgerError('ledger unreachable', 'unavailable', 0, { reason: 'network error reaching SUPABASE_URL (check the address)' }); }
  const text = await r.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep null */ }
  if (r.ok) return data;
  const detail = { httpStatus: r.status, pgCode: data && data.code, message: String((data && (data.message || data.hint || data.error_description)) || text || 'no details').slice(0, 200) };   // never contains keys
  if (r.status === 409 || (data && data.code === '23505')) throw new LedgerError('duplicate', 'conflict', r.status, detail);
  if (r.status >= 500) throw new LedgerError('ledger error', 'unavailable', r.status, detail);
  throw new LedgerError(detail.message, 'rejected', r.status, detail);
}
const q = encodeURIComponent;
export const insert = async (env, table, row) => (await rest(env, 'POST', `/${table}`, row, 'return=representation'))[0];
export const find = async (env, table, query) => (await rest(env, 'GET', `/${table}?${query}&limit=1`))[0] || null;
export const list = (env, table, query) => rest(env, 'GET', `/${table}?${query}`);
export const patch = async (env, table, id, fields) => (await rest(env, 'PATCH', `/${table}?id=eq.${q(id)}`, fields, 'return=representation'))[0] || null;
// Compare-and-set: changes the row only if its status is still one of `from`. Returns null when someone else already moved it.
export const cas = async (env, table, id, from, fields) => (await rest(env, 'PATCH', `/${table}?id=eq.${q(id)}&status=in.(${from.join(',')})`, fields, 'return=representation'))[0] || null;
export async function event(env, e) {
  try { await insert(env, 'payment_events', e); return { recorded: true }; }
  catch (err) { if (err.code === 'conflict') return { duplicate: true }; throw err; }
}
