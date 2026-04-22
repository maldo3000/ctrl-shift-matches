const LUMA_API_BASE_URL = process.env.LUMA_API_BASE_URL || 'https://public-api.luma.com';
const CACHE_TTL_SECONDS = Number(process.env.MATCH_CACHE_TTL_SECONDS || 120);
const CALENDAR_TTL_SECONDS = Number(process.env.LUMA_CALENDAR_TTL_SECONDS || 300);
const TITLE_FILTER_SOURCE = String(process.env.LUMA_EVENT_TITLE_FILTER || 'ctrl\\s*shift');
let TITLE_FILTER;
try {
  TITLE_FILTER = new RegExp(TITLE_FILTER_SOURCE, 'i');
} catch (_error) {
  TITLE_FILTER = /ctrl\s*shift/i;
}

const cache = {
  expiresAt: 0,
  key: '',
  payload: null,
};

const calendarCache = {
  expiresAt: 0,
  payload: null,
};

const INTEREST_TAGS = [
  {
    tag: '🧠 AI agents / automation',
    keywords: ['ai', 'agent', 'automation', 'llm', 'gpt', 'chatgpt', 'claude', 'openai', 'anthropic'],
  },
  {
    tag: '🧪 Tool builder / open source',
    keywords: ['open source', 'oss', 'tool builder', 'developer tool', 'sdk', 'api', 'build tools'],
  },
  {
    tag: '🎭 Story / writing',
    keywords: ['story', 'writing', 'writer', 'script', 'copywriting', 'newsletter', 'substack'],
  },
  {
    tag: '🪩 Live experiences / events',
    keywords: ['event', 'events', 'community', 'meetup', 'experience', 'live show'],
  },
  {
    tag: '🎥 Video / Motion',
    keywords: ['video', 'motion', 'editing', 'after effects', 'davinci', 'cinema', 'film'],
  },
  {
    tag: '🎛️ TouchDesigner / visuals',
    keywords: ['touchdesigner', 'visuals', 'vj', 'projection', 'creative coding'],
  },
  {
    tag: '🧑‍🏫 Teaching / mentoring',
    keywords: ['teach', 'teaching', 'mentor', 'mentoring', 'coach', 'education'],
  },
  {
    tag: '🤝 Hiring / looking for talent',
    keywords: ['hiring', 'recruit', 'talent', 'team', 'cofounder', 'collaborator'],
  },
  {
    tag: '🌱 Beginner-friendly',
    keywords: ['beginner', 'new to', 'learning', 'no-code', 'first time'],
  },
];

