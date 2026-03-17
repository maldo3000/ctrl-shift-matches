const LUMA_API_BASE_URL = process.env.LUMA_API_BASE_URL || 'https://public-api.luma.com';
const CACHE_TTL_SECONDS = Number(process.env.MATCH_CACHE_TTL_SECONDS || 120);

const cache = {
  expiresAt: 0,
  key: '',
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

function formatEventLabel(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'Event';

  const volMatch = text.match(/^vol(?:ume)?[-_ ]?(\d+)$/i);
  if (volMatch) return `Vol. ${volMatch[1]}`;

  return text
    .split(/[_-]+/g)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveEventSelection(reqQuery) {
  const query = reqQuery || {};
  const eventMap = parseJsonObject(process.env.LUMA_EVENT_MAP);
  const defaultEventKey = String(process.env.LUMA_DEFAULT_EVENT_KEY || '').trim();

  const eventKey = normalizeKey(query.event || query.event_key || defaultEventKey || '');
  const mappedEventApiId = eventKey && typeof eventMap[eventKey] === 'string' ? String(eventMap[eventKey]).trim() : '';
  const eventApiId =
    String(query.event_api_id || query.eventApiId || '').trim() ||
    mappedEventApiId ||
    String(process.env.LUMA_EVENT_API_ID || process.env.LUMA_EVENT_ID || '').trim();
  const eventId = String(query.event_id || '').trim() || String(process.env.LUMA_EVENT_ID || '').trim();
  const eventLabel = formatEventLabel(query.event_label || query.event || eventKey || eventApiId);

  return {
    eventKey: eventKey || null,
    eventLabel,
    eventApiId,
    eventId,
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

  answers.forEach((answer) => {
    const label = normalizeText(answer && answer.label);
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
  });

  const dedupedTools = dedupeCommaList(toolEntries);
  const role = roleCandidates[0] || 'Guest';
  const networkingStyle = networkingCandidates[0] || '';

  return {
    id: rawGuest.user_api_id || rawGuest.api_id || normalizeKey(name),
    name,
    role,
    interests: [...interestSet],
    tools: dedupedTools,
    networkingStyle,
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
        _score: pair.score,
      };

      const bToA = {
        name: a.name,
        role: a.role || 'Guest',
        reason: buildReason(pair.sharedInterests, pair.sharedTools, pair.sameNetworking),
        strength: scoreToStrength(pair.score),
        shared,
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

async function loadLiveMatches({ apiKey, eventApiId, eventId, eventKey, eventLabel, approvalStatus }) {
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
    event_key: eventKey || null,
    event_label: eventLabel || null,
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
  const eventSelection = resolveEventSelection(query);

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

  const apiKey = process.env.LUMA_API_KEY;
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
      eventKey: eventSelection.eventKey,
      eventLabel: eventSelection.eventLabel,
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
