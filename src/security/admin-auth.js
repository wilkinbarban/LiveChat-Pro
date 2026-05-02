'use strict';

const crypto = require('crypto');
const {
  shouldUseSecureAdminCookie,
  sameSiteForRequest: resolveSameSiteForRequest,
} = require('../utils/cookies');

function isHexToken(value, size) {
  return typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`, 'i').test(value);
}

// Builds all admin authentication helpers around the configured cookie names and
// password. The module is intentionally stateless: tokens are signed and carry
// their own expiration timestamp.
function createAdminAuth({
  telegramToken,
  adminPanelPassword,
  adminSessionTtlMs,
  adminCookieName,
  csrfCookieName,
  cookieSameSite,
}) {
  // Admin sessions are HMAC-signed with both the Telegram token and panel
  // password. Rotating either secret invalidates existing cookies.
  function createAdminSignature(payload) {
    return crypto
      .createHmac('sha256', `${telegramToken}:${adminPanelPassword}`)
      .update(payload)
      .digest('hex');
  }

  // Session token format: "<expiresAt>.<hmac>". No server-side session table is
  // required, which keeps single-node and Redis deployments consistent.
  function createAdminToken() {
    const expiresAt = Date.now() + adminSessionTtlMs;
    const payload = String(expiresAt);
    return `${payload}.${createAdminSignature(payload)}`;
  }

  function createCsrfToken() {
    return crypto.randomBytes(24).toString('hex');
  }

  function sameSiteForRequest(req) {
    return resolveSameSiteForRequest(req, cookieSameSite);
  }

  // The CSRF cookie is readable by the admin page so the client can echo it in
  // x-csrf-token. It is not an auth credential; it only binds unsafe requests to
  // a browser that first loaded the admin origin.
  function ensureCsrfCookie(req, res) {
    const current = req.cookies?.[csrfCookieName];
    if (isHexToken(current, 48)) return current;

    const token = createCsrfToken();
    res.cookie(csrfCookieName, token, {
      httpOnly: false,
      sameSite: sameSiteForRequest(req),
      secure: shouldUseSecureAdminCookie(req),
      path: '/',
      maxAge: adminSessionTtlMs,
    });
    return token;
  }

  // Double-submit CSRF validation. The cookie and header must both be valid
  // 48-character hex tokens and match using timing-safe comparison.
  function verifyCsrf(req) {
    const cookieToken = req.cookies?.[csrfCookieName] || '';
    const headerToken = (req.get('x-csrf-token') || '').trim();
    if (!isHexToken(cookieToken, 48) || !isHexToken(headerToken, 48)) return false;

    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerToken);
    if (cookieBuffer.length !== headerBuffer.length) return false;
    return crypto.timingSafeEqual(cookieBuffer, headerBuffer);
  }

  function requireCsrf(req, res, next) {
    if (verifyCsrf(req)) return next();
    return res.status(403).json({ error: 'CSRF token inválido o ausente' });
  }

  // Verifies signature and expiration without decoding any untrusted structured
  // data. The payload is only a millisecond timestamp string.
  function verifyAdminToken(token) {
    if (!token || !adminPanelPassword) return false;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;

    const expected = createAdminSignature(payload);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return false;
    if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;

    return Number(payload) > Date.now();
  }

  // requireAdmin also refreshes the CSRF cookie for authenticated and
  // unauthenticated admin API reads, so the panel can recover after cookie loss.
  function requireAdmin(req, res, next) {
    ensureCsrfCookie(req, res);

    if (!adminPanelPassword) {
      return res.status(503).json({ error: 'El panel admin no está habilitado. Define ADMIN_PANEL_PASSWORD.' });
    }

    if (!verifyAdminToken(req.cookies?.[adminCookieName])) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    next();
  }

  return {
    createAdminToken,
    ensureCsrfCookie,
    verifyCsrf,
    requireCsrf,
    verifyAdminToken,
    requireAdmin,
    sameSiteForRequest,
    shouldUseSecureAdminCookie,
  };
}

module.exports = {
  createAdminAuth,
  isHexToken,
};