const TOOL_HINTS = [
  'chatgpt',
  'claude',
  'cursor',
  'figma',
  'notion',
  'obsidian',
  'descript',
  'after effects',
  'davinci',
  'touchdesigner',
  'midjourney',
  'runway',
  'vscode',
  'github',
  'zapier',
  'make.com',
  'airtable',
  'excel',
  'google',
  'slack',
  'discord',
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value).replace(/['"]/g, '');
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function extractVolumeNumber(value) {
  const text = String(value || '');
  const match = text.match(/\bvol(?:ume)?\s*[\.\- ]?\s*(\d+)\b/i);
  return match ? String(match[1]) : '';
}

function formatEventLabel(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'Event';

  const volNumber = extractVolumeNumber(text);
  if (volNumber) return `Vol. ${volNumber}`;
  if (/^evt-/i.test(text)) return 'Current Event';

  return text
    .split(/[_-]+/g)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildEventKey({ explicitEvent, eventLabel, fallbackId }) {
  const explicit = normalizeKey(explicitEvent || '');
  if (explicit) return explicit;

  const volNumber = extractVolumeNumber(eventLabel);
  if (volNumber) return `vol${volNumber}`;

  return normalizeKey(fallbackId || 'live');
}

function resolveEventSelection(reqQuery, discovered) {
  const query = reqQuery || {};
  const envMap = parseJsonObject(process.env.LUMA_EVENT_MAP);
  const dynamicApiIdByKey = (discovered && discovered.apiIdByKey) || {};
  // Env map entries override dynamic discovery
  const eventMap = { ...dynamicApiIdByKey, ...envMap };
  const envDefault = String(process.env.LUMA_DEFAULT_EVENT_KEY || '').trim();
  const discoveredCurrent = (discovered && discovered.currentKey) || '';
  const defaultEventKey = envDefault || discoveredCurrent;

  const explicitEvent = String(query.event || query.event_key || '').trim();
  const eventKey = normalizeKey(explicitEvent || defaultEventKey || '');
  const mappedEventApiId = eventKey && typeof eventMap[eventKey] === 'string' ? String(eventMap[eventKey]).trim() : '';
  const queryEventApiId = String(query.event_api_id || query.eventApiId || '').trim();
  const queryEventId = String(query.event_id || '').trim();

  // If the caller asked for a specific event key we couldn't resolve, do NOT fall back
  // to LUMA_EVENT_API_ID — that silently serves the wrong event.
  const explicitKeyUnresolved = Boolean(explicitEvent) && !mappedEventApiId && !queryEventApiId && !queryEventId;

  const eventApiId =
    queryEventApiId ||
    mappedEventApiId ||
    (explicitEvent ? '' : String(process.env.LUMA_EVENT_API_ID || process.env.LUMA_EVENT_ID || '').trim());
  const eventId =
    queryEventId ||
    (explicitEvent ? '' : String(process.env.LUMA_EVENT_ID || '').trim());
  const eventLabel = formatEventLabel(query.event_label || explicitEvent || eventKey || eventApiId);

  return {
    explicitEvent,
    explicitKeyUnresolved,
    eventKey: eventKey || null,
    eventLabel,
    eventApiId,
    eventId,
    availableKeys: Object.keys(eventMap),
  };
}

function titleCase(value) {
  return String(value || '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function flattenAnswerValue(answer) {
  if (!answer || typeof answer !== 'object') return [];

  const values = [];

  const pushValue = (value) => {
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }

    if (typeof value === 'object') {
      Object.values(value).forEach(pushValue);
      return;
    }

    const str = String(value).trim();
    if (str.length) values.push(str);
  };

  pushValue(answer.answer);
  pushValue(answer.value);
  pushValue(answer.answer_company);
  pushValue(answer.answer_job_title);

  return [...new Set(values)];
}

function looksLikeRoleLabel(label) {
  return /(role|title|what describes you|who are you|profession|what do you do|job)/.test(label);
}

function looksLikeInterestLabel(label) {
  return /(interest|looking for|want to discuss|topics|themes|focus)/.test(label);
}

function looksLikeToolsLabel(label) {
  return /(tools?|stack|software|apps?|platforms?|workflow)/.test(label);
}

function looksLikeNetworkingLabel(label) {
  return /(network|connect|meeting style|how do you want to meet|intros?|mingle|conversation style)/.test(label);
}

function dedupeCommaList(values) {
  const unique = [];
  const seen = new Set();

  values.forEach((value) => {
    const parts = String(value)
      .split(/[;,]/)
      .map((part) => part.trim())
      .filter(Boolean);

    parts.forEach((part) => {
      const key = normalizeText(part);
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(part);
    });
  });

  return unique;
}

function collectInterestTags(texts) {
  const joined = normalizeText(texts.join(' '));
  const tags = [];

  INTEREST_TAGS.forEach((entry) => {
    if (entry.keywords.some((keyword) => joined.includes(keyword))) {
      tags.push(entry.tag);
    }
  });

  texts.forEach((text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(trimmed) && trimmed.length <= 80) {
      if (!tags.includes(trimmed)) tags.push(trimmed);
    }
  });

  return tags;
}

function collectToolHints(texts) {
  const joined = normalizeText(texts.join(' '));
  const toolHits = [];

  TOOL_HINTS.forEach((hint) => {
    if (joined.includes(hint)) {
      toolHits.push(titleCase(hint));
    }
  });

  return toolHits;
}

function parseRoleFromText(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';

  const compact = cleaned.replace(/\s+/g, ' ');
  if (compact.length > 80) return '';
  return compact;
}

function ensureHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const prefixed = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(prefixed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

function toHandle(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length) return parts[parts.length - 1].replace(/^@/, '');
    } catch (_error) {
      return '';
    }
  }

  return raw.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
}

