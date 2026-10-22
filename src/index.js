// Ferrodistribuciones · servidor (Cloudflare Worker + D1)
// Todas las reglas del negocio y los permisos se validan aquí, no en el navegador.

const ROLES = ['ventas', 'bodega', 'verificacion', 'despacho', 'contabilidad', 'gerencia'];
const ROLE_NAMES = { ventas: 'Ventas', bodega: 'Bodega', verificacion: 'Verificación', despacho: 'Despacho', contabilidad: 'Contabilidad', gerencia: 'Gerencia' };
const LIST_STD = ['cf', 'cr', 'm1', 'm2'];
const CAT_KEYS = ['cf', 'cr', 'crm', 'm1', 'm2'];
const LISTS = { cf: 'Precio contado ferretería', cr: 'Precio crédito ferretería', m1: 'Precio 1 mostrador', m2: 'Precio 2 mostrador', crm: 'Precio crédito ferreterías municipal' };
const ECO_LISTS = { cf: 'Precio contado solo ferreterías en Sincelejo', cr: 'Precio crédito Sincelejo y precio contado municipal', crm: 'Precio crédito ferreterías municipal' };
const FALLBACK = { crm: 'cr', esp: 'cf' };
const DEFAULT_LIST = 'm1';
const STOCK_MIN = 2;
const PRIO = { urgente: 'Urgente', alta: 'Alta', normal: 'Normal' };
const PACK = { sin_empacar: 'Sin empacar', empacado: 'Empacado', agotado: 'Agotado', cantidad: 'Cantidad modificada', pendiente: 'Pendiente por empacar', trasladar: 'Se traslada a pedido nuevo', trasladado: 'Trasladado' };
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

// ---------- esquema ----------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS counters(k TEXT PRIMARY KEY, v INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO counters(k,v) VALUES ('rev',0),('pedido',0),('remision',0)`,
  `CREATE TABLE IF NOT EXISTS guard(x INTEGER CHECK (x = 0))`,
  `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, roles TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, pw_iter INTEGER NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER, created_by TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, section TEXT, row INTEGER, prices TEXT NOT NULL DEFAULT '{}', ue REAL, stock REAL, no_credit INTEGER NOT NULL DEFAULT 0, inactive INTEGER NOT NULL DEFAULT 0, source TEXT, updated_at INTEGER, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS products_rev ON products(rev)`,
  `CREATE TABLE IF NOT EXISTS price_history(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, list TEXT, from_price REAL, to_price REAL, at INTEGER, by TEXT, reason TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS ph_rev ON price_history(rev)`,
  `CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, data TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS customers_rev ON customers(rev)`,
  `CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT, seller TEXT, created_at INTEGER, version INTEGER NOT NULL DEFAULT 1, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS orders_rev ON orders(rev)`,
  `CREATE TABLE IF NOT EXISTS price_requests(id TEXT PRIMARY KEY, order_id TEXT, data TEXT NOT NULL, status TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS pr_rev ON price_requests(rev)`,
  `CREATE TABLE IF NOT EXISTS remisiones(id TEXT PRIMARY KEY, order_id TEXT, data TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS rem_rev ON remisiones(rev)`,
  `CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, by TEXT, to_roles TEXT, to_users TEXT, text TEXT, ref TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS notif_rev ON notifications(rev)`,
  `CREATE TABLE IF NOT EXISTS notification_reads(notification_id INTEGER NOT NULL, user_id TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(notification_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS nr_user_rev ON notification_reads(user_id, rev)`,
  `CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, by TEXT, role TEXT, action TEXT, entity TEXT, ref TEXT, detail TEXT, reason TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS audit_rev ON audit(rev)`,
  `CREATE INDEX IF NOT EXISTS audit_ref ON audit(ref)`,
  `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'La auditoría no se puede modificar'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'La auditoría no se puede borrar'); END`,
  `CREATE TABLE IF NOT EXISTS prefs(user_id TEXT PRIMARY KEY, audit_seen INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS push_user ON push_subs(user_id)`,
  `INSERT OR REPLACE INTO meta(k,v) VALUES ('schema','2')`,
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  try {
    const r = await env.DB.prepare(`SELECT v FROM meta WHERE k='schema'`).first();
    if (r && r.v === '2') { schemaReady = true; return; }
  } catch (e) { /* la tabla aún no existe */ }
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  schemaReady = true;
}

// ---------- utilidades ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = m => new HttpError(400, m);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const now = () => Date.now();
const enc = s => new TextEncoder().encode(s);
const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc(s)));
const uid = () => crypto.randomUUID();
const shortId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const pad = (n, w = 5) => String(n).padStart(w, '0');
const money = n => n == null || isNaN(n) ? '—' : '$' + Math.round(n).toLocaleString('es-CO');
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : NaN; };
const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const isEco = p => !!p && ((p.prices && p.prices.crm != null) || /sanitario ecologico/.test(norm(p.section)));
const keysFor = p => isEco(p) ? CAT_KEYS : LIST_STD;
const LN = (k, p) => (isEco(p) && ECO_LISTS[k]) || LISTS[k] || k;
function priceFor(p, list) {
  const pr = (p && p.prices) || {};
  if (pr[list] != null) return { key: list, price: pr[list] };
  const fb = FALLBACK[list];
  if (fb && pr[fb] != null) return { key: fb, price: pr[fb] };
  return { key: null, price: null };
}
const custList = c => { const l = c.list || DEFAULT_LIST; return LIST_STD.includes(l) ? l : (FALLBACK[l] || DEFAULT_LIST); };
function shipQty(l) { const s = l.pack && l.pack.state; if (s === 'agotado' || s === 'trasladado' || s === 'trasladar') return 0; if (s === 'cantidad') return Number(l.pack.qty) || 0; return Number(l.qty) || 0; }
const priceOk = l => l.priceSource === 'especial' ? !!(l.req && l.req.status === 'aprobado') : l.price != null;
function packBlockers(o) { const b = []; o.lines.forEach(l => { const s = l.pack.state; if (s === 'sin_empacar') b.push(`${l.code}: sin marcar como empacado`); if (s === 'pendiente') b.push(`${l.code}: pendiente por empacar`); }); return b; }
function dispatchBlockers(o) {
  const b = [];
  o.lines.forEach(l => {
    const s = l.pack.state;
    if (s === 'sin_empacar' || s === 'pendiente' || s === 'trasladar') b.push(`${l.code}: ${PACK[s].toLowerCase()}`);
    if (shipQty(l) > 0 && !l.verified) b.push(`${l.code}: sin verificar`);
    if (shipQty(l) > 0 && !priceOk(l)) b.push(`${l.code}: precio sin autorización`);
  });
  if (!b.length && !o.lines.some(l => shipQty(l) > 0)) b.push('El pedido no tiene productos para entregar');
  return b;
}

