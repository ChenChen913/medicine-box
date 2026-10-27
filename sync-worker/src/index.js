const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_MEDICINES = 5000;
const MAX_SHOPPING = 5000;
const MAX_LOGS = 20000;

const EXACT_ORIGINS = new Set([
  'https://medicine-box.pages.dev',
  'https://chenchen913.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:4178',
  'http://127.0.0.1:4178',
]);

function allowedOrigin(origin) {
  if (!origin) return '';
  if (EXACT_ORIGINS.has(origin)) return origin;
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && url.hostname.endsWith('.medicine-box.pages.dev')) return origin;
  } catch { /* 非法 Origin 一律拒绝 */ }
  return '';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(request, body, status = 200, extraHeaders = {}) {
  const origin = allowedOrigin(request.headers.get('Origin') || '');
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? corsHeaders(origin) : {}),
      ...extraHeaders,
    },
  });
}

async function syncId(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  const key = match ? match[1].trim() : '';
  if (key.length < 16 || key.length > 256) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function validateDb(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '数据必须是对象';
  const { medicines, shoppingList, logs } = data;
  if (!Array.isArray(medicines) || !Array.isArray(shoppingList) || !Array.isArray(logs)) {
    return '数据必须包含 medicines、shoppingList、logs 三个数组';
  }
  if (medicines.length > MAX_MEDICINES || shoppingList.length > MAX_SHOPPING || logs.length > MAX_LOGS) {
    return '记录数量超过上限';
  }
  if (medicines.some(m => !m || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !m.name.trim())) {
    return '药品记录缺少有效的 id 或 name';
  }
  if (shoppingList.some(i => !i || typeof i.id !== 'string' || !i.id || typeof i.medicine_name !== 'string' || !i.medicine_name.trim())) {
    return '补货记录缺少有效的 id 或 medicine_name';
  }
  if (logs.some(l => !l || typeof l.id !== 'string' || !l.id || typeof l.medicine_name !== 'string' || !l.medicine_name.trim())) {
    return '用药记录缺少有效的 id 或 medicine_name';
  }
  if (JSON.stringify(data).length > MAX_BODY_BYTES) return '数据超过 4 MiB 上限';
  return null;
}

async function readState(env, id) {
  return env.DB.prepare('SELECT data, version, updated_at FROM sync_states WHERE sync_id = ?1')
    .bind(id)
    .first();
}

function statePayload(row) {
  return {
    data: row ? JSON.parse(row.data) : null,
    version: row ? row.version : 0,
    updatedAt: row ? row.updated_at : null,
  };
}

async function handleGet(request, env, id) {
  const row = await readState(env, id);
  if (!row) return json(request, { error: 'not_found' }, 404);
  return json(request, statePayload(row));
}

async function handlePut(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, { error: '请求体必须是合法 JSON' }, 400);
  }
  const baseVersion = body?.baseVersion;
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    return json(request, { error: 'baseVersion 必须是非负整数' }, 400);
  }
  const validationError = validateDb(body?.data);
  if (validationError) return json(request, { error: validationError }, 400);

  const existing = await readState(env, id);
  if (!existing) {
    if (baseVersion !== 0) {
      return json(request, { error: 'version_conflict', current: { data: null, version: 0, updatedAt: null } }, 409);
    }
    const now = new Date().toISOString();
    try {
      await env.DB.prepare('INSERT INTO sync_states (sync_id, data, version, updated_at) VALUES (?1, ?2, 1, ?3)')
        .bind(id, JSON.stringify(body.data), now)
        .run();
      return json(request, { data: body.data, version: 1, updatedAt: now });
    } catch {
      const current = await readState(env, id);
      return json(request, { error: 'version_conflict', current: statePayload(current) }, 409);
    }
  }

  if (existing.version !== baseVersion) {
    return json(request, { error: 'version_conflict', current: statePayload(existing) }, 409);
  }

  const now = new Date().toISOString();
  const nextVersion = baseVersion + 1;
  const result = await env.DB.prepare(
    'UPDATE sync_states SET data = ?1, version = ?2, updated_at = ?3 WHERE sync_id = ?4 AND version = ?5'
  ).bind(JSON.stringify(body.data), nextVersion, now, id, baseVersion).run();

  if (!result.meta.changes) {
    const current = await readState(env, id);
    return json(request, { error: 'version_conflict', current: statePayload(current) }, 409);
  }
  return json(request, { data: body.data, version: nextVersion, updatedAt: now });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (origin && !allowedOrigin(origin)) {
      return json(request, { error: 'origin_not_allowed' }, 403);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Cache-Control': 'no-store',
          ...corsHeaders(allowedOrigin(origin)),
        },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json(request, { ok: true });
    }
    if (url.pathname !== '/api/state') {
      return json(request, { error: 'not_found' }, 404);
    }

    const id = await syncId(request);
    if (!id) return json(request, { error: 'unauthorized' }, 401);

    try {
      if (request.method === 'GET') return await handleGet(request, env, id);
      if (request.method === 'PUT') return await handlePut(request, env, id);
      return json(request, { error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT, OPTIONS' });
    } catch {
      // 不把 SQL、密钥或数据内容写进错误响应/日志
      return json(request, { error: 'internal_error' }, 500);
    }
  },
};
