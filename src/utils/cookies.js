'use strict';

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

function shouldUseSecureAdminCookie(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === 'https';
}

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