// ---------- claves ----------
async function hashPw(pw, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(salt), iterations: iter }, key, 256);
  return b64(bits);
}
function sameText(a, b) {
  const x = enc(a), y = enc(b);
  if (x.length !== y.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0;
}
const iterations = env => Math.min(100000, Math.max(10000, int(env.PBKDF2_ITER) || 20000));
async function newPassword(env, pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('La clave debe tener al menos 8 caracteres.');
  if (pw.length > 128) throw bad('La clave es demasiado larga.');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const iter = iterations(env);
  return { pw_hash: await hashPw(pw, salt, iter), pw_salt: salt, pw_iter: iter };
}

// ---------- sesión ----------
function cookieValue(req, name) {
  const c = req.headers.get('cookie') || '';
  for (const part of c.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return null;
}
function sessionCookie(token, maxAge, req) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `ferro_s=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
async function currentUser(req, env) {
  const t = cookieValue(req, 'ferro_s');
  if (!t) return null;
  const h = await sha256(t);
  const r = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).bind(h, now()).first();
  if (!r) return null;
  r.roles = parse(r.roles) || [];
  return r;
}
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, roles: u.roles, mustChange: !!u.must_change });

// ---------- escritura agrupada ----------
async function nextCounter(env, k) {
  const r = await env.DB.prepare(`UPDATE counters SET v = v + 1 WHERE k = ? RETURNING v`).bind(k).first();
  return r.v;
}
class Tx {
  constructor(env, user, role, rev) { this.env = env; this.user = user; this.role = role; this.rev = rev; this.st = []; this.t = now(); }
  add(sql, ...args) { this.st.push(this.env.DB.prepare(sql).bind(...args)); return this; }
  // Si la sentencia anterior no cambió ninguna fila, aborta todo el lote.
  guard() { return this.add(`INSERT INTO guard(x) SELECT 1 WHERE changes() = 0`); }
  audit(action, entity, ref, detail = '', reason = '') { return this.add(`INSERT INTO audit(at,by,role,action,entity,ref,detail,reason,rev) VALUES (?,?,?,?,?,?,?,?,?)`, this.t, this.user.id, this.role, action, entity, ref || '', detail || '', reason || '', this.rev); }
  notify(toRoles, toUsers, text, ref = '') { (this.pushes = this.pushes || []).push({ toRoles: toRoles || [], toUsers: (toUsers || []).filter(Boolean) }); return this.add(`INSERT INTO notifications(at,by,to_roles,to_users,text,ref,rev) VALUES (?,?,?,?,?,?,?)`, this.t, this.user.id, JSON.stringify(toRoles || []), JSON.stringify((toUsers || []).filter(Boolean)), text, ref || '', this.rev); }
  saveOrder(o, version) { o.updatedAt = this.t; this.add(`UPDATE orders SET data = ?, status = ?, version = version + 1, rev = ? WHERE id = ? AND version = ?`, JSON.stringify(o), o.status, this.rev, o.id, version); return this.guard(); }
  async run() {
    if (!this.st.length) return;
    try { await this.env.DB.batch(this.st); if (this.pushes && this.env.ctx) this.env.ctx.waitUntil(sendPushes(this.env, this.pushes, this.user.id).catch(e => console.error('push', e))); }
    catch (e) {
      const m = String(e && (e.message || e));
      if (/CHECK constraint failed/i.test(m)) throw new HttpError(409, 'Otra persona cambió este pedido al mismo tiempo. Ya se cargó la versión actual; revisa y vuelve a intentar.');
      throw e;
    }
  }
}
async function tx(env, user, role) { return new Tx(env, user, role, await nextCounter(env, 'rev')); }

// ---------- notificaciones al dispositivo (Web Push sin contenido) ----------
// El aviso viaja vacío; el dispositivo pide el texto a /api/push/latest con su sesión.
let vapidCache = null;
async function vapid(env) {
  if (vapidCache) return vapidCache;
  let r = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'vapid'`).first();
  if (!r) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = b64url(await crypto.subtle.exportKey('raw', kp.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    await env.DB.prepare(`INSERT OR IGNORE INTO meta(k,v) VALUES ('vapid', ?)`).bind(JSON.stringify({ pub, jwk })).run();
    r = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'vapid'`).first();
  }
  const v = JSON.parse(r.v);
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidCache = { pub: v.pub, key };
  return vapidCache;
}
async function vapidJwt(env, endpoint, subject) {
  const v = await vapid(env);
  const aud = new URL(endpoint).origin;
  const enc64 = o => b64url(enc(JSON.stringify(o)));
  const unsigned = enc64({ typ: 'JWT', alg: 'ES256' }) + '.' + enc64({ aud, exp: Math.floor(now() / 1000) + 12 * 3600, sub: subject });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc(unsigned));
  return { jwt: unsigned + '.' + b64url(sig), pub: v.pub };
}
async function sendPushes(env, pushes, actorId) {
  const roles = new Set(pushes.flatMap(p => p.toRoles)), users = new Set(pushes.flatMap(p => p.toUsers));
  const us = (await env.DB.prepare(`SELECT id, roles FROM users WHERE active = 1`).all()).results;
  const ids = us.filter(u => u.id !== actorId && (users.has(u.id) || (parse(u.roles) || []).some(r => roles.has(r)))).map(u => u.id);
  if (!ids.length) return;
  const subs = (await env.DB.prepare(`SELECT endpoint FROM push_subs WHERE user_id IN (${ids.map(() => '?').join(',')}) LIMIT 40`).bind(...ids).all()).results;
  const subject = env.VAPID_SUBJECT || env.PUBLIC_URL || 'mailto:avisos@ferrodistribuciones.app';
  const jwts = {};
  await Promise.all(subs.map(async s => {
    try {
      const origin = new URL(s.endpoint).origin;
      const j = jwts[origin] || (jwts[origin] = await vapidJwt(env, s.endpoint, subject));
      const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'high', Authorization: `vapid t=${j.jwt}, k=${j.pub}`, 'Content-Length': '0' } });
      if (r.status === 404 || r.status === 410) await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(s.endpoint).run();
    } catch (e) { console.error('push', e && e.message); }
  }));
}
function validEndpoint(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && u.length < 1000; } catch (e) { return false; }
}

// ---------- permisos ----------
function can(user, ...roles) { return user.roles.includes('gerencia') || roles.some(r => user.roles.includes(r)); }
function need(user, ...roles) { if (!can(user, ...roles)) throw new HttpError(403, `Esta acción es solo para ${roles.map(r => ROLE_NAMES[r]).join(' o ')}.`); }

// ---------- lecturas ----------
async function getOrder(env, id) {
  const r = await env.DB.prepare(`SELECT data, version FROM orders WHERE id = ?`).bind(str(id, 20)).first();
  if (!r) throw new HttpError(404, 'No se encontró el pedido.');
  return { o: JSON.parse(r.data), version: r.version };
}
async function getProduct(env, id) {
  const r = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(str(id, 60)).first();
  if (!r) return null;
  r.prices = parse(r.prices) || {};
  return r;
}
async function getProducts(env, ids) {
  const out = {};
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 50) {
    const part = uniq.slice(i, i + 50);
    const rs = await env.DB.prepare(`SELECT * FROM products WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    rs.results.forEach(r => { r.prices = parse(r.prices) || {}; out[r.id] = r; });
  }
  return out;
}

// ---------- acciones ----------
const A = {};

A['customer-save'] = async (env, u, role, b) => {
  need(u, 'ventas');
  const isG = u.roles.includes('gerencia');
  const name = str(b.name, 120); if (!name) throw bad('Escribe el nombre del cliente.');
  const addresses = (Array.isArray(b.addresses) ? b.addresses : []).map(a => str(a, 200)).filter(Boolean).slice(0, 20);
  const requestedList = LIST_STD.includes(b.requestedList) ? b.requestedList : DEFAULT_LIST;
  const payment = b.payment === 'credito' ? 'credito' : 'contado';
  let old = null;
  if (b.id) { const r = await env.DB.prepare(`SELECT data FROM customers WHERE id = ?`).bind(str(b.id, 60)).first(); if (!r) throw new HttpError(404, 'No se encontró el cliente.'); old = JSON.parse(r.data); }
  const id = b.id ? str(b.id, 60) : uid();
  const c = Object.assign({}, old || {}, { name, doc: str(b.doc, 30), phone: str(b.phone, 30), city: str(b.city, 60), payment, addresses, requestedList, updatedAt: now() });
  if (!old) { c.createdBy = u.id; c.createdAt = now(); c.list = null; }
  if (isG && c.list !== requestedList) { c.list = requestedList; c.listSetBy = u.id; c.listSetAt = now(); }
  const t = await tx(env, u, role);
  t.add(`INSERT INTO customers(id,data,rev) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, rev = excluded.rev`, id, JSON.stringify(c), t.rev);
  if (!old) t.audit('Registró cliente', 'cliente', id, name);
  else {
    const lbl = { name: 'Nombre', doc: 'Documento', phone: 'Teléfono', city: 'Municipio', payment: 'Pago', requestedList: 'Lista solicitada' };
    const diff = Object.keys(lbl).filter(k => (old[k] ?? '') !== (c[k] ?? '')).map(k => `${lbl[k]}: ${old[k] || '—'} → ${c[k] || '—'}`);
    if ((old.addresses || []).join('|') !== addresses.join('|')) diff.push(`Direcciones: ${(old.addresses || []).join(' / ') || '—'} → ${addresses.join(' / ') || '—'}`);
    t.audit('Editó cliente', 'cliente', id, `${name} · ${diff.join('; ') || 'sin cambios'}`);
  }
  if (isG && (!old || old.list !== c.list)) t.audit('Asignó lista de precios', 'cliente', id, `${name}: ${LISTS[c.list]}`);
  if (!isG && requestedList !== custList(c)) t.notify(['gerencia'], [], `${name}: se solicita la lista ${LISTS[requestedList]}`, '');
  await t.run();
  return { id };
};

A['customer-list'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const r = await env.DB.prepare(`SELECT data FROM customers WHERE id = ?`).bind(str(b.id, 60)).first();
  if (!r) throw new HttpError(404, 'No se encontró el cliente.');
  const c = JSON.parse(r.data);
  const list = b.keep ? custList(c) : c.requestedList;
  c.list = list; c.requestedList = list; c.listSetBy = u.id; c.listSetAt = now();
  const t = await tx(env, u, role);
  t.add(`UPDATE customers SET data = ?, rev = ? WHERE id = ?`, JSON.stringify(c), t.rev, b.id);
  t.audit(b.keep ? 'Mantuvo lista de precios' : 'Asignó lista de precios', 'cliente', b.id, `${c.name}: ${LISTS[list]}`);
  if (c.createdBy) t.notify([], [c.createdBy], `Gerencia ${b.keep ? 'mantuvo' : 'asignó'} ${LISTS[list]} para ${c.name}`, '');
  await t.run();
  return {};
};

A['product-save'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const p = await getProduct(env, b.id); if (!p) throw new HttpError(404, 'No se encontró el producto.');
  const reason = str(b.reason, 300); if (!reason) throw bad('Escribe el motivo del cambio.');
  const t = await tx(env, u, role);
  const prices = { ...p.prices }; const changes = [];
  for (const k of CAT_KEYS) {
    if (!b.prices || !(k in b.prices)) continue;
    const raw = b.prices[k]; const v = raw === '' || raw == null ? null : int(raw);
    if (v != null && !(v >= 0)) throw bad('Revisa el precio de ' + LN(k, p) + '.');
    const old = prices[k] ?? null;
    if (v !== old) { changes.push({ k, old, v }); if (v == null) delete prices[k]; else prices[k] = v; }
  }
  let stockChange = null;
  if (b.stock !== undefined && b.stock !== '' && b.stock !== null) { const s = int(b.stock); if (isNaN(s)) throw bad('Revisa las existencias.'); if (s !== p.stock) stockChange = { old: p.stock, v: s }; }
  if (!changes.length && !stockChange) throw bad('No cambiaste ningún precio ni las existencias.');
  if (changes.length) {
    t.add(`UPDATE products SET prices = ?, updated_at = ?, rev = ? WHERE id = ?`, JSON.stringify(prices), t.t, t.rev, p.id);
    changes.forEach(c => t.add(`INSERT INTO price_history(product_id,list,from_price,to_price,at,by,reason,rev) VALUES (?,?,?,?,?,?,?,?)`, p.id, c.k, c.old, c.v, t.t, u.id, reason, t.rev));
    t.audit('Cambió precios', 'producto', p.code, changes.map(c => `${LN(c.k, p)}: ${money(c.old)} → ${money(c.v)}`).join('; '), reason);
  }
  if (stockChange) {
    t.add(`UPDATE products SET stock = ?, rev = ? WHERE id = ?`, stockChange.v, t.rev, p.id);
    t.audit('Ajustó existencias', 'producto', p.code, `${stockChange.old ?? '—'} → ${stockChange.v}`, reason);
    stockAlert(t, p, stockChange.old == null ? Infinity : stockChange.old, stockChange.v, '');
  }
  await t.run();
  return {};
};

A['import-apply'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const reason = str(b.reason, 300) || 'Nueva lista de precios';
  const file = str(b.file, 120);
  const items = Array.isArray(b.items) ? b.items.slice(0, 120) : [];
  const retire = Array.isArray(b.retire) ? b.retire.slice(0, 200).map(x => str(x, 60)) : [];
  const existing = await getProducts(env, items.filter(i => i.id).map(i => str(i.id, 60)));
  const t = await tx(env, u, role);
  let changed = 0, added = 0, stocked = 0;
  for (const it of items) {
    const prices = {};
    for (const k of [...CAT_KEYS, 'esp']) { const v = it.prices && it.prices[k]; if (v != null && v !== '' && Number.isFinite(Number(v))) prices[k] = Math.round(Number(v)); }
    const code = str(it.code, 40), name = str(it.name, 200), section = str(it.section, 80);
    const ue = it.ue == null || it.ue === '' || !Number.isFinite(Number(it.ue)) ? null : Number(it.ue);
    const row = int(it.row) || null, noCredit = it.noCredit ? 1 : 0;
    if (!code || !name) continue;
    const p = it.id ? existing[str(it.id, 60)] : null;
    if (p) {
      const diffs = CAT_KEYS.filter(k => (p.prices[k] ?? null) !== (prices[k] ?? null));
      diffs.forEach(k => t.add(`INSERT INTO price_history(product_id,list,from_price,to_price,at,by,reason,rev) VALUES (?,?,?,?,?,?,?,?)`, p.id, k, p.prices[k] ?? null, prices[k] ?? null, t.t, u.id, reason, t.rev));
      if (diffs.length) changed++;
      const setStock = b.stock && ue != null && ue !== p.stock;
      if (setStock) stocked++;
      t.add(`UPDATE products SET code = ?, name = ?, section = ?, row = ?, prices = ?, ue = ?, no_credit = ?, inactive = 0, source = ?, updated_at = ?, rev = ?${setStock ? ', stock = ?' : ''} WHERE id = ?`,
        ...[code, name, section, row, JSON.stringify(prices), ue, noCredit, file, t.t, t.rev, ...(setStock ? [ue] : []), p.id]);
    } else {
      added++;
      t.add(`INSERT INTO products(id,code,name,section,row,prices,ue,stock,no_credit,inactive,source,updated_at,rev) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?)`, 'p' + shortId(), code, name, section, row, JSON.stringify(prices), ue, ue, noCredit, file, t.t, t.rev);
    }
  }
  retire.forEach(id => t.add(`UPDATE products SET inactive = 1, rev = ? WHERE id = ?`, t.rev, id));
  t.audit('Actualizó la lista de precios', 'catálogo', file, `${b.part ? 'Parte ' + str(b.part, 20) + ' · ' : ''}${changed} con cambio de precio, ${added} nuevos${retire.length ? ', ' + retire.length + ' retirados' : ''}${stocked ? ', existencias actualizadas en ' + stocked : ''}`, reason);
  await t.run();
  return { changed, added, retired: retire.length, stocked };
};

A['order-create'] = async (env, u, role, b) => {
  need(u, 'ventas');
  const cr = await env.DB.prepare(`SELECT data FROM customers WHERE id = ?`).bind(str(b.customerId, 60)).first();
  if (!cr) throw bad('Elige un cliente.');
  const c = JSON.parse(cr.data);
  const address = str(b.address, 200); if (!address) throw bad('Elige la dirección de entrega.');
  const payment = b.payment === 'credito' ? 'credito' : 'contado';
  const priority = PRIO[b.priority] ? b.priority : 'normal';
  const inLines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
  if (!inLines.length) throw bad('Agrega al menos un producto.');
  const list = custList(c);
  const P = await getProducts(env, inLines.map(l => str(l.pid, 60)));
  const lines = inLines.map(l => {
    const p = P[str(l.pid, 60)]; if (!p || p.inactive) throw bad('Uno de los productos ya no está disponible. Quítalo y vuelve a buscarlo.');
    const qty = int(l.qty); if (!(qty > 0)) throw bad(`Revisa la cantidad de ${p.code}.`);
    if (p.no_credit && payment === 'credito') throw bad(`${p.code} ${p.name} no se vende a crédito. Quítalo o cambia la forma de pago.`);
    const pf = priceFor(p, list); const nuevo = l.pick === 'nuevo';
    let price;
    if (nuevo) {
      price = int(l.special && l.special.price); if (!(price > 0)) throw bad(`Escribe el precio nuevo de ${p.code}.`);
      if (!str(l.special.reason, 300)) throw bad(`Escribe el motivo del precio nuevo de ${p.code}.`);
    } else {
      if (!keysFor(p).includes(l.pick) || p.prices[l.pick] == null) throw bad(`Elige un precio para ${p.code}.`);
      price = p.prices[l.pick];
    }
    return { id: shortId(), pid: p.id, code: p.code, name: p.name, qty, listKey: nuevo ? pf.key : l.pick, listName: nuevo ? null : LN(l.pick, p), listPrice: nuevo ? pf.price : price, custListKey: pf.key, price, priceSource: nuevo ? 'especial' : 'lista', req: nuevo ? { id: uid(), status: 'pendiente', price, reason: str(l.special.reason, 300) } : null, pack: { state: 'sin_empacar' }, verified: false };
  });
  const n = await nextCounter(env, 'pedido'); const id = 'P-' + pad(n);
  const t = await tx(env, u, role);
  const hasReq = lines.some(l => l.req);
  const o = { id, num: n, customerId: cr ? b.customerId : null, customer: { name: c.name, doc: c.doc || '', phone: c.phone || '', city: c.city || '' }, address, payment, priority, notes: str(b.notes, 300), list, seller: u.id, createdAt: t.t, status: hasReq ? 'esperando_precio' : 'por_preparar', statusAt: t.t, lines, returns: [] };
  t.add(`INSERT INTO orders(id,data,status,seller,created_at,version,rev) VALUES (?,?,?,?,?,1,?)`, id, JSON.stringify(o), o.status, u.id, t.t, t.rev);
  lines.filter(l => l.req).forEach(l => t.add(`INSERT INTO price_requests(id,order_id,data,status,rev) VALUES (?,?,?,?,?)`, l.req.id, id, JSON.stringify({ orderId: id, lineId: l.id, pid: l.pid, code: l.code, name: l.name, qty: l.qty, customerId: b.customerId, customerName: c.name, list: l.listKey || list, listPrice: l.listPrice, price: l.price, reason: l.req.reason, by: u.id, at: t.t, status: 'pendiente' }), 'pendiente', t.rev));
  const other = lines.filter(l => l.priceSource === 'lista' && l.custListKey && l.listKey !== l.custListKey);
  t.audit('Creó el pedido', 'pedido', id, `${lines.length} líneas · ${money(lines.reduce((a, l) => a + l.qty * l.price, 0))}${other.length ? ' · precio de otra lista en: ' + other.map(l => l.code + ' (' + l.listName + ')').join(', ') : ''}`);
  if (hasReq) t.notify(['gerencia'], [], `${id}: ${lines.filter(l => l.req).length} precio(s) nuevo(s) por aprobar para ${c.name}`, id);
  else t.notify(['bodega'], [], `${id} de ${c.name} entró a la cola (${PRIO[priority]})`, id);
  await t.run();
  return { id, status: o.status };
};

A['order-qty'] = async (env, u, role, b) => {
  const { o, version } = await getOrder(env, b.id);
  if (!(u.roles.includes('gerencia') || (u.roles.includes('ventas') && o.seller === u.id))) throw new HttpError(403, 'Solo el vendedor del pedido o gerencia pueden cambiar cantidades.');
  if (!['esperando_precio', 'por_preparar'].includes(o.status)) throw bad('Bodega ya tomó este pedido. Pide el cambio a bodega o a gerencia.');
  const changes = []; const t = await tx(env, u, role);
  for (const l of o.lines) {
    if (!b.qtys || !(l.id in b.qtys)) continue;
    const v = int(b.qtys[l.id]); if (!(v > 0)) throw bad(`Revisa la cantidad de ${l.code}.`);
    if (v !== l.qty) {
      changes.push(`${l.code}: ${l.qty} → ${v}`); l.qty = v;
      if (l.req) t.add(`UPDATE price_requests SET data = json_set(data,'$.qty',?), rev = ? WHERE id = ?`, v, t.rev, l.req.id);
    }
  }
  if (!changes.length) throw bad('No cambiaste ninguna cantidad.');
  t.saveOrder(o, version);
  t.audit('Cambió cantidades', 'pedido', o.id, changes.join('; '));
  if (o.status === 'por_preparar') t.notify(['bodega'], [], `${o.id}: cambiaron cantidades (${changes.join('; ')})`, o.id);
  await t.run();
  return {};
};

A['req-decide'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const rr = await env.DB.prepare(`SELECT data, status FROM price_requests WHERE id = ?`).bind(str(b.id, 60)).first();
  if (!rr) throw new HttpError(404, 'No se encontró la solicitud.');
  if (rr.status !== 'pendiente') throw bad('Esta solicitud ya fue decidida.');
  const r = JSON.parse(rr.data); const ok = !!b.ok;
  const price = int(b.price ?? r.price); const note = str(b.note, 300);
  if (ok && !(price > 0)) throw bad('Escribe un precio aprobado mayor que cero.');
  if (!ok && !note) throw bad('Escribe una nota para explicar el rechazo.');
  const t = await tx(env, u, role);
  Object.assign(r, { status: ok ? 'aprobado' : 'rechazado', approvedPrice: ok ? price : null, note, decidedBy: u.id, decidedAt: t.t });
  t.add(`UPDATE price_requests SET data = ?, status = ?, rev = ? WHERE id = ? AND status = 'pendiente'`, JSON.stringify(r), r.status, t.rev, b.id).guard();
  const { o, version } = await getOrder(env, r.orderId);
  if (o.status !== 'anulado') {
    const l = o.lines.find(x => x.id === r.lineId);
    if (l && l.req) { l.req.status = r.status; l.req.note = note; if (ok) { l.price = price; l.req.price = price; } }
    if (o.status === 'esperando_precio' && o.lines.every(x => !x.req || x.req.status === 'aprobado')) { o.status = 'por_preparar'; o.statusAt = t.t; t.notify(['bodega'], [], `${o.id} de ${o.customer.name} entró a la cola (${PRIO[o.priority]})`, o.id); }
    t.saveOrder(o, version);
  }
  t.audit(ok ? 'Aprobó precio nuevo' : 'Rechazó precio nuevo', 'pedido', r.orderId, `${r.code} · solicitado ${money(r.price)}${ok ? ' · aprobado ' + money(price) : ''}`, note);
  t.notify([], [r.by], `${r.orderId}: precio de ${r.code} ${ok ? 'aprobado en ' + money(price) : 'rechazado'}${note ? ' · ' + note : ''}`, r.orderId);
  await t.run();
  return {};
};

A['line-fix'] = async (env, u, role, b) => {
  const { o, version } = await getOrder(env, b.id);
  if (!(o.seller === u.id || u.roles.includes('gerencia'))) throw new HttpError(403, 'Solo el vendedor del pedido o gerencia pueden corregir esta línea.');
  if (o.status !== 'esperando_precio') throw bad('Este pedido ya no está esperando precio.');
  const l = o.lines.find(x => x.id === b.lineId); if (!l || !l.req || l.req.status !== 'rechazado') throw bad('Esta línea no tiene un precio rechazado.');
  const t = await tx(env, u, role);
  if (b.mode === 'remove') { if (o.lines.length === 1) throw bad('Es la única línea. Pide a gerencia anular el pedido.'); o.lines = o.lines.filter(x => x.id !== l.id); }
  else { if (l.listPrice == null) throw bad('Este producto no tiene precio de lista.'); l.price = l.listPrice; l.priceSource = 'lista'; l.listName = LISTS[l.listKey] || l.listKey; l.req = null; }
  if (o.lines.every(x => !x.req || x.req.status === 'aprobado')) { o.status = 'por_preparar'; o.statusAt = t.t; t.notify(['bodega'], [], `${o.id} de ${o.customer.name} entró a la cola (${PRIO[o.priority]})`, o.id); }
  t.saveOrder(o, version);
  t.audit(b.mode === 'remove' ? 'Quitó línea con precio rechazado' : 'Usó precio de lista', 'pedido', o.id, l.code);
  await t.run();
  return {};
};

A['order-take'] = async (env, u, role, b) => {
  need(u, 'bodega');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'por_preparar') throw new HttpError(409, 'Este pedido ya lo tomó otra persona.');
  const t = await tx(env, u, role);
  Object.assign(o, { status: 'en_preparacion', statusAt: t.t, picker: u.id, takenAt: t.t });
  t.saveOrder(o, version).audit('Tomó el pedido', 'pedido', o.id);
  await t.run();
  return {};
};