function normalizeSocialUrl(platform, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (platform === 'website') return ensureHttpUrl(raw);

  const direct = ensureHttpUrl(raw);
  if (direct) {
    try {
      const host = new URL(direct).hostname.toLowerCase();
      if (
        (platform === 'linkedin' && host.includes('linkedin.com')) ||
        (platform === 'github' && host.includes('github.com')) ||
        (platform === 'instagram' && host.includes('instagram.com')) ||
        (platform === 'twitter' && (host.includes('x.com') || host.includes('twitter.com'))) ||
        (platform === 'telegram' && host.includes('t.me')) ||
        (platform === 'youtube' && host.includes('youtube.com'))
      ) {
        return direct;
      }
    } catch (_error) {
      return '';
    }
  }

  const handle = toHandle(raw);
  if (!handle) return '';

  if (platform === 'linkedin') return `https://www.linkedin.com/in/${handle}`;
  if (platform === 'github') return `https://github.com/${handle}`;
  if (platform === 'instagram') return `https://www.instagram.com/${handle}`;
  if (platform === 'twitter') return `https://x.com/${handle}`;
  if (platform === 'telegram') return `https://t.me/${handle}`;
  if (platform === 'youtube') return `https://www.youtube.com/@${handle}`;

  return '';
}

function inferSocialPlatform(label, questionType, value) {
  const normalizedLabel = normalizeText(label);
  const normalizedType = normalizeText(questionType);
  const normalizedValue = normalizeText(value);

  const checks = [
    { platform: 'linkedin', pattern: /(linkedin|linked in)/ },
    { platform: 'github', pattern: /(github|git hub)/ },
    { platform: 'instagram', pattern: /(instagram|insta)/ },
    { platform: 'twitter', pattern: /(twitter|x\.com|x handle)/ },
    { platform: 'telegram', pattern: /(telegram)/ },
    { platform: 'youtube', pattern: /(youtube)/ },
  ];

  for (const check of checks) {
    if (check.pattern.test(normalizedLabel) || check.pattern.test(normalizedType) || check.pattern.test(normalizedValue)) {
      return check.platform;
    }
  }

  if (normalizedType === 'url' || /website|portfolio|site/.test(normalizedLabel)) {
    return 'website';
  }

  return '';
}

function buildGuestProfile(rawGuest) {
  const name =
    rawGuest.user_name ||
    [rawGuest.user_first_name, rawGuest.user_last_name].filter(Boolean).join(' ').trim() ||
    rawGuest.user_email ||
    rawGuest.user_api_id ||
    rawGuest.api_id ||
    '';

  if (!name) return null;

  const answers = asArray(rawGuest.registration_answers);
  const interestSet = new Set();
  const toolEntries = [];
  const roleCandidates = [];
  const networkingCandidates = [];
  const socialCandidates = {
    linkedin: [],
    github: [],
    instagram: [],
    twitter: [],
    telegram: [],
    youtube: [],
    website: [],
  };

  answers.forEach((answer) => {
    const label = normalizeText(answer && answer.label);
    const questionType = normalizeText(answer && answer.question_type);
    const values = flattenAnswerValue(answer);
    if (!values.length) return;

    const interestTags = collectInterestTags(values);
    interestTags.forEach((tag) => interestSet.add(tag));

    if (looksLikeInterestLabel(label)) {
      values.forEach((value) => {
        const inlineTags = collectInterestTags([value]);
        inlineTags.forEach((tag) => interestSet.add(tag));
      });
    }

    if (looksLikeToolsLabel(label)) {
      dedupeCommaList(values).forEach((tool) => toolEntries.push(tool));
    }

    const hintedTools = collectToolHints(values);
    hintedTools.forEach((tool) => toolEntries.push(tool));

    if (looksLikeRoleLabel(label)) {
      values.forEach((value) => {
        const role = parseRoleFromText(value);
        if (role) roleCandidates.push(role);
      });
    }

    if (looksLikeNetworkingLabel(label)) {
      values.forEach((value) => {
        const style = String(value).trim();
        if (style) networkingCandidates.push(style);
      });
    }

    values.forEach((value) => {
      const platform = inferSocialPlatform(label, questionType, value);
      if (!platform || !socialCandidates[platform]) return;
      socialCandidates[platform].push(value);
    });
  });

  const dedupedTools = dedupeCommaList(toolEntries);
  const role = roleCandidates[0] || 'Guest';
  const networkingStyle = networkingCandidates[0] || '';
  const socials = {};

  Object.keys(socialCandidates).forEach((platform) => {
    const values = socialCandidates[platform];
    for (const value of values) {
      const normalized = normalizeSocialUrl(platform, value);
      if (!normalized) continue;
      socials[platform] = normalized;
      break;
    }
  });

  return {
    id: rawGuest.user_api_id || rawGuest.api_id || normalizeKey(name),
    name,
    role,
    interests: [...interestSet],
    tools: dedupedTools,
    networkingStyle,
    socials,
  };
}

