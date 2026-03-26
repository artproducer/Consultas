const {
  timingSafeEqualStr,
  createSessionToken,
  buildSessionCookie
} = require('./_session');

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365; // 365 dias

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Metodo no permitido' });
  }

  const appPassword = process.env.APP_PASSWORD || '';
  const sessionSecret = process.env.SESSION_SECRET || '';

  if (!appPassword || !sessionSecret) {
    return json(500, { ok: false, error: 'Faltan variables de entorno' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { ok: false, error: 'Body invalido' });
  }

  const password = String(body.password || '');
  if (!password || !timingSafeEqualStr(password, appPassword)) {
    return json(401, { ok: false, error: 'Credenciales invalidas' });
  }

  const token = createSessionToken(sessionSecret, SESSION_TTL_SECONDS);
  const cookie = buildSessionCookie(token, SESSION_TTL_SECONDS);

  return json(
    200,
    { ok: true, ttl: SESSION_TTL_SECONDS },
    { 'Set-Cookie': cookie }
  );
};
