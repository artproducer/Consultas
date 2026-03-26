const { buildLogoutCookie } = require('./_session');

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

exports.handler = async () => {
  return json(200, { ok: true }, { 'Set-Cookie': buildLogoutCookie() });
};