function intersection(a, b) {
  const bSet = new Set(b);
  return a.filter((item) => bSet.has(item));
}

function tokenizeTools(toolsText) {
  return String(toolsText || '')
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function shareRoleKeywords(aRole, bRole) {
  const roleTokens = ['founder', 'developer', 'designer', 'creator', 'producer', 'artist'];
  const a = normalizeText(aRole);
  const b = normalizeText(bRole);
  return roleTokens.some((token) => a.includes(token) && b.includes(token));
}

function buildReason(sharedInterests, sharedTools, sameNetworking) {
  const clauses = [];

  if (sharedInterests.length >= 2) {
    clauses.push(`Shared interests in ${sharedInterests[0]} and ${sharedInterests[1]}.`);
  } else if (sharedInterests.length === 1) {
    clauses.push(`Shared interest in ${sharedInterests[0]}.`);
  }

  if (sharedTools.length > 0) {
    clauses.push(`Both use ${sharedTools.slice(0, 2).join(' and ')}.`);
  }

  if (sameNetworking) {
    clauses.push('Similar networking preferences.');
  }

  if (!clauses.length) {
    clauses.push('Strong potential for a high-signal conversation.');
  }

  return clauses.join(' ');
}

function computePairScore(a, b) {
  const sharedInterests = intersection(a.interests, b.interests);

  const sharedTools = intersection(tokenizeTools(a.tools.join(', ')), tokenizeTools(b.tools.join(', '))).map(titleCase);

  const sameNetworking =
    Boolean(a.networkingStyle) &&
    Boolean(b.networkingStyle) &&
    normalizeText(a.networkingStyle) === normalizeText(b.networkingStyle);

  const roleOverlap = shareRoleKeywords(a.role, b.role);

  const score = sharedInterests.length * 3 + Math.min(sharedTools.length, 2) + (sameNetworking ? 1 : 0) + (roleOverlap ? 1 : 0);

  return {
    score,
    sharedInterests,
    sharedTools,
    sameNetworking,
  };
}

function scoreToStrength(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'med';
  return 'low';
}

function buildMatches(guestProfiles) {
  const matchesById = new Map();
  guestProfiles.forEach((profile) => matchesById.set(profile.id, []));

  for (let i = 0; i < guestProfiles.length; i += 1) {
    for (let j = i + 1; j < guestProfiles.length; j += 1) {
      const a = guestProfiles[i];
      const b = guestProfiles[j];
      const pair = computePairScore(a, b);

      if (pair.score < 3) continue;

      const shared = [...pair.sharedInterests, ...pair.sharedTools.map((tool) => `🔧 ${tool}`)].slice(0, 5);

      const aToB = {
        name: b.name,
        role: b.role || 'Guest',
        reason: buildReason(pair.sharedInterests, pair.sharedTools, pair.sameNetworking),
        strength: scoreToStrength(pair.score),
        shared,
        socials: b.socials || {},
        _score: pair.score,
      };

      const bToA = {
        name: a.name,
        role: a.role || 'Guest',
        reason: buildReason(pair.sharedInterests, pair.sharedTools, pair.sameNetworking),
        strength: scoreToStrength(pair.score),
        shared,
        socials: a.socials || {},
        _score: pair.score,
      };

      matchesById.get(a.id).push(aToB);
      matchesById.get(b.id).push(bToA);
    }
  }

  const normalized = {};

  guestProfiles.forEach((profile) => {
    const sortedMatches = (matchesById.get(profile.id) || [])
      .sort((left, right) => right._score - left._score || left.name.localeCompare(right.name))
      .slice(0, 5)
      .map(({ _score, ...match }) => match);

    normalized[normalizeKey(profile.name)] = {
      name: profile.name,
      role: profile.role || 'Guest',
      interests: profile.interests,
      tools: profile.tools.join(', '),
      socials: profile.socials || {},
      matches: sortedMatches,
    };
  });

  return normalized;
}

function isGuestEligible(rawGuest) {
  if (!rawGuest || typeof rawGuest !== 'object') return false;

  const approval = normalizeText(rawGuest.approval_status);
  if (approval === 'declined' || approval === 'canceled') return false;

  return Boolean(rawGuest.user_name || rawGuest.user_email || rawGuest.user_api_id || rawGuest.api_id);
}

async function fetchAllGuests({ apiKey, eventApiId, eventId, approvalStatus, paginationLimit = 100 }) {
  const entries = [];
  const seenCursors = new Set();
  let cursor = null;

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams();

    if (eventApiId) params.set('event_api_id', eventApiId);
    if (eventId) params.set('event_id', eventId);
    if (approvalStatus) params.set('approval_status', approvalStatus);
    params.set('pagination_limit', String(paginationLimit));
    if (cursor) params.set('pagination_cursor', cursor);

    const endpoint = `${LUMA_API_BASE_URL}/v1/event/get-guests?${params.toString()}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-luma-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Luma API request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const payload = await response.json();
    const pageEntries = Array.isArray(payload.entries) ? payload.entries : [];
    entries.push(...pageEntries);

    if (!payload.has_more || !payload.next_cursor) break;
    if (seenCursors.has(payload.next_cursor)) break;

    seenCursors.add(payload.next_cursor);
    cursor = payload.next_cursor;
  }

  return entries.map((entry) => entry.guest).filter(isGuestEligible);
}

async function fetchCalendarEvents({ apiKey, calendarApiId = '', paginationLimit = 50 }) {
  const events = [];
  const seenCursors = new Set();
  let cursor = null;
  let pagesFetched = 0;
  let sawHasMore = false;

  // Luma's list-events defaults to a narrow window on some API versions, so we
  // explicitly request a wide time range (far past → far future) to capture
  // every event on the calendar.
  const AFTER_EPOCH = '2000-01-01T00:00:00.000Z';
  const BEFORE_EPOCH = '2100-01-01T00:00:00.000Z';

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams();
    params.set('pagination_limit', String(paginationLimit));
    params.set('after', AFTER_EPOCH);
    params.set('before', BEFORE_EPOCH);
    if (calendarApiId) params.set('calendar_api_id', calendarApiId);
    if (cursor) params.set('pagination_cursor', cursor);

    const endpoint = `${LUMA_API_BASE_URL}/v1/calendar/list-events?${params.toString()}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-luma-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Luma calendar list failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const payload = await response.json();
    const pageEntries = Array.isArray(payload.entries) ? payload.entries : [];
    pageEntries.forEach((entry) => {
      if (entry && entry.event) events.push(entry.event);
    });

    pagesFetched += 1;
    sawHasMore = sawHasMore || Boolean(payload.has_more);

    if (!payload.has_more || !payload.next_cursor) break;
    if (seenCursors.has(payload.next_cursor)) break;

    seenCursors.add(payload.next_cursor);
    cursor = payload.next_cursor;
  }

  return { events, pagesFetched, sawHasMore };
}

