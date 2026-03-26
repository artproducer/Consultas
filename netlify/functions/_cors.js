function normalize(str) {
  return String(str || '').trim();
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function allowedOriginsFromEnv() {
  const list = [];

  const rawCsv = normalize(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN);
  if (rawCsv) {
    rawCsv.split(',').map(s => s.trim()).forEach(v => list.push(v));
  }

  // Netlify primary URL and deploy preview URL (if present)
  list.push(normalize(process.env.URL));
  list.push(normalize(process.env.DEPLOY_PRIME_URL));

  return unique(list);
}

function getCorsHeaders(originHeader) {
  const origin = normalize(originHeader);
  const allowed = allowedOriginsFromEnv();

  if (!origin || !allowed.includes(origin)) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin'
  };
}

module.exports = {
  getCorsHeaders
};
