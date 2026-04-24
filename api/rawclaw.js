const STATE_KEY = 'rawclaw:state:v1';
const HISTORY_LIMIT = 8;

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function kvGet(key) {
  const cfg = getKvConfig();
  if (!cfg) throw new Error('kv-not-configured');
  const resp = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!resp.ok) throw new Error(`kv get HTTP ${resp.status}`);
  const payload = await resp.json();
  return payload && payload.result != null ? payload.result : null;
}

async function kvSet(key, value) {
  const cfg = getKvConfig();
  if (!cfg) throw new Error('kv-not-configured');
  const resp = await fetch(`${cfg.url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'text/plain',
    },
    body: value,
  });
  if (!resp.ok) throw new Error(`kv set HTTP ${resp.status}`);
}

function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’‘`´]/g, "'")
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptyState() {
  return { names: [], winners: [], history: [], lastWinner: '', updatedAt: 0 };
}

function coerceState(raw) {
  const base = emptyState();
  if (!raw) return base;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (_) { return base; }
  }
  if (!obj || typeof obj !== 'object') return base;
  return {
    names: Array.isArray(obj.names) ? obj.names.filter((n) => typeof n === 'string') : [],
    winners: Array.isArray(obj.winners) ? obj.winners.filter((k) => typeof k === 'string') : [],
    history: Array.isArray(obj.history) ? obj.history.filter((n) => typeof n === 'string') : [],
    lastWinner: typeof obj.lastWinner === 'string' ? obj.lastWinner : '',
    updatedAt: Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0,
  };
}

async function readState() {
  const raw = await kvGet(STATE_KEY);
  return coerceState(raw);
}

async function writeState(state) {
  state.updatedAt = Date.now();
  await kvSet(STATE_KEY, JSON.stringify(state));
  return state;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function applyAction(state, body) {
  const action = body && body.action;
  if (action === 'add') {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (!name) return { error: 'name-required' };
    const key = normalizeKey(name);
    if (!key) return { error: 'name-required' };
    if (state.names.some((n) => normalizeKey(n) === key)) {
      return { error: 'duplicate', message: `${name} is already in the list.` };
    }
    state.names.push(name);
    return { ok: true };
  }
  if (action === 'remove') {
    const key = normalizeKey(body.key || '');
    if (!key) return { error: 'key-required' };
    state.names = state.names.filter((n) => normalizeKey(n) !== key);
    state.winners = state.winners.filter((k) => k !== key);
    state.history = state.history.filter((n) => normalizeKey(n) !== key);
    if (state.lastWinner && normalizeKey(state.lastWinner) === key) state.lastWinner = '';
    return { ok: true };
  }
  if (action === 'clear') {
    state.names = [];
    state.winners = [];
    state.history = [];
    state.lastWinner = '';
    return { ok: true };
  }
  if (action === 'recordWinner') {
    const winner = String(body.winner || '').trim();
    if (!winner) return { error: 'winner-required' };
    const k = normalizeKey(winner);
    if (!state.winners.includes(k)) state.winners.push(k);
    state.history = [winner, ...state.history.filter((n) => normalizeKey(n) !== k)].slice(0, HISTORY_LIMIT);
    state.lastWinner = winner;
    return { ok: true };
  }
  if (action === 'resetWinners') {
    state.winners = [];
    state.history = [];
    state.lastWinner = '';
    return { ok: true };
  }
  return { error: 'unknown-action' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const state = await readState();
      return res.status(200).json(state);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const state = await readState();
      const result = applyAction(state, body);
      if (result.error) {
        return res.status(result.error === 'duplicate' ? 409 : 400).json(result);
      }
      const saved = await writeState(state);
      return res.status(200).json(saved);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  } catch (err) {
    if (err && err.message === 'kv-not-configured') {
      return res.status(503).json({
        error: 'persistence-not-configured',
        message: 'Vercel KV (Redis) is not connected to this project yet.',
      });
    }
    return res.status(500).json({ error: 'server-error', detail: String(err && err.message || err) });
  }
};