A['line-pack'] = async (env, u, role, b) => {
  need(u, 'bodega');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'en_preparacion') throw bad('El pedido no está en preparación.');
  const l = o.lines.find(x => x.id === b.lineId); if (!l) throw bad('No se encontró la línea.');
  if (['agotado', 'trasladar', 'trasladado'].includes(l.pack.state)) throw bad('Deshaz primero la incidencia de esta línea.');
  const t = await tx(env, u, role);
  l.pack = b.packed ? { state: 'empacado', by: u.id, at: t.t } : { state: 'sin_empacar' };
  t.saveOrder(o, version).audit(b.packed ? 'Marcó empacado' : 'Desmarcó empacado', 'pedido', o.id, `${l.code} · ${l.qty} und.`);
  await t.run();
  return {};
};

A['line-inc'] = async (env, u, role, b) => {
  need(u, 'bodega');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'en_preparacion') throw bad('El pedido no está en preparación.');
  const l = o.lines.find(x => x.id === b.lineId); if (!l) throw bad('No se encontró la línea.');
  const type = b.kind; if (!['agotado', 'cantidad', 'pendiente', 'trasladar'].includes(type)) throw bad('Incidencia no válida.');
  const note = str(b.note, 300); let q = null;
  if (type === 'cantidad') { q = int(b.qty); if (!(q >= 0 && q < l.qty)) throw bad(`La cantidad debe estar entre 0 y ${l.qty - 1}.`); }
  if (type === 'pendiente' && !note) throw bad('Escribe qué falta y cuándo se empaca.');
  const t = await tx(env, u, role);
  l.pack = { state: type, qty: q, note, by: u.id, at: t.t };
  t.saveOrder(o, version);
  t.audit('Registró incidencia', 'pedido', o.id, `${l.code}: ${PACK[type]}${q != null ? ' (' + q + ' de ' + l.qty + ')' : ''}`, note);
  t.notify([], [o.seller], `${o.id} · ${l.code}: ${PACK[type].toLowerCase()}${q != null ? ` (${q} de ${l.qty})` : ''}${note ? ' · ' + note : ''}`, o.id);
  await t.run();
  return {};
};

