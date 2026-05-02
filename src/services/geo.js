'use strict';

const net = require('net');
const geoip = require('geoip-lite');

function normalizeClientIp(value) {
  if (typeof value !== 'string') return '';
  let ip = value.trim().replace(/^"|"$/g, '');
  if (!ip) return '';

  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end !== -1) ip = ip.slice(1, end);
  }

  ip = ip.replace(/^::ffff:/i, '');

  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(':'));
  }

  if (ip === 'localhost') ip = '127.0.0.1';
  return net.isIP(ip) ? ip : '';
}

function isPrivateClientIp(ip) {
  const normalizedIp = normalizeClientIp(ip);
  if (!normalizedIp) return true;

  if (net.isIP(normalizedIp) === 6) {
    const lower = normalizedIp.toLowerCase();
    return lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80:');
  }

  const parts = normalizedIp.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;

  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function getClientIpFromSocket(socket) {
  const headers = socket.handshake.headers || {};
  const candidates = [];

  for (const headerName of ['cf-connecting-ip', 'true-client-ip', 'x-real-ip']) {
    const value = headers[headerName];
    if (typeof value === 'string') candidates.push(value);
  }

  const forwardedFor = headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    candidates.push(...forwardedFor.split(',').map(value => value.trim()));
  }

  if (socket.handshake.address) candidates.push(socket.handshake.address);

  const normalized = candidates
    .map(normalizeClientIp)
    .filter(Boolean);

  return normalized.find(ip => !isPrivateClientIp(ip)) || normalized[0] || '';
}

function shouldRefreshGeo(session, ip) {
  const normalizedIp = normalizeClientIp(ip);
  if (!session || !normalizedIp) return false;

  const currentIp = normalizeClientIp(session.ip);
  const hasUnknownGeo = !session.geo ||
    !session.geo.city ||
    !session.geo.country ||
    session.geo.city === 'Desconocido' ||
    session.geo.country === 'Desconocido';

  if (!currentIp) return true;
  if (currentIp !== normalizedIp && !isPrivateClientIp(normalizedIp)) return true;
  return hasUnknownGeo && !isPrivateClientIp(normalizedIp);
}

async function getGeoInfo(ip, geoLocationEnabled = true) {
  if (!geoLocationEnabled) return { city: 'N/A', country: 'N/A', isp: 'N/A', ip };

  const normalizedIp = normalizeClientIp(ip);
  if (isPrivateClientIp(normalizedIp)) {
    return { city: 'Desconocido', country: 'Desconocido', isp: 'IP privada/local', ip: normalizedIp || ip };
  }

  const geo = normalizedIp ? geoip.lookup(normalizedIp) : null;

  if (!geo) {
    return { city: 'Desconocido', country: 'Desconocido', isp: 'Base local', ip: normalizedIp || ip };
  }

  return {
    city: geo.city || 'Desconocido',
    country: geo.country || 'Desconocido',
    isp: 'Base local',
    ip: normalizedIp,
  };
}

module.exports = {
  normalizeClientIp,
  isPrivateClientIp,
  getClientIpFromSocket,
  shouldRefreshGeo,
  getGeoInfo
};
