'use strict';

// Minimal cookie parser for Socket.IO handshakes where cookie-parser middleware
// is not available.
function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map(chunk => chunk.trim())
      .filter(Boolean)
      .map(chunk => {
        const [key, ...rest] = chunk.split('=');
        return [key, rest.join('=')];
      })
  );
}

// Admin cookies must be Secure when the original request is HTTPS, even if Node
// receives plain HTTP from a reverse proxy.
function shouldUseSecureAdminCookie(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === 'https';
}

// SameSite=None is valid only with Secure cookies in modern browsers. Downgrade
// to Lax for plain HTTP development so cookies are not silently rejected.
function sameSiteForRequest(req, cookieSameSite = 'lax') {
  return cookieSameSite === 'none' && !shouldUseSecureAdminCookie(req)
    ? 'lax'
    : cookieSameSite;
}

module.exports = {
  parseCookies,
  shouldUseSecureAdminCookie,
  sameSiteForRequest,
};
