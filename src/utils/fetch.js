'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const DEFAULTS = Object.freeze({ timeoutMs: 10000, maxRedirects: 3, maxBytes: 5 * 1024 * 1024 });
// IANA Special-Purpose Address Registries, updated 2025-10-09. The compact
// CIDR snapshots make routability deterministic; registry updates are reviewed
// here instead of being inferred from unrelated GeoIP coverage.
const NON_GLOBAL = new net.BlockList();
const GLOBAL = new net.BlockList();
const IPV6_GLOBAL_UNICAST = new net.BlockList();
const NAT64_GLOBAL = new net.BlockList();
IPV6_GLOBAL_UNICAST.addSubnet('2000::', 3, 'ipv6');
NAT64_GLOBAL.addSubnet('64:ff9b::', 96, 'ipv6');
for (const cidr of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4']) {
  const [address, prefix] = cidr.split('/'); NON_GLOBAL.addSubnet(address, Number(prefix), 'ipv4');
}
for (const cidr of ['::/128', '::1/128', '64:ff9b:1::/48', '100::/64', '100:0:0:1::/64', '2001::/23', '2001:2::/48', '2001:10::/28', '2001:db8::/32', '2002::/16', '3fff::/20', '5f00::/16', 'fc00::/7', 'fe80::/10']) {
  const [address, prefix] = cidr.split('/'); NON_GLOBAL.addSubnet(address, Number(prefix), 'ipv6');
}
for (const cidr of ['192.0.0.9/32', '192.0.0.10/32', '2001:1::1/128', '2001:1::2/128', '2001:1::3/128', '2001:3::/32', '2001:4:112::/48', '2001:20::/28', '2001:30::/28']) {
  const [address, prefix] = cidr.split('/'); GLOBAL.addSubnet(address, Number(prefix), net.isIPv4(address) ? 'ipv4' : 'ipv6');
}

function mappedIpv4(address) {
  const match = /^::ffff:(.+)$/i.exec(address);
  if (!match) return null;
  if (net.isIPv4(match[1])) return match[1];
  const words = match[1].split(':');
  if (words.length !== 2 || words.some(word => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
  const value = (Number.parseInt(words[0], 16) * 0x10000) + Number.parseInt(words[1], 16);
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function isGlobalAddress(address) {
  const normalized = String(address).replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = mappedIpv4(normalized);
  if (mapped) return isGlobalAddress(mapped);
  const family = net.isIP(normalized);
  if (!family) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (GLOBAL.check(normalized, type)) return true;
  if (NON_GLOBAL.check(normalized, type)) return false;
  return family === 4 || IPV6_GLOBAL_UNICAST.check(normalized, 'ipv6') || NAT64_GLOBAL.check(normalized, 'ipv6');
}

async function defaultLookup(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

function defaultRequest(options) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: options.protocol,
      hostname: options.address,
      family: options.family,
      port: options.port,
      path: options.path,
      method: options.method,
      headers: options.headers,
      servername: options.servername,
      signal: options.signal,
    }, resolve);
    request.once('error', reject);
    request.end();
  });
}

function headerValue(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  const key = Object.keys(headers || {}).find(item => item.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

async function consume(response, maxBytes) {
  const declared = Number(headerValue(response.headers, 'content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy?.();
    throw new Error('Response size limit exceeded');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
    if (total > maxBytes) {
      response.destroy?.();
      throw new Error('Response size limit exceeded');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createSafeFetch(deps = {}) {
  const lookup = deps.lookup || defaultLookup;
  const request = deps.request || defaultRequest;
  return async function safeFetch(input, options = {}) {
    const policy = { ...DEFAULTS, ...options };
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timeout = setTimeout(() => controller.abort(new Error('Total request timeout exceeded')), policy.timeoutMs);
    let activeBody;
    const cancelBody = () => activeBody?.destroy?.(signal.reason || new Error('Request aborted'));
    signal.addEventListener('abort', cancelBody, { once: true });
    async function run() {
      let url = new URL(input);
      for (let redirects = 0; ; redirects++) {
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported URL destination');
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const literalFamily = net.isIP(hostname);
        const answers = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookup(hostname, { signal });
        if (!answers.length || answers.some(answer => !isGlobalAddress(answer.address))) throw new Error('Prohibited network destination');
        const pinned = answers[0];
        const headers = { ...(options.headers || {}), Host: url.host };
        const response = await request({
          protocol: url.protocol, address: pinned.address, family: pinned.family,
          port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`,
          method: options.method || 'GET', headers, servername: literalFamily ? undefined : hostname, signal,
        });
        activeBody = response;
        const status = response.statusCode ?? response.status;
        const location = headerValue(response.headers, 'location');
        if (status >= 300 && status < 400 && location) {
          response.destroy?.();
          activeBody = undefined;
          if (redirects >= policy.maxRedirects) throw new Error('Redirect limit exceeded');
          url = new URL(location, url);
          continue;
        }
        const body = await consume(response, policy.maxBytes);
        activeBody = undefined;
        return new Response(body, { status, headers: response.headers });
      }
    }
    try {
      return await Promise.race([
        run(),
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason || new Error('Total request timeout exceeded')), { once: true })),
      ]);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancelBody);
    }
  };
}

module.exports = { createSafeFetch, isGlobalAddress };