function buildDynamicMaps(events, titleFilter = TITLE_FILTER) {
  const apiIdByKey = {};
  const metaByKey = {};

  events.forEach((ev) => {
    if (!ev || typeof ev !== 'object') return;
    const title = String(ev.name || ev.title || '');
    if (!title || !titleFilter.test(title)) return;

    const vol = extractVolumeNumber(title);
    if (!vol) return;

    const key = `vol${vol}`;
    const apiId = String(ev.api_id || '');
    if (!apiId) return;

    const existing = metaByKey[key];
    const existingStart = existing ? Date.parse(existing.start_at || '') : NaN;
    const newStart = Date.parse(ev.start_at || '');

    if (
      !existing ||
      (Number.isFinite(newStart) && (!Number.isFinite(existingStart) || newStart > existingStart))
    ) {
      apiIdByKey[key] = apiId;
      metaByKey[key] = {
        api_id: apiId,
        start_at: ev.start_at || null,
        name: title,
        label: formatEventLabel(title),
      };
    }
  });

  return { apiIdByKey, metaByKey };
}

function pickCurrentEventKey(metaByKey, nowMs = Date.now()) {
  let soonestFuture = null;
  let mostRecentPast = null;

  Object.entries(metaByKey || {}).forEach(([key, meta]) => {
    const ts = Date.parse((meta && meta.start_at) || '');
    if (!Number.isFinite(ts)) return;

    if (ts >= nowMs) {
      if (!soonestFuture || ts < soonestFuture.ts) soonestFuture = { key, ts };
    } else if (!mostRecentPast || ts > mostRecentPast.ts) {
      mostRecentPast = { key, ts };
    }
  });

  return (soonestFuture || mostRecentPast || {}).key || null;
}

