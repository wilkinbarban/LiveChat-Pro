'use strict';

const rateLimit = require('express-rate-limit');

const rateLimitMessage = { error: 'Demasiadas peticiones. Inténtalo más tarde.' };

function rateLimitWindowMs(windowMinutes) {
  return Math.max(1, windowMinutes) * 60 * 1000;
}

function createHttpRateLimiters({ rateLimitConfig, adminCookieName, verifyAdminToken }) {
  const windowMs = rateLimitWindowMs(rateLimitConfig.windowMinutes);

  const publicApiLimiter = rateLimit({
    windowMs,
    max: Math.max(1, rateLimitConfig.publicMax),
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
  });

  const loginLimiter = rateLimit({
    windowMs,
    max: Math.max(1, rateLimitConfig.loginMax),
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
  });

  const adminLimiter = rateLimit({
    windowMs,
    max: Math.max(1, rateLimitConfig.adminMax),
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
    skip: req => verifyAdminToken(req.cookies?.[adminCookieName]),
  });

  const uploadLimiter = rateLimit({
    windowMs: rateLimitWindowMs(rateLimitConfig.uploadWindowMinutes || 1),
    max: Math.max(1, rateLimitConfig.uploadMax || 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas imágenes. Inténtalo más tarde.' },
    keyGenerator: req => `${req.ip}:${req.params?.sessionId || req.body?.sessionId || 'unknown'}`,
    skip: req => verifyAdminToken(req.cookies?.[adminCookieName]),
  });

  return {
    publicApiLimiter,
    loginLimiter,
    adminLimiter,
    uploadLimiter,
  };
}

function createMsgRateLimiter(maxMsgs = 20, windowMs = 60000) {
  let count = 0;
  let resetAt = Date.now() + windowMs;
  return function isAllowed() {
    const now = Date.now();
    if (now > resetAt) {
      count = 0;
      resetAt = now + windowMs;
    }
    if (count >= maxMsgs) return false;
    count++;
    return true;
  };
}

module.exports = {
  createHttpRateLimiters,
  createMsgRateLimiter,
  rateLimitWindowMs,
};
