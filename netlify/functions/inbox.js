const {
  COOKIE_NAME,
  parseCookies,
  verifySessionToken
} = require('./_session');
const { getCorsHeaders } = require('./_cors');

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

exports.handler = async (event) => {
  const cors = getCorsHeaders(event && event.headers && event.headers.origin);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Cache-Control': 'no-store',
        ...cors
      },
      body: ''
    };
  }

  if (event.headers && event.headers.origin && !cors['Access-Control-Allow-Origin']) {
    return json(403, { ok: false, error: 'Origen no permitido' });
  }

  const sessionSecret = process.env.SESSION_SECRET || '';
  const gasUrl = process.env.GAS_URL || '';
  const gasToken = process.env.GAS_TOKEN || '';

  if (!sessionSecret || !gasUrl || !gasToken) {
    return json(500, { ok: false, error: 'Faltan variables de entorno' }, cors);
  }

  const cookies = parseCookies(event.headers && event.headers.cookie);
  const sessionToken = cookies[COOKIE_NAME] || '';
  if (!verifySessionToken(sessionToken, sessionSecret)) {
    return json(401, { ok: false, error: 'No autorizado' }, cors);
  }

  const qs = event.queryStringParameters || {};
  const action = String(qs.action || 'search').trim();

  if (action === 'ping') {
    return json(200, { ok: true, pong: true, ts: Date.now() }, cors);
  }

  if (action !== 'search') {
    return json(400, { ok: false, error: 'Accion no soportada' }, cors);
  }

  const filter = String(qs.filter || '').trim();
  const max = clampInt(qs.max, 10, 1, 100);
  if (!filter) {
    return json(400, { ok: false, error: 'Falta filter' }, cors);
  }

  try {
    const gasQs = new URLSearchParams({
      action: 'search',
      filter,
      max: String(max),
      token: gasToken
    });

    const res = await fetch(`${gasUrl}?${gasQs.toString()}`);
    if (!res.ok) {
      return json(502, { ok: false, error: 'Error consultando GAS' }, cors);
    }

    const payload = await res.json();
    if (!payload || payload.ok !== true) {
      return json(502, { ok: false, error: (payload && payload.error) ? payload.error : 'Respuesta invalida de GAS' }, cors);
    }

    return json(200, payload, cors);
  } catch (_) {
    return json(502, { ok: false, error: 'No se pudo consultar GAS' }, cors);
  }
};