A['line-reset'] = async (env, u, role, b) => {
  need(u, 'bodega');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'en_preparacion') throw bad('El pedido no está en preparación.');
  const l = o.lines.find(x => x.id === b.lineId); if (!l) throw bad('No se encontró la línea.');
  const t = await tx(env, u, role);
  l.pack = { state: 'sin_empacar' };
  t.saveOrder(o, version).audit('Deshizo incidencia', 'pedido', o.id, l.code);
  await t.run();
  return {};
};

A['order-toverify'] = async (env, u, role, b) => {
  need(u, 'bodega');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'en_preparacion') throw bad('El pedido no está en preparación.');
  const pb = packBlockers(o); if (pb.length) throw bad('Falta resolver: ' + pb.join('; '));
  const moving = o.lines.filter(l => l.pack.state === 'trasladar');
  let newId = null;
  const t = await tx(env, u, role);
  if (moving.length) {
    const n = await nextCounter(env, 'pedido'); newId = 'P-' + pad(n);
    const nl = moving.map(l => Object.assign(JSON.parse(JSON.stringify(l)), { id: shortId(), pack: { state: 'sin_empacar' }, verified: false }));
    const no = { id: newId, num: n, customerId: o.customerId, customer: o.customer, address: o.address, payment: o.payment, priority: o.priority, notes: `Pendientes de ${o.id}`, list: o.list, seller: o.seller, createdAt: t.t, status: 'por_preparar', statusAt: t.t, lines: nl, returns: [], origin: o.id };
    t.add(`INSERT INTO orders(id,data,status,seller,created_at,version,rev) VALUES (?,?,?,?,?,1,?)`, newId, JSON.stringify(no), no.status, no.seller, t.t, t.rev);
    moving.forEach(l => { l.pack = Object.assign({}, l.pack, { state: 'trasladado', to: newId }); });
    t.audit('Creó pedido de pendientes', 'pedido', newId, `${nl.length} líneas trasladadas desde ${o.id}`);
    t.audit('Trasladó líneas', 'pedido', o.id, `${moving.map(l => l.code).join(', ')} → ${newId}`);
    t.notify([], [o.seller], `${o.id}: ${moving.length} línea(s) pasaron al pedido ${newId}`, newId);
  }
  o.lines.forEach(l => { l.verified = false; });
  Object.assign(o, { status: 'por_verificar', statusAt: t.t, packedAt: t.t });
  t.saveOrder(o, version).audit('Envió a verificación', 'pedido', o.id);
  t.notify(['verificacion'], [], `${o.id} de ${o.customer.name} está listo para verificar`, o.id);
  await t.run();
  return { newId };
};