async function getDiscoveredEvents({ apiKey, force = false }) {
  const now = Date.now();

  if (!force && calendarCache.payload && now < calendarCache.expiresAt) {
    return calendarCache.payload;
  }

  if (!apiKey) {
    return {
      events: [],
      apiIdByKey: {},
      metaByKey: {},
      currentKey: null,
      rawCount: 0,
      pagesFetched: 0,
      sawHasMore: false,
      calendarApiId: null,
      error: 'missing_api_key',
    };
  }

  const calendarApiId = String(process.env.LUMA_CALENDAR_API_ID || '').trim();

  try {
    const { events, pagesFetched, sawHasMore } = await fetchCalendarEvents({ apiKey, calendarApiId });
    const { apiIdByKey, metaByKey } = buildDynamicMaps(events);
    const currentKey = pickCurrentEventKey(metaByKey, now);

    const payload = {
      events,
      apiIdByKey,
      metaByKey,
      currentKey,
      fetchedAt: now,
      rawCount: events.length,
      pagesFetched,
      sawHasMore,
      calendarApiId: calendarApiId || null,
      error: null,
    };

    calendarCache.payload = payload;
    calendarCache.expiresAt = now + CALENDAR_TTL_SECONDS * 1000;
    return payload;
  } catch (error) {
    // Fail soft — env-var map remains authoritative if discovery is down.
    const payload = {
      events: [],
      apiIdByKey: {},
      metaByKey: {},
      currentKey: null,
      fetchedAt: now,
      rawCount: 0,
      pagesFetched: 0,
      sawHasMore: false,
      calendarApiId: calendarApiId || null,
      error: error && error.message ? error.message : 'discovery_failed',
    };
    calendarCache.payload = payload;
    calendarCache.expiresAt = now + 30 * 1000; // shorter TTL on failure
    return payload;
  }
}

