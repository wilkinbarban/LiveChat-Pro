'use strict';

const { escapeHtml, safeCssColor } = require('../utils/sanitizer');

// Static copy for the HTML health page. The JSON endpoint uses the same payload
// without localization.
const HEALTH_I18N = {
  es: {
    ok: 'Activo', off: 'Inactivo', eyebrow: 'LiveChat Pro health',
    title: 'Sistema operativo y listo para atender.',
    subtitle: 'Esta vista resume servidor, Telegram, sesiones, traducción, estado compartido y configuración visible del widget.',
    memory: 'Sesiones en memoria', shared: 'Estado compartido', adminLang: 'Idioma admin', uptime: 'Uptime',
    services: 'Servicios y funciones', telegram: 'Telegram bot', widgetColor: 'Widget color', widgetButton: 'Botón del widget', multilingual: 'Saludo multidioma',
    links: 'Accesos rápidos', demo: 'Abrir demo', admin: 'Abrir admin', json: 'Ver JSON',
  },
  en: {
    ok: 'Active', off: 'Inactive', eyebrow: 'LiveChat Pro health',
    title: 'System online and ready to help.',
    subtitle: 'This view summarizes the server, Telegram, sessions, translation, shared state and visible widget configuration.',
    memory: 'Sessions in memory', shared: 'Shared state', adminLang: 'Admin language', uptime: 'Uptime',
    services: 'Services and features', telegram: 'Telegram bot', widgetColor: 'Widget color', widgetButton: 'Widget button', multilingual: 'Multilingual greeting',
    links: 'Quick links', demo: 'Open demo', admin: 'Open admin', json: 'View JSON',
  },
  pt: {
    ok: 'Ativo', off: 'Inativo', eyebrow: 'LiveChat Pro health',
    title: 'Sistema online e pronto para atender.',
    subtitle: 'Esta tela resume servidor, Telegram, sessões, tradução, estado compartilhado e configuração visível do widget.',
    memory: 'Sessões em memória', shared: 'Estado compartilhado', adminLang: 'Idioma admin', uptime: 'Uptime',
    services: 'Serviços e recursos', telegram: 'Bot Telegram', widgetColor: 'Cor do widget', widgetButton: 'Botão do widget', multilingual: 'Saudação multilíngue',
    links: 'Acessos rápidos', demo: 'Abrir demo', admin: 'Abrir admin', json: 'Ver JSON',
  },
  fr: {
    ok: 'Actif', off: 'Inactif', eyebrow: 'LiveChat Pro health',
    title: 'Système en ligne et prêt à répondre.',
    subtitle: 'Cette vue résume le serveur, Telegram, les sessions, la traduction, l’état partagé et la configuration visible du widget.',
    memory: 'Sessions en mémoire', shared: 'État partagé', adminLang: 'Langue admin', uptime: 'Uptime',
    services: 'Services et fonctions', telegram: 'Bot Telegram', widgetColor: 'Couleur du widget', widgetButton: 'Bouton du widget', multilingual: 'Accueil multilingue',
    links: 'Accès rapides', demo: 'Ouvrir la démo', admin: 'Ouvrir admin', json: 'Voir JSON',
  },
  de: {
    ok: 'Aktiv', off: 'Inaktiv', eyebrow: 'LiveChat Pro health',
    title: 'System online und bereit.',
    subtitle: 'Diese Ansicht zeigt Server, Telegram, Sitzungen, Übersetzung, geteilten Status und sichtbare Widget-Konfiguration.',
    memory: 'Sitzungen im Speicher', shared: 'Geteilter Status', adminLang: 'Admin-Sprache', uptime: 'Uptime',
    services: 'Dienste und Funktionen', telegram: 'Telegram-Bot', widgetColor: 'Widget-Farbe', widgetButton: 'Widget-Button', multilingual: 'Mehrsprachige Begrüßung',
    links: 'Schnellzugriffe', demo: 'Demo öffnen', admin: 'Admin öffnen', json: 'JSON anzeigen',
  },
};

function healthLabel(value, lang = 'es') {
  const dict = HEALTH_I18N[lang] || HEALTH_I18N.es;
  return value ? dict.ok : dict.off;
}

// Compact uptime formatter for the status cards.
function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

// Public operational snapshot. It intentionally avoids secrets while exposing
// enough configuration to debug deployment and widget behavior.
function buildHealthPayload({ sessions, clusterState, telegramReady, config }) {
  return {
    status: 'ok',
    sessions: sessions.size,
    stateMode: clusterState.mode,
    telegramReady,
    adminLanguage: config.admin.language,
    uptime: Math.floor(process.uptime()),
    port: config.server.port,
    widget: {
      primaryColor: config.widget.primaryColor,
      buttonStyle: config.widget.buttonStyle,
      multilingualWelcome: !config.widget.welcomeMessage,
    },
    features: config.features,
  };
}