A['line-verify'] = async (env, u, role, b) => {
  need(u, 'verificacion');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'por_verificar') throw bad('El pedido no está por verificar.');
  const l = o.lines.find(x => x.id === b.lineId); if (!l) throw bad('No se encontró la línea.');
  const t = await tx(env, u, role);
  l.verified = !!b.verified;
  t.saveOrder(o, version).audit(l.verified ? 'Marcó verificado' : 'Desmarcó verificado', 'pedido', o.id, `${l.code} · ${shipQty(l)} und.`);
  await t.run();
  return {};
};

A['order-verified'] = async (env, u, role, b) => {
  need(u, 'verificacion');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'por_verificar') throw bad('El pedido no está por verificar.');
  if (o.lines.some(l => shipQty(l) > 0 && !l.verified)) throw bad('Verifica todas las líneas antes de aprobar.');
  const t = await tx(env, u, role);
  Object.assign(o, { status: 'por_despachar', statusAt: t.t, verifier: u.id, verifiedAt: t.t });
  t.saveOrder(o, version).audit('Aprobó la verificación', 'pedido', o.id);
  t.notify(['despacho'], [], `${o.id} de ${o.customer.name} está listo para despachar`, o.id);
  await t.run();
  return {};
};

A['order-return'] = async (env, u, role, b) => {
  need(u, 'verificacion');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'por_verificar') throw bad('El pedido no está por verificar.');
  const reason = str(b.reason, 300); if (!reason) throw bad('Escribe qué está mal para que bodega lo corrija.');
  const t = await tx(env, u, role);
  o.lines.forEach(l => { l.verified = false; });
  o.returns = (o.returns || []).concat([{ at: t.t, by: u.id, reason }]);
  Object.assign(o, { status: 'en_preparacion', statusAt: t.t });
  t.saveOrder(o, version).audit('Devolvió a preparación', 'pedido', o.id, '', reason);
  t.notify(['bodega'], [o.picker], `${o.id} fue devuelto a preparación: ${reason}`, o.id);
  await t.run();
  return {};
};

