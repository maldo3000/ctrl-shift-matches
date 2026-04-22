const matches = require('./matches');

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function statusFor(startAt, currentKey, eventKey, nowMs) {
  if (eventKey && currentKey && eventKey === currentKey) return 'current';
  const ts = Date.parse(startAt || '');
  if (!Number.isFinite(ts)) return 'unknown';
  return ts >= nowMs ? 'upcoming' : 'past';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.LUMA_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      current_event_key: null,
      events: [],
      error: 'Missing LUMA_API_KEY environment variable.',
    });
  }

  const discovered = await matches.getDiscoveredEvents({ apiKey });
  const envMap = parseJsonObject(process.env.LUMA_EVENT_MAP);
  const envOverrideDefault = String(process.env.LUMA_DEFAULT_EVENT_KEY || '').trim();
  const now = Date.now();

  const metaByKey = { ...(discovered.metaByKey || {}) };

  // Surface env-var-mapped events that discovery didn't find (e.g. external/private events)
  Object.keys(envMap).forEach((rawKey) => {
    const key = String(rawKey || '').toLowerCase();
    if (!key || metaByKey[key]) return;
    const apiId = String(envMap[rawKey] || '').trim();
    if (!apiId) return;
    metaByKey[key] = {
      api_id: apiId,
      start_at: null,
      name: key,
      label: key.replace(/^vol/, 'Vol. '),
      from_env: true,
    };
  });

  const currentKey = envOverrideDefault || discovered.currentKey || null;

  const events = Object.entries(metaByKey)
    .map(([key, meta]) => ({
      key,
      label: (meta && meta.label) || key,
      name: (meta && meta.name) || null,
      api_id: (meta && meta.api_id) || null,
      start_at: (meta && meta.start_at) || null,
      status: statusFor(meta && meta.start_at, currentKey, key, now),
      from_env: Boolean(meta && meta.from_env),
    }))
    .sort((a, b) => {
      const aTs = Date.parse(a.start_at || '') || 0;
      const bTs = Date.parse(b.start_at || '') || 0;
      return bTs - aTs; // most recent first
    });

  return res.status(200).json({
    current_event_key: currentKey,
    events,
    fetched_at: new Date(discovered.fetchedAt || now).toISOString(),
    error: discovered.error || null,
  });
};
