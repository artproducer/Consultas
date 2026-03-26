const { buildLogoutCookie } = require('./_session');
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

  return json(200, { ok: true }, { 'Set-Cookie': buildLogoutCookie(), ...cors });
};