function stockAlert(t, p, base, nq, ref) {
  if (nq <= 0 && base > 0) t.notify(['gerencia', 'bodega'], [], `${p.code} ${p.name}: se agotó en bodega (quedan ${nq})`, ref);
  else if (nq <= STOCK_MIN && base > STOCK_MIN) t.notify(['gerencia', 'bodega'], [], `${p.code} ${p.name}: quedan solo ${nq} en bodega`, ref);
}
function moveStock(t, P, lines, sign, why, ref) {
  const sinDato = [];
  const totals = {};
  lines.forEach(l => { const q = shipQty(l); if (q > 0) totals[l.pid] = (totals[l.pid] || 0) + q; });
  for (const pid of Object.keys(totals)) {
    const p = P[pid]; const q = totals[pid];
    if (!p || p.stock == null) { sinDato.push(p ? p.code : pid); continue; }
    const nq = p.stock + sign * q;
    t.add(`UPDATE products SET stock = stock + ?, rev = ? WHERE id = ? AND stock IS NOT NULL`, sign * q, t.rev, pid);
    t.audit(sign < 0 ? 'Descontó existencias' : 'Devolvió existencias', 'producto', p.code, `${p.stock} → ${nq} · ${why}`);
    stockAlert(t, p, p.stock, nq, ref);
  }
  if (sinDato.length) t.audit('Movimiento sin descontar existencias', 'pedido', ref, 'Sin existencias registradas: ' + sinDato.join(', '));
}

A['order-dispatch'] = async (env, u, role, b) => {
  need(u, 'despacho');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'por_despachar') throw bad('El pedido no está listo para despacho.');
  const bl = dispatchBlockers(o); if (bl.length) throw bad('No se puede despachar: ' + bl.join('; '));
  const driver = str(b.driver, 80); if (!driver) throw bad('Escribe el nombre del conductor.');
  const vehicle = str(b.vehicle, 20).toUpperCase(); if (!vehicle) throw bad('Escribe la placa del vehículo.');
  const P = await getProducts(env, o.lines.map(l => l.pid));
  const t = await tx(env, u, role);
  Object.assign(o, { status: 'despachado', statusAt: t.t, dispatch: { driver, vehicle, at: t.t, by: u.id } });
  t.saveOrder(o, version).audit('Despachó', 'pedido', o.id, `${driver} · ${vehicle}`);
  moveStock(t, P, o.lines, -1, 'Despacho ' + o.id, o.id);
  t.notify(['contabilidad'], [o.seller], `${o.id} de ${o.customer.name} salió con ${driver} (${vehicle})`, o.id);
  await t.run();
  return {};
};

A['order-remision'] = async (env, u, role, b) => {
  need(u, 'contabilidad');
  const { o, version } = await getOrder(env, b.id);
  if (o.status !== 'despachado' || o.remisionId) throw bad('Este pedido ya tiene remisión o no está despachado.');
  const n = await nextCounter(env, 'remision'); const id = 'R-' + pad(n);
  const lines = o.lines.filter(l => shipQty(l) > 0).map(l => ({ code: l.code, name: l.name, qty: shipQty(l), price: l.price, total: shipQty(l) * l.price, special: l.priceSource === 'especial' }));
  const total = lines.reduce((a, l) => a + l.total, 0);
  const t = await tx(env, u, role);
  const rem = { id, orderId: o.id, at: t.t, by: u.id, customer: o.customer, address: o.address, payment: o.payment, list: o.list, seller: o.seller, dispatch: o.dispatch, orderCreatedAt: o.createdAt, lines, total };
  Object.assign(o, { status: 'remisionado', statusAt: t.t, remisionId: id });
  t.saveOrder(o, version);
  t.add(`INSERT INTO remisiones(id,order_id,data,rev) VALUES (?,?,?,?)`, id, o.id, JSON.stringify(rem), t.rev);
  t.audit('Generó remisión', 'pedido', o.id, `${id} · ${money(total)}`);
  t.notify([], [o.seller], `${o.id}: remisión ${id} generada por ${money(total)}`, o.id);
  await t.run();
  return { id };
};

A['order-void'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const { o, version } = await getOrder(env, b.id);
  if (['remisionado', 'anulado'].includes(o.status)) throw bad('Un pedido remisionado o ya anulado no se puede anular aquí.');
  const reason = str(b.reason, 300); if (!reason) throw bad('La anulación necesita un motivo.');
  const t = await tx(env, u, role);
  if (o.status === 'despachado') moveStock(t, await getProducts(env, o.lines.map(l => l.pid)), o.lines, +1, 'Anulación de ' + o.id, o.id);
  for (const l of o.lines) if (l.req && l.req.status === 'pendiente') { l.req.status = 'rechazado'; l.req.note = 'Pedido anulado'; t.add(`UPDATE price_requests SET status = 'rechazado', data = json_set(data,'$.status','rechazado','$.note','Pedido anulado','$.decidedBy',?,'$.decidedAt',?), rev = ? WHERE id = ?`, u.id, t.t, t.rev, l.req.id); }
  Object.assign(o, { status: 'anulado', statusAt: t.t, voided: { reason, by: u.id, at: t.t, prevStatus: o.status } });
  t.saveOrder(o, version).audit('Anuló el pedido', 'pedido', o.id, '', reason);
  t.notify(['bodega', 'verificacion', 'despacho'], [o.seller], `${o.id} fue anulado: ${reason}`, o.id);
  await t.run();
  return {};
};

A['notif-read'] = async (env, u, role, b) => {
  const rev = await nextCounter(env, 'rev');
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite).slice(0, 300);
  if (!ids.length) return {};
  await env.DB.batch(ids.map(id => env.DB.prepare(`INSERT OR IGNORE INTO notification_reads(notification_id,user_id,rev) VALUES (?,?,?)`).bind(id, u.id, rev)));
  return {};
};

A['audit-seen'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const at = int(b.at) || now();
  await env.DB.prepare(`INSERT INTO prefs(user_id,audit_seen) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET audit_seen = excluded.audit_seen`).bind(u.id, at).run();
  return {};
};