// Renders a self-contained HTML page so /health can be inspected directly from a
// browser without requiring any frontend build step.
function renderHealthPage(data, lang = 'es') {
  const copy = HEALTH_I18N[lang] || HEALTH_I18N.es;
  const accent = safeCssColor(data.widget.primaryColor);
  const healthJson = escapeHtml(JSON.stringify(data, null, 2));
  const featureRows = Object.entries(data.features)
    .map(([key, enabled]) => `<div class="check"><span>${escapeHtml(key)}</span><strong class="${enabled ? 'ok' : 'off'}">${healthLabel(enabled, lang)}</strong></div>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <title>${escapeHtml(copy.eyebrow)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    :root { --accent: ${accent}; --ink:#162033; --muted:#64748b; --line:#d9e2ec; --soft:#f4f7fb; --ok:#0f9f6e; --warn:#c2410c; --bad:#b91c1c; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:linear-gradient(135deg, rgba(79,70,229,.1), transparent 38%), linear-gradient(315deg, rgba(15,159,110,.1), transparent 30%), #eef3f8; font-family:Inter, system-ui, sans-serif; }
    .shell { width:min(1120px, calc(100% - 36px)); margin:0 auto; padding:38px 0; display:grid; gap:18px; }
    .hero, .panel, .status { border:1px solid var(--line); border-radius:8px; background:rgba(255,255,255,.9); box-shadow:0 18px 55px rgba(22,32,51,.08); }
    .hero { padding:28px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:22px; align-items:center; }
    .eyebrow { color:var(--accent); font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    h1 { margin:8px 0 10px; font-size:clamp(32px, 5vw, 56px); line-height:1; letter-spacing:0; }
    p { margin:0; color:var(--muted); line-height:1.6; }
    .state { min-width:170px; padding:18px; border-radius:8px; color:white; background:${data.telegramReady ? 'var(--ok)' : 'var(--warn)'}; text-align:center; }
    .state strong { display:block; font-size:26px; margin-bottom:4px; }
    .grid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; }
    .status { padding:18px; }
    .status span { display:block; color:var(--muted); font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; margin-bottom:10px; }
    .status strong { font-size:28px; }
    .content { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px, .7fr); gap:18px; align-items:start; }
    .panel { padding:22px; display:grid; gap:12px; }
    .panel h2 { margin:0; font-size:20px; }
    .check { display:flex; justify-content:space-between; gap:12px; padding:12px 0; border-bottom:1px solid var(--line); }
    .check:last-child { border-bottom:0; }
    .check strong { color:var(--ok); }
    .check strong.off { color:var(--bad); }
    .links { display:flex; flex-wrap:wrap; gap:10px; }
    .btn { display:inline-flex; align-items:center; min-height:42px; padding:0 14px; border-radius:8px; border:1px solid var(--line); color:var(--ink); background:white; text-decoration:none; font-weight:700; }
    .btn.primary { color:#fff; background:var(--accent); border-color:transparent; }
    pre { margin:0; padding:16px; overflow:auto; border-radius:8px; color:#dce8ff; background:#111827; font:13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    @media (max-width: 860px) { .hero, .content, .grid { grid-template-columns:1fr; } .state { text-align:left; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <div class="eyebrow">${escapeHtml(copy.eyebrow)}</div>
        <h1>${escapeHtml(copy.title)}</h1>
        <p>${escapeHtml(copy.subtitle)}</p>
      </div>
      <div class="state"><strong>${escapeHtml(data.status.toUpperCase())}</strong><span>Telegram ${healthLabel(data.telegramReady, lang)}</span></div>
    </section>
    <section class="grid">
      <article class="status"><span>${escapeHtml(copy.memory)}</span><strong>${data.sessions}</strong></article>
      <article class="status"><span>${escapeHtml(copy.shared)}</span><strong>${escapeHtml(data.stateMode)}</strong></article>
      <article class="status"><span>${escapeHtml(copy.adminLang)}</span><strong>${escapeHtml(data.adminLanguage)}</strong></article>
      <article class="status"><span>${escapeHtml(copy.uptime)}</span><strong>${formatDuration(data.uptime)}</strong></article>
    </section>
    <section class="content">
      <div class="panel">
        <h2>${escapeHtml(copy.services)}</h2>
        <div class="check"><span>${escapeHtml(copy.telegram)}</span><strong class="${data.telegramReady ? 'ok' : 'off'}">${healthLabel(data.telegramReady, lang)}</strong></div>
        <div class="check"><span>${escapeHtml(copy.widgetColor)}</span><strong>${escapeHtml(data.widget.primaryColor)}</strong></div>
        <div class="check"><span>${escapeHtml(copy.widgetButton)}</span><strong>${escapeHtml(data.widget.buttonStyle)}</strong></div>
        <div class="check"><span>${escapeHtml(copy.multilingual)}</span><strong class="${data.widget.multilingualWelcome ? 'ok' : 'off'}">${healthLabel(data.widget.multilingualWelcome, lang)}</strong></div>
        ${featureRows}
      </div>
      <div class="panel">
        <h2>${escapeHtml(copy.links)}</h2>
        <div class="links">
          <a class="btn primary" href="/">${escapeHtml(copy.demo)}</a>
          <a class="btn" href="/admin">${escapeHtml(copy.admin)}</a>
          <a class="btn" href="/health?format=json">${escapeHtml(copy.json)}</a>
        </div>
        <pre>${healthJson}</pre>
      </div>
    </section>
  </main>
</body>
</html>`;
}

module.exports = {
  buildHealthPayload,
  renderHealthPage
};
