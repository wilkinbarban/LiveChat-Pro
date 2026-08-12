'use strict';

const SENSITIVE_QUERY_KEYS = new Set(['token', 'access_token', 'api_key', 'key', 'signature']);

function redactUrl(value) {
  const text = String(value || '');
  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(text);
    const url = new URL(text, 'http://local.invalid');
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return text.replace(/([?&](?:token|access_token|api_key|key|signature)=)[^&#]*/gi, '$1%5BREDACTED%5D');
  }
}

function createRequestLoggerMiddleware({ logger, now = Date.now, randomUUID }) {
  return (req, res, next) => {
    const rawRequestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : '';
    const requestId = rawRequestId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64) || randomUUID();
    const startedAt = now();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => logger.info({
      requestId,
      method: req.method,
      path: redactUrl(req.originalUrl),
      statusCode: res.statusCode,
      durationMs: now() - startedAt,
      ip: req.ip,
    }, 'http_request'));
    next();
  };
}

module.exports = { redactUrl, createRequestLoggerMiddleware };