// ---------- usuarios ----------
const cleanRoles = r => (Array.isArray(r) ? r : []).filter(x => ROLES.includes(x));
async function activeManagers(env) {
  const rs = await env.DB.prepare(`SELECT id, roles FROM users WHERE active = 1`).all();
  return rs.results.filter(r => (parse(r.roles) || []).includes('gerencia')).map(r => r.id);
}
A['user-create'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const username = norm(b.username).replace(/[^a-z0-9._-]/g, '');
  if (username.length < 3 || username.length > 30) throw bad('El usuario debe tener entre 3 y 30 letras, números, puntos o guiones.');
  const name = str(b.name, 80); if (!name) throw bad('Escribe el nombre de la persona.');
  const roles = cleanRoles(b.roles); if (!roles.length) throw bad('Asigna al menos un rol.');
  const exists = await env.DB.prepare(`SELECT 1 FROM users WHERE username = ?`).bind(username).first();
  if (exists) throw bad('Ese usuario ya existe. Elige otro.');
  const pw = await newPassword(env, b.password);
  const t = await tx(env, u, role); const id = uid();
  t.add(`INSERT INTO users(id,username,name,roles,active,pw_hash,pw_salt,pw_iter,must_change,created_at,created_by,rev) VALUES (?,?,?,?,1,?,?,?,1,?,?,?)`, id, username, name, JSON.stringify(roles), pw.pw_hash, pw.pw_salt, pw.pw_iter, t.t, u.id, t.rev);
  t.audit('Creó usuario', 'equipo', username, `${name} · roles: ${roles.map(r => ROLE_NAMES[r]).join(', ')}`);
  await t.run();
  return { id };
};
A['user-update'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const target = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(str(b.id, 60)).first();
  if (!target) throw new HttpError(404, 'No se encontró el usuario.');
  const oldRoles = parse(target.roles) || [];
  const roles = b.roles ? cleanRoles(b.roles) : oldRoles;
  const active = b.active === undefined ? !!target.active : !!b.active;
  const name = b.name ? str(b.name, 80) : target.name;
  if (!roles.length) throw bad('Asigna al menos un rol.');
  const managers = await activeManagers(env);
  if (managers.includes(target.id) && (!roles.includes('gerencia') || !active) && managers.length === 1) throw bad('Debe quedar al menos una persona activa con rol de gerencia.');
  const t = await tx(env, u, role);
  t.add(`UPDATE users SET name = ?, roles = ?, active = ?, rev = ? WHERE id = ?`, name, JSON.stringify(roles), active ? 1 : 0, t.rev, target.id);
  if (!active) t.add(`DELETE FROM sessions WHERE user_id = ?`, target.id);
  const changes = [];
  if (name !== target.name) changes.push(`Nombre: ${target.name} → ${name}`);
  if (JSON.stringify(roles) !== JSON.stringify(oldRoles)) changes.push(`Roles: ${oldRoles.map(r => ROLE_NAMES[r]).join(', ') || '—'} → ${roles.map(r => ROLE_NAMES[r]).join(', ')}`);
  if (active !== !!target.active) changes.push(active ? 'Desbloqueado' : 'Bloqueado');
  t.audit('Editó usuario', 'equipo', target.username, changes.join('; ') || 'sin cambios');
  if (JSON.stringify(roles) !== JSON.stringify(oldRoles)) t.notify([], [target.id], `Gerencia cambió tus roles: ${roles.map(r => ROLE_NAMES[r]).join(', ')}`, '');
  await t.run();
  return {};
};
A['user-reset'] = async (env, u, role, b) => {
  need(u, 'gerencia');
  const target = await env.DB.prepare(`SELECT id, username FROM users WHERE id = ?`).bind(str(b.id, 60)).first();
  if (!target) throw new HttpError(404, 'No se encontró el usuario.');
  const pw = await newPassword(env, b.password);
  const t = await tx(env, u, role);
  t.add(`UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, must_change = 1, failed = 0, locked_until = 0, rev = ? WHERE id = ?`, pw.pw_hash, pw.pw_salt, pw.pw_iter, t.rev, target.id);
  t.add(`DELETE FROM sessions WHERE user_id = ?`, target.id);
  t.audit('Restableció la clave', 'equipo', target.username, 'Clave temporal asignada; deberá cambiarla al entrar');
  await t.run();
  return {};
};

// ---------- sincronización ----------
async function sync(env, u, since) {
  const D = env.DB;
  const isG = u.roles.includes('gerencia');
  const q = (sql, ...a) => D.prepare(sql).bind(...a);
  const parts = [
    q(`SELECT v FROM counters WHERE k = 'rev'`),
    q(`SELECT id,code,name,section,row,prices,ue,stock,no_credit,inactive,source,rev FROM products WHERE rev > ?`, since),
    q(`SELECT id,data,rev FROM customers WHERE rev > ?`, since),
    q(`SELECT id,data,rev FROM orders WHERE rev > ?`, since),
    q(`SELECT id,data,status,rev FROM price_requests WHERE rev > ?`, since),
    q(`SELECT id,data,rev FROM remisiones WHERE rev > ?`, since),
    q(`SELECT id,username,name,roles,active,rev FROM users WHERE rev > ?`, since),
    q(`SELECT * FROM notifications WHERE rev > ? ORDER BY id DESC LIMIT 400`, since),
    q(`SELECT notification_id FROM notification_reads WHERE user_id = ? AND rev > ?`, u.id, since),
    q(`SELECT audit_seen FROM prefs WHERE user_id = ?`, u.id),
  ];
  if (isG) parts.push(q(`SELECT * FROM audit WHERE rev > ? ORDER BY id DESC LIMIT 1000`, since), q(`SELECT * FROM price_history WHERE rev > ? ORDER BY id DESC LIMIT 2000`, since));
  const r = await D.batch(parts);
  const rows = i => r[i].results || [];
  const mine = n => { const tr = parse(n.to_roles) || [], tu = parse(n.to_users) || []; return tu.includes(u.id) || tr.some(x => u.roles.includes(x)); };
  return {
    rev: rows(0)[0].v, full: since === 0,
    products: rows(1).map(p => ({ ...p, prices: parse(p.prices) || {} })),
    customers: rows(2).map(c => ({ id: c.id, ...JSON.parse(c.data) })),
    orders: rows(3).map(o => JSON.parse(o.data)),
    requests: rows(4).map(x => ({ id: x.id, ...JSON.parse(x.data), status: x.status })),
    remisiones: rows(5).map(x => JSON.parse(x.data)),
    users: rows(6).map(x => ({ id: x.id, username: isG ? x.username : undefined, name: x.name, roles: parse(x.roles) || [], active: !!x.active })),
    notifications: rows(7).filter(mine).map(n => ({ id: n.id, at: n.at, by: n.by, text: n.text, ref: n.ref })),
    reads: rows(8).map(x => x.notification_id),
    auditSeen: (rows(9)[0] || {}).audit_seen || 0,
    audit: isG ? rows(10) : [],
    priceHistory: isG ? rows(11) : [],
  };
}

async function exportAll(env) {
  const tables = ['products', 'price_history', 'customers', 'orders', 'price_requests', 'remisiones', 'notifications', 'audit'];
  const r = await env.DB.batch([...tables.map(tn => env.DB.prepare(`SELECT * FROM ${tn}`)), env.DB.prepare(`SELECT id,username,name,roles,active,created_at FROM users`), env.DB.prepare(`SELECT * FROM counters`)]);
  const out = { exportedAt: new Date().toISOString() };
  tables.forEach((tn, i) => out[tn] = r[i].results);
  out.users = r[tables.length].results; out.counters = r[tables.length + 1].results;
  return out;
}

// ---------- rutas ----------
async function body(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 1_000_000) throw bad('La solicitud es demasiado grande.');
  try { return await req.json(); } catch (e) { throw bad('Solicitud no válida.'); }
}
function checkOrigin(req) {
  if (req.method === 'GET') return;
  if (req.headers.get('x-ferro') !== '1') throw new HttpError(403, 'Solicitud no permitida.');
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, 'Solicitud no permitida.');
}