async function fetchEventDetails({ apiKey, eventApiId, eventId }) {
  const fetchOne = async (idValue) => {
    if (!idValue) return null;

    const params = new URLSearchParams();
    params.set('id', idValue);

    const endpoint = `${LUMA_API_BASE_URL}/v1/event/get?${params.toString()}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-luma-api-key': apiKey,
      },
    });

    if (!response.ok) return null;

    const payload = await response.json();
    return payload && payload.event ? payload.event : null;
  };

  const candidates = [eventApiId, eventId].filter(Boolean);
  for (const candidate of candidates) {
    const event = await fetchOne(candidate);
    if (event) return event;
  }

  return null;
}

async function loadLiveMatches({ apiKey, eventApiId, eventId, explicitEventKey, explicitEventLabel, approvalStatus }) {
  const eventDetails = await fetchEventDetails({ apiKey, eventApiId, eventId });
  const resolvedEventLabel = formatEventLabel(explicitEventLabel || eventDetails?.name || eventDetails?.title || eventApiId || eventId);
  const resolvedEventKey = buildEventKey({
    explicitEvent: explicitEventKey,
    eventLabel: eventDetails?.name || eventDetails?.title || resolvedEventLabel,
    fallbackId: eventApiId || eventId,
  });

  const rawGuests = await fetchAllGuests({
    apiKey,
    eventApiId,
    eventId,
    approvalStatus,
    paginationLimit: 100,
  });

  const profiles = rawGuests.map(buildGuestProfile).filter(Boolean);
  const uniqueProfiles = [];
  const seen = new Set();

  profiles.forEach((profile) => {
    const key = normalizeKey(profile.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueProfiles.push(profile);
  });

  const guests = buildMatches(uniqueProfiles);

  return {
    source: 'live',
    generated_at: new Date().toISOString(),
    event_key: resolvedEventKey || null,
    event_label: resolvedEventLabel || null,
    event_title: eventDetails?.name || eventDetails?.title || null,
    event_api_id: eventApiId || null,
    event_id: eventId || null,
    guest_count: Object.keys(guests).length,
    guests,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const query = req.query || {};
  const mode = normalizeText(query.mode) || 'auto';
  const apiKey = process.env.LUMA_API_KEY;

  // Auto-discover events from Luma calendar (cached). Safe to await even without API key.
  const discovered = await getDiscoveredEvents({ apiKey });
  const eventSelection = resolveEventSelection(query, discovered);

  if (mode === 'fallback') {
    return res.status(200).json({
      source: 'fallback',
      event_key: eventSelection.eventKey,
      event_label: eventSelection.eventLabel,
      event_api_id: eventSelection.eventApiId || null,
      event_id: eventSelection.eventId || null,
      reason: 'forced_fallback_mode',
      guests: {},
    });
  }

  const eventApiId = eventSelection.eventApiId;
  const eventId = eventSelection.eventId;
  const approvalStatus = query.approval_status || process.env.LUMA_GUEST_APPROVAL_STATUS || 'approved';

  if (!apiKey) {
    return res.status(503).json({
      source: 'live',
      event_key: eventSelection.eventKey,
      event_label: eventSelection.eventLabel,
      event_api_id: eventApiId || null,
      event_id: eventId || null,
      error: 'Missing LUMA_API_KEY environment variable.',
    });
  }

  // Fix for the silent-fallback trap: if the caller asked for a specific event key
  // (e.g. ?event=vol11) and we can't resolve it via LUMA_EVENT_MAP or calendar discovery,
  // return a clear error instead of serving the wrong event via LUMA_EVENT_API_ID.
  if (eventSelection.explicitKeyUnresolved) {
    return res.status(404).json({
      source: 'live',
      event_key: eventSelection.eventKey,
      event_label: eventSelection.eventLabel,
      error: `Unknown event "${eventSelection.explicitEvent}". Known keys: ${eventSelection.availableKeys.join(', ') || '(none)'}. Add the event to LUMA_EVENT_MAP or ensure the Luma event title contains "Vol. N" so it is auto-discovered.`,
    });
  }

  if (!eventApiId && !eventId) {
    return res.status(503).json({
      source: 'live',
      event_key: eventSelection.eventKey,
      event_label: eventSelection.eventLabel,
      error: 'Missing event. Provide query event_api_id/event_id or configure LUMA_EVENT_MAP + LUMA_DEFAULT_EVENT_KEY.',
    });
  }

  const cacheKey = `${eventSelection.eventKey || ''}:${eventApiId || eventId}:${approvalStatus}`;
  const now = Date.now();

  if (cache.payload && cache.key === cacheKey && now < cache.expiresAt) {
    return res.status(200).json(cache.payload);
  }

  try {
    const payload = await loadLiveMatches({
      apiKey,
      eventApiId,
      eventId,
      explicitEventKey: eventSelection.explicitEvent || eventSelection.eventKey,
      explicitEventLabel: query.event_label || '',
      approvalStatus,
    });

    cache.payload = payload;
    cache.key = cacheKey;
    cache.expiresAt = now + CACHE_TTL_SECONDS * 1000;

    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error while syncing Luma guests.';

    return res.status(502).json({
      source: 'live',
      event_key: eventSelection.eventKey,
      event_label: eventSelection.eventLabel,
      event_api_id: eventApiId || null,
      event_id: eventId || null,
      error: message,
    });
  }
};

// Expose discovery helpers for the /api/events handler to reuse the same cache.
module.exports.getDiscoveredEvents = getDiscoveredEvents;
module.exports.pickCurrentEventKey = pickCurrentEventKey;
module.exports.buildDynamicMaps = buildDynamicMaps;
module.exports.fetchCalendarEvents = fetchCalendarEvents;