async function route(req, env, url) {
  const path = url.pathname;
  checkOrigin(req);

  if (path === '/api/status' && req.method === 'GET') {
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first();
    return json({ needsSetup: n.n === 0, setupConfigured: !!env.SETUP_CODE });
  }

  if (path === '/api/setup' && req.method === 'POST') {
    const b = await body(req);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first();
    if (n.n > 0) throw bad('La aplicación ya tiene usuarios. Entra con tu usuario.');
    if (!env.SETUP_CODE) throw bad('Falta configurar el código de instalación (SETUP_CODE) en Cloudflare.');
    if (!sameText(String(b.code || ''), String(env.SETUP_CODE))) throw new HttpError(403, 'El código de instalación no es correcto.');
    const username = norm(b.username).replace(/[^a-z0-9._-]/g, '');
    if (username.length < 3) throw bad('El usuario debe tener al menos 3 letras o números.');
    const name = str(b.name, 80); if (!name) throw bad('Escribe tu nombre.');
    const pw = await newPassword(env, b.password);
    const rev = await nextCounter(env, 'rev'); const id = uid(); const t = now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users(id,username,name,roles,active,pw_hash,pw_salt,pw_iter,must_change,created_at,created_by,rev) VALUES (?,?,?,?,1,?,?,?,0,?,?,?)`).bind(id, username, name, JSON.stringify(ROLES), pw.pw_hash, pw.pw_salt, pw.pw_iter, t, id, rev),
      env.DB.prepare(`INSERT INTO audit(at,by,role,action,entity,ref,detail,reason,rev) VALUES (?,?,?,?,?,?,?,?,?)`).bind(t, id, 'gerencia', 'Instaló la aplicación', 'equipo', username, `Primer usuario de gerencia: ${name}`, '', rev),
    ]);
    return json({ ok: true });
  }

  if (path === '/api/login' && req.method === 'POST') {
    const b = await body(req);
    const username = norm(b.username).replace(/[^a-z0-9._-]/g, '');
    const password = String(b.password || '');
    const generic = 'Usuario o clave incorrectos.';
    const u = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first();
    if (!u) { await hashPw(password || 'x', 'AAAAAAAAAAAAAAAAAAAAAA==', iterations(env)); throw new HttpError(401, generic); }
    if (!u.active) throw new HttpError(403, 'Este usuario está bloqueado. Habla con gerencia.');
    if (u.locked_until > now()) throw new HttpError(429, `Demasiados intentos. Intenta de nuevo en ${Math.ceil((u.locked_until - now()) / 60000)} minutos o pide a gerencia que restablezca tu clave.`);
    const h = await hashPw(password, u.pw_salt, u.pw_iter);
    if (!sameText(h, u.pw_hash)) {
      const fails = u.failed + 1;
      await env.DB.prepare(`UPDATE users SET failed = ?, locked_until = ? WHERE id = ?`).bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now() + LOCK_MINUTES * 60000 : 0, u.id).run();
      throw new HttpError(401, fails >= MAX_FAILS ? `Demasiados intentos. El usuario queda bloqueado ${LOCK_MINUTES} minutos.` : generic);
    }
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const t = now();
    // Si se subió PBKDF2_ITER, la clave se vuelve a calcular con más iteraciones al entrar.
    const stronger = u.pw_iter < iterations(env) ? await newPassword(env, password).catch(() => null) : null;
    await env.DB.batch([
      stronger ? env.DB.prepare(`UPDATE users SET failed = 0, locked_until = 0, pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?`).bind(stronger.pw_hash, stronger.pw_salt, stronger.pw_iter, u.id)
        : env.DB.prepare(`UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?`).bind(u.id),
      env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(t),
      env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)`).bind(await sha256(token), u.id, t, t + SESSION_HOURS * 3600000),
    ]);
    u.roles = parse(u.roles) || [];
    return json({ user: publicUser(u) }, 200, { 'set-cookie': sessionCookie(token, SESSION_HOURS * 3600, req) });
  }

  if (path === '/api/logout' && req.method === 'POST') {
    const tkn = cookieValue(req, 'ferro_s');
    if (tkn) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(tkn)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, req) });
  }

  const u = await currentUser(req, env);
  if (!u) throw new HttpError(401, 'Tu sesión terminó. Vuelve a entrar.');

  if (path === '/api/me' && req.method === 'GET') return json({ user: publicUser(u) });

  if (path === '/api/password' && req.method === 'POST') {
    const b = await body(req);
    const h = await hashPw(String(b.current || ''), u.pw_salt, u.pw_iter);
    if (!sameText(h, u.pw_hash)) throw bad('La clave actual no es correcta.');
    if (String(b.current) === String(b.password)) throw bad('La clave nueva debe ser distinta a la actual.');
    const pw = await newPassword(env, b.password);
    const rev = await nextCounter(env, 'rev');
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, must_change = 0, rev = ? WHERE id = ?`).bind(pw.pw_hash, pw.pw_salt, pw.pw_iter, rev, u.id),
      env.DB.prepare(`INSERT INTO audit(at,by,role,action,entity,ref,detail,reason,rev) VALUES (?,?,?,?,?,?,?,?,?)`).bind(now(), u.id, '', 'Cambió su clave', 'equipo', u.username, '', '', rev),
    ]);
    return json({ ok: true });
  }

  if (u.must_change) throw new HttpError(403, 'Debes cambiar tu clave temporal antes de continuar.');

  if (path === '/api/push/key' && req.method === 'GET') return json({ key: (await vapid(env)).pub });
  if (path === '/api/push/subscribe' && req.method === 'POST') {
    const b = await body(req);
    if (!validEndpoint(b.endpoint)) throw bad('Suscripción no válida.');
    await env.DB.prepare(`INSERT INTO push_subs(endpoint,user_id,created_at) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id`).bind(b.endpoint, u.id, now()).run();
    return json({ ok: true });
  }
  if (path === '/api/push/unsubscribe' && req.method === 'POST') {
    const b = await body(req);
    await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?`).bind(String(b.endpoint || ''), u.id).run();
    return json({ ok: true });
  }
  if (path === '/api/push/latest' && req.method === 'GET') {
    const rs = (await env.DB.prepare(`SELECT n.id, n.text, n.ref, n.to_roles, n.to_users FROM notifications n WHERE n.id NOT IN (SELECT notification_id FROM notification_reads WHERE user_id = ?) ORDER BY n.id DESC LIMIT 60`).bind(u.id).all()).results;
    const mine = rs.filter(n => (parse(n.to_users) || []).includes(u.id) || (parse(n.to_roles) || []).some(x => u.roles.includes(x)));
    return json({ count: mine.length, items: mine.slice(0, 3).map(n => ({ id: n.id, text: n.text, ref: n.ref })) });
  }

  if (path === '/api/sync' && req.method === 'GET') return json(await sync(env, u, Math.max(0, int(url.searchParams.get('since')) || 0)));

  if (path === '/api/rev' && req.method === 'GET') {
    const r = await env.DB.prepare(`SELECT v FROM counters WHERE k = 'rev'`).first();
    return json({ rev: r.v });
  }

  if (path === '/api/timeline' && req.method === 'GET') {
    const ref = str(url.searchParams.get('ref'), 20);
    const rs = await env.DB.prepare(`SELECT at,by,role,action,detail,reason FROM audit WHERE ref = ? ORDER BY id`).bind(ref).all();
    return json({ items: rs.results });
  }

  if (path === '/api/export' && req.method === 'GET') {
    need(u, 'gerencia');
    return new Response(JSON.stringify(await exportAll(env)), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="respaldo-ferrodistribuciones-${new Date().toISOString().slice(0, 10)}.json"` } });
  }

  if (path === '/api/action' && req.method === 'POST') {
    const b = await body(req);
    const fn = A[b.type];
    if (!fn) throw bad('Acción no válida.');
    const role = u.roles.includes(req.headers.get('x-role')) ? req.headers.get('x-role') : (u.roles[0] || '');
    const result = await fn(env, u, role, b);
    return json({ ok: true, ...result });
  }

  throw new HttpError(404, 'Ruta no encontrada.');
}

export default {
  async fetch(req, baseEnv, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return baseEnv.ASSETS.fetch(req);
    const env = Object.create(baseEnv); env.ctx = ctx; env.PUBLIC_URL = url.origin;
    try {
      await ensureSchema(env);
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e && e.stack || e);
      return json({ error: 'Ocurrió un error en el servidor. Intenta de nuevo.' }, 500);
    }
  },
};
