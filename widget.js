/**
 * LiveChat Pro — widget.js
 * Insert this script into any HTML page:
 * <script src="https://your-server.com/widget.js" data-server="https://your-server.com"></script>
 */
(function () {
  'use strict';

  const SCRIPT_TAG = document.currentScript || document.querySelector('script[data-server]');
  const SERVER_URL = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-server')) || window.location.origin;
  const API_KEY = (SCRIPT_TAG && (SCRIPT_TAG.getAttribute('data-api-key') || SCRIPT_TAG.getAttribute('data-key'))) || '';
  const CLIENT_CONFIG = window.LiveChatConfig || window.LiveChatProConfig || {};
  const getOption = (name, fallback) => {
    const attrName = `data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
    const fromAttribute = SCRIPT_TAG && SCRIPT_TAG.getAttribute(attrName);
    const fromGlobal = CLIENT_CONFIG && CLIENT_CONFIG[name];
    const value = fromAttribute ?? fromGlobal;
    return value === undefined || value === null || value === '' ? fallback : value;
  };
  const parsePositiveInt = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const parsePercent = (value, fallback, min = 50, max = 100) => {
    const parsed = parseFloat(String(value).replace('%', ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  const optionIn = (value, allowed, fallback) => allowed.includes(String(value)) ? String(value) : fallback;
  const WIDGET_OPTIONS = {
    mobileBreakpoint: parsePositiveInt(getOption('mobileBreakpoint', 768), 768),
    mobileMode: optionIn(getOption('mobileMode', 'dock'), ['dock', 'bottom-sheet', 'fullscreen', 'compact'], 'dock'),
    mobileWidth: parsePercent(getOption('mobileWidth', 100), 100, 70, 100),
    mobileFocusedWidth: parsePercent(getOption('mobileFocusedWidth', 94), 94, 70, 100),
    mobileFocusedHeight: parsePercent(getOption('mobileFocusedHeight', 76), 76, 50, 95),
    theme: optionIn(getOption('theme', 'auto'), ['auto', 'classic'], 'auto'),
    position: optionIn(getOption('position', 'bottom-right'), ['bottom-right', 'bottom-left'], 'bottom-right'),
  };
  const RAW_WIDGET_LANG = (navigator.languages && navigator.languages[0]) || navigator.language || 'es';
  const WIDGET_LOCALE = Intl.DateTimeFormat.supportedLocalesOf([RAW_WIDGET_LANG])[0] || 'es';
  const WIDGET_BASE_LANG = ['es', 'en', 'pt', 'fr', 'de'].includes(WIDGET_LOCALE.toLowerCase().split('-')[0])
    ? WIDGET_LOCALE.toLowerCase().split('-')[0]
    : 'es';
  const UI_MESSAGES = {
    es: {
      support: 'Soporte en vivo',
      online: 'En línea',
      placeholder: 'Escribe tu mensaje...',
      greeting: name => `Hola, ${name} 👋`,
      banned: 'Has sido bloqueado de este chat.',
      attach: 'Adjuntar imagen',
      uploadError: 'No se pudo subir la imagen.',
      fileTooLarge: 'La imagen no puede superar 5 MB.',
      fileTypeError: 'Solo se permiten imágenes JPG, PNG, WebP o GIF.',
      attachmentDeleted: 'Adjunto eliminado',
    },
    en: {
      support: 'Live support',
      online: 'Online',
      placeholder: 'Write your message...',
      greeting: name => `Hi, ${name} 👋`,
      banned: 'You have been blocked from this chat.',
      attach: 'Attach image',
      uploadError: 'Could not upload the image.',
      fileTooLarge: 'Image must be 5 MB or smaller.',
      fileTypeError: 'Only JPG, PNG, WebP or GIF images are allowed.',
      attachmentDeleted: 'Attachment deleted',
    },
    pt: {
      support: 'Suporte ao vivo',
      online: 'Online',
      placeholder: 'Escreva sua mensagem...',
      greeting: name => `Olá, ${name} 👋`,
      banned: 'Você foi bloqueado deste chat.',
      attach: 'Anexar imagem',
      uploadError: 'Não foi possível enviar a imagem.',
      fileTooLarge: 'A imagem não pode passar de 5 MB.',
      fileTypeError: 'Só são permitidas imagens JPG, PNG, WebP ou GIF.',
      attachmentDeleted: 'Anexo removido',
    },
    fr: {
      support: 'Support en direct',
      online: 'Online',
      placeholder: 'Écrivez votre message...',
      greeting: name => `Bonjour, ${name} 👋`,
      banned: 'Vous avez été bloqué de ce chat.',
      attach: 'Joindre une image',
      uploadError: 'Impossible d’envoyer l’image.',
      fileTooLarge: 'L’image ne peut pas dépasser 5 Mo.',
      fileTypeError: 'Seules les images JPG, PNG, WebP ou GIF sont autorisées.',
      attachmentDeleted: 'Pièce jointe supprimée',
    },
    de: {
      support: 'Live-Support',
      online: 'Online',
      placeholder: 'Schreibe deine Nachricht...',
      greeting: name => `Hallo, ${name} 👋`,
      banned: 'Du wurdest aus diesem Chat blockiert.',
      attach: 'Bild anhängen',
      uploadError: 'Das Bild konnte nicht hochgeladen werden.',
      fileTooLarge: 'Das Bild darf maximal 5 MB groß sein.',
      fileTypeError: 'Nur JPG-, PNG-, WebP- oder GIF-Bilder sind erlaubt.',
      attachmentDeleted: 'Anhang gelöscht',
    },
  };
  const uiText = UI_MESSAGES[WIDGET_BASE_LANG];

  // ── Prevent double init ──────────────────────────────────
  if (window.__livechatPro) return;
  window.__livechatPro = true;

  // ── Load Socket.io ───────────────────────────────────────
  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src; s.onload = cb; document.head.appendChild(s);
  }

  loadScript(SERVER_URL + '/socket.io/socket.io.js', init);

  function init() {
    const chatIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z"/><path d="M8 11h8M8 15h5"/></svg>';
    const closeIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

    // ── Session persistence ────────────────────────────────
    let sessionId = localStorage.getItem('lchat_sid');
    if (!sessionId) {
      sessionId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      localStorage.setItem('lchat_sid', sessionId);
      document.cookie = `lchat_sid=${sessionId};path=/;max-age=31536000`;
    }

    // ── Fetch config ───────────────────────────────────────
    let primaryColor = '#4F46E5';
    let buttonStyle = 'floating';

    fetch(SERVER_URL + '/config-public').then(r => r.json()).then(cfg => {
      primaryColor = cfg.primaryColor || primaryColor;
      buttonStyle = cfg.buttonStyle || buttonStyle;
      applyTheme(primaryColor);
      if (buttonStyle === 'hidden') toggleBtn.style.display = 'none';
      wrap.classList.toggle('lcp-persistent', buttonStyle === 'persistent');
    }).catch(() => { });

    // ── Socket connection ──────────────────────────────────
    const socket = io(SERVER_URL, {
      auth: { sessionId, apiKey: API_KEY, lang: WIDGET_LOCALE },
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });

    // ── DOM ────────────────────────────────────────────────
    // Styles are separated so desktop and mobile layouts can evolve without
    // mixing rules. DESKTOP_CHAT_STYLES keeps the current visual foundation;
    // MOBILE_CHAT_STYLES contains only mobile adaptations.
    const DESKTOP_CHAT_STYLES = `
      #lcp-wrap {
        --lcp-font-family: inherit;
        --lcp-radius: 12px;
        --lcp-panel-bg: #fff;
        --lcp-surface-bg: #f7f7f8;
        --lcp-input-bg: #fff;
        --lcp-text-color: #18181b;
        --lcp-muted-color: #71717a;
        --lcp-border-color: rgba(24,24,27,.1);
        --lcp-header-bg: var(--lcp-panel-bg);
        --lcp-header-color: var(--lcp-text-color);
        --lcp-shadow: 0 18px 48px rgba(0,0,0,.16);
        --lcp-bottom-offset: max(24px, calc(16px + env(safe-area-inset-bottom, 0px)));
        --lcp-visual-top: 0px;
        --lcp-mobile-window-height: 100svh;
        --lcp-mobile-viewport-height: 100svh;
        --lcp-mobile-window-bottom: max(68px, calc(60px + env(safe-area-inset-bottom, 0px)));
        --lcp-mobile-keyboard-inset: 0px;
        --lcp-mobile-edge-gap: 10px;
        --lcp-mobile-window-width: 100%;
        --lcp-mobile-focused-window-width: 94%;
        --lcp-mobile-focused-window-height: 76svh;
        position: fixed; bottom: var(--lcp-bottom-offset); right: 24px; z-index: 2147483647;
      }
      @supports (height: 100dvh) {
        #lcp-wrap { --lcp-mobile-viewport-height: 100dvh; }
      }
      #lcp-wrap * { box-sizing: border-box; font-family: var(--lcp-font-family); letter-spacing: 0; }
      #lcp-wrap.lcp-theme-classic { --lcp-font-family: Sora, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #lcp-wrap.lcp-left { right: auto; left: 24px; }
      #lcp-btn {
        width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
        background: var(--lcp-color, #4F46E5); color: #fff;
        box-shadow: 0 10px 28px rgba(0,0,0,.18); display: flex; align-items: center; justify-content: center;
        transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s;
        position: relative;
      }
      #lcp-btn-icon { display: flex; align-items: center; justify-content: center; }
      #lcp-btn-label { display: none; }
      #lcp-btn-icon svg,
      .lcp-avatar svg {
        width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2;
        stroke-linecap: round; stroke-linejoin: round;
      }
      #lcp-btn:hover { transform: scale(1.06); box-shadow: 0 14px 34px rgba(0,0,0,.22); }
      #lcp-btn .lcp-badge {
        position: absolute; top: -4px; right: -4px; background: #ef4444; color: #fff;
        border-radius: 50%; width: 20px; height: 20px; font-size: 11px; font-weight: 600;
        display: flex; align-items: center; justify-content: center; border: 2px solid #fff;
        opacity: 0; transform: scale(0); transition: .2s;
      }
      #lcp-btn .lcp-badge.show { opacity: 1; transform: scale(1); }
      #lcp-window {
        position: absolute; bottom: 76px; right: 0; width: 360px;
        background: var(--lcp-panel-bg); border: 1px solid var(--lcp-border-color); border-radius: var(--lcp-radius); overflow: hidden;
        box-shadow: var(--lcp-shadow); display: none;
        transform: translateY(20px) scale(.95); opacity: 0;
        transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s;
        flex-direction: column; max-height: 520px;
      }
      #lcp-wrap.lcp-left #lcp-window { right: auto; left: 0; }
      #lcp-window.open { display: flex; transform: translateY(0) scale(1); opacity: 1; }
      #lcp-header {
        background: var(--lcp-header-bg); padding: 14px 16px;
        display: flex; align-items: center; gap: 12px; color: var(--lcp-header-color);
        border-bottom: 1px solid var(--lcp-border-color);
      }
      #lcp-close {
        display: none; width: 38px; height: 38px; border: 1px solid var(--lcp-border-color);
        border-radius: 10px; background: var(--lcp-panel-bg); color: var(--lcp-text-color);
        align-items: center; justify-content: center; margin-left: auto; cursor: pointer;
      }
      #lcp-close svg {
        width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2;
        stroke-linecap: round; stroke-linejoin: round;
      }
      .lcp-avatar {
        width: 36px; height: 36px; border-radius: 50%; background: var(--lcp-surface-bg); color: var(--lcp-color, #4F46E5);
        display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;
      }
      .lcp-header-info h4 { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
      .lcp-header-info span { font-size: 12px; color: var(--lcp-muted-color); }
      #lcp-status-dot { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; display: inline-block; margin-right: 5px; }
      #lcp-messages {
        flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;
        background: var(--lcp-surface-bg); min-height: 240px;
      }
      #lcp-messages::-webkit-scrollbar { width: 4px; }
      #lcp-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
      .lcp-msg { max-width: 80%; padding: 10px 14px; border-radius: 16px; font-size: 13.5px; line-height: 1.5; word-break: break-word; }
      .lcp-msg.user { background: var(--lcp-color, #4F46E5); color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
      .lcp-msg.bot, .lcp-msg.admin { background: var(--lcp-panel-bg); color: var(--lcp-text-color); align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.07); }
      .lcp-msg.deleted-attachment { opacity: .68; font-style: italic; }
      .lcp-attachments { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
      .lcp-attachment {
        display: block; overflow: hidden; border-radius: 12px; border: 1px solid rgba(0,0,0,.08);
        background: rgba(255,255,255,.35); text-decoration: none; color: inherit;
      }
      .lcp-attachment img { display: block; width: 100%; max-height: 220px; object-fit: cover; background: #eef2ff; }
      .lcp-attachment span { display: block; padding: 6px 8px; font-size: 11px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .lcp-msg-time { font-size: 10px; opacity: .55; margin-top: 3px; }
      #lcp-typing-indicator { display: none; align-items: center; gap: 4px; padding: 8px 14px; background: var(--lcp-panel-bg); border-radius: 16px; border-bottom-left-radius: 4px; align-self: flex-start; box-shadow: 0 2px 8px rgba(0,0,0,.07); }
      #lcp-typing-indicator span { width: 7px; height: 7px; background: #94a3b8; border-radius: 50%; animation: lcp-bounce .9s infinite; }
      #lcp-typing-indicator span:nth-child(2) { animation-delay: .15s; }
      #lcp-typing-indicator span:nth-child(3) { animation-delay: .3s; }
      @keyframes lcp-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
      #lcp-input-area { padding: 12px 16px; background: var(--lcp-panel-bg); border-top: 1px solid var(--lcp-border-color); display: flex; gap: 8px; }
      #lcp-input {
        flex: 1; border: 1.5px solid var(--lcp-border-color); border-radius: 12px; padding: 10px 14px;
        font-size: 13.5px; outline: none; resize: none; line-height: 1.4; max-height: 80px;
        transition: border-color .2s; background: var(--lcp-input-bg); color: var(--lcp-text-color);
        font-family: var(--lcp-font-family);
      }
      #lcp-input:focus { border-color: var(--lcp-color, #4F46E5); background: #fff; }
      #lcp-attach, #lcp-send {
        width: 42px; height: 42px; border: none; border-radius: 12px; cursor: pointer;
        color: #fff; display: flex; align-items: center; justify-content: center;
        transition: .2s; flex-shrink: 0; align-self: flex-end;
      }
      #lcp-attach { background: var(--lcp-muted-color); }
      #lcp-send { background: var(--lcp-color, #4F46E5); }
      #lcp-attach:disabled, #lcp-send:disabled { opacity: .55; cursor: not-allowed; }
      #lcp-send:hover { opacity: .85; }
      #lcp-attach:hover { opacity: .85; }
      #lcp-attach svg, #lcp-send svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      #lcp-file { display: none; }
      #lcp-powered { text-align: center; font-size: 10px; color: var(--lcp-muted-color); padding: 6px; background: var(--lcp-panel-bg); }
      #lcp-name-banner { display: none; font-size: 12px; background: #ede9fe; color: var(--lcp-color, #4F46E5); padding: 6px 16px; text-align: center; font-weight: 500; }
    `;

    const MOBILE_CHAT_STYLES = `
      #lcp-wrap.lcp-mobile {
        left: max(12px, env(safe-area-inset-left, 0px));
        right: max(12px, env(safe-area-inset-right, 0px));
        bottom: max(12px, calc(12px + env(safe-area-inset-bottom, 0px)));
      }
      #lcp-wrap.lcp-mobile #lcp-btn {
        width: 50px; height: 50px; margin-left: auto;
      }
      #lcp-wrap.lcp-mobile.lcp-left #lcp-btn { margin-left: 0; margin-right: auto; }
      #lcp-wrap.lcp-mobile #lcp-window {
        position: fixed;
        left: max(var(--lcp-mobile-edge-gap), env(safe-area-inset-left, 0px));
        right: max(var(--lcp-mobile-edge-gap), env(safe-area-inset-right, 0px));
        width: auto; top: auto; bottom: var(--lcp-mobile-window-bottom);
        height: var(--lcp-mobile-window-height); max-height: var(--lcp-mobile-window-height); border-radius: 12px;
      }
      #lcp-wrap.lcp-mobile #lcp-header { padding: 12px 14px; }
      #lcp-wrap.lcp-mobile #lcp-messages { min-height: 150px; padding: 12px; }
      #lcp-wrap.lcp-mobile .lcp-msg { max-width: 88%; font-size: 13px; }
      #lcp-wrap.lcp-mobile #lcp-input-area { padding: 10px 12px; gap: 7px; }
      #lcp-wrap.lcp-mobile #lcp-attach,
      #lcp-wrap.lcp-mobile #lcp-send { width: 40px; height: 40px; border-radius: 10px; }
      #lcp-wrap.lcp-mobile #lcp-powered { display: none; }
      #lcp-wrap.lcp-mobile.lcp-mobile-fullscreen #lcp-window {
        top: calc(var(--lcp-visual-top) + max(10px, env(safe-area-inset-top, 0px)));
        bottom: max(10px, env(safe-area-inset-bottom, 0px));
        height: auto; max-height: none; border-radius: 12px;
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-compact #lcp-window {
        bottom: var(--lcp-mobile-window-bottom);
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock {
        left: 0; right: 0; bottom: 0; display: flex; flex-direction: column;
        padding-bottom: env(safe-area-inset-bottom, 0px);
        background: var(--lcp-panel-bg);
        border-top: 1px solid var(--lcp-border-color);
        box-shadow: 0 -10px 28px rgba(0,0,0,.12);
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-window {
        position: fixed;
        top: var(--lcp-visual-top);
        left: 50%;
        right: auto;
        bottom: var(--lcp-mobile-keyboard-inset);
        width: var(--lcp-mobile-window-width);
        height: auto;
        max-height: none;
        border: none; border-radius: 0; box-shadow: none; transform: translateX(-50%);
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock.lcp-input-focused #lcp-window {
        top: auto;
        bottom: calc(var(--lcp-mobile-keyboard-inset) + max(var(--lcp-mobile-edge-gap), env(safe-area-inset-bottom, 0px)));
        width: var(--lcp-mobile-focused-window-width);
        height: var(--lcp-mobile-focused-window-height);
        max-height: var(--lcp-mobile-focused-window-height);
        border: 1px solid var(--lcp-border-color);
        border-radius: 12px;
        box-shadow: var(--lcp-shadow);
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-window.open { transform: translateX(-50%); }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-header {
        flex-shrink: 0; padding: max(12px, env(safe-area-inset-top, 0px)) 14px 12px;
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-close { display: flex; }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-messages {
        flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-input-area {
        flex-shrink: 0; padding-bottom: max(10px, env(safe-area-inset-bottom, 0px));
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-btn {
        width: 100%; height: 54px; margin: 0; border-radius: 0; box-shadow: none;
        background: var(--lcp-panel-bg); color: var(--lcp-text-color);
        border-top: 1px solid var(--lcp-border-color); gap: 10px;
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-btn:hover { transform: none; box-shadow: none; }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-btn-icon { color: var(--lcp-color, #4F46E5); }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-btn-label {
        display: inline; font-size: 14px; font-weight: 600; line-height: 1;
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock #lcp-btn .lcp-badge {
        top: 8px; right: max(16px, env(safe-area-inset-right, 0px));
      }
      #lcp-wrap.lcp-mobile.lcp-mobile-dock.lcp-open #lcp-btn { display: none; }
    `;

    const CHAT_LAYOUT_MODE_STYLES = `
      #lcp-wrap.lcp-persistent { left: 0; right: 0; bottom: 0; }
      #lcp-wrap.lcp-persistent #lcp-btn { width: 100%; border-radius: 0; }
      #lcp-wrap.lcp-persistent #lcp-window { right: 16px; bottom: 68px; }
      #lcp-wrap.lcp-mobile.lcp-persistent #lcp-window { left: 10px; right: 10px; bottom: 58px; }
    
    `;

    const styles = [
      DESKTOP_CHAT_STYLES,
      MOBILE_CHAT_STYLES,
      CHAT_LAYOUT_MODE_STYLES,
    ].join('\n');

    const host = document.createElement('div');
    host.id = 'lcp-host';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    const proxyBtn = document.createElement('button');
    proxyBtn.id = 'lcp-btn';
    proxyBtn.type = 'button';
    proxyBtn.hidden = true;
    proxyBtn.setAttribute('aria-hidden', 'true');
    proxyBtn.addEventListener('click', () => root.getElementById('lcp-btn')?.click());
    document.body.appendChild(proxyBtn);

    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    root.appendChild(styleEl);

    const wrap = document.createElement('div');
    wrap.id = 'lcp-wrap';
    wrap.classList.toggle('lcp-theme-classic', WIDGET_OPTIONS.theme === 'classic');
    wrap.classList.toggle('lcp-left', WIDGET_OPTIONS.position === 'bottom-left');
    wrap.classList.add(`lcp-mobile-${WIDGET_OPTIONS.mobileMode}`);
    wrap.innerHTML = `
      <div id="lcp-window">
        <div id="lcp-header">
          <div class="lcp-avatar">${chatIconSvg}</div>
          <div class="lcp-header-info">
            <h4 id="lcp-agent-name">${uiText.support}</h4>
            <span><span id="lcp-status-dot"></span>${uiText.online}</span>
          </div>
          <button id="lcp-close" type="button" aria-label="Cerrar chat">${closeIconSvg}</button>
        </div>
        <div id="lcp-name-banner"></div>
        <div id="lcp-messages">
          <div id="lcp-typing-indicator"><span></span><span></span><span></span></div>
        </div>
        <div id="lcp-input-area">
          <button id="lcp-attach" type="button" title="${uiText.attach}" aria-label="${uiText.attach}"><svg viewBox="0 0 24 24"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48"/></svg></button>
          <input id="lcp-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
          <textarea id="lcp-input" placeholder="${uiText.placeholder}" rows="1"></textarea>
          <button id="lcp-send" type="button"><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
        </div>
        <div id="lcp-powered">Creado por Wilkin Barban Rosabal</div>
      </div>
      <button id="lcp-btn"><span id="lcp-btn-icon">${chatIconSvg}</span><span id="lcp-btn-label">${uiText.support}</span><div class="lcp-badge" id="lcp-badge">0</div></button>
    `;
    root.appendChild(wrap);
    document.body.appendChild(host);

    const win = root.getElementById('lcp-window');
    const toggleBtn = root.getElementById('lcp-btn');
    const closeBtn = root.getElementById('lcp-close');
    const btnIcon = root.getElementById('lcp-btn-icon');
    const messagesEl = root.getElementById('lcp-messages');
    const inputEl = root.getElementById('lcp-input');
    const sendBtn = root.getElementById('lcp-send');
    const attachBtn = root.getElementById('lcp-attach');
    const fileInput = root.getElementById('lcp-file');
    const typingEl = root.getElementById('lcp-typing-indicator');
    const badge = root.getElementById('lcp-badge');
    const nameBanner = root.getElementById('lcp-name-banner');
    let isOpen = false;
    let unreadCount = 0;
    let adminTypingHideTimer = null;
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxImageBytes = 5 * 1024 * 1024;
    const mobileQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${WIDGET_OPTIONS.mobileBreakpoint}px)`)
      : null;

    function colorParts(value) {
      const match = String(value || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (!match || match[4] === '0') return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    function luminance(rgb) {
      if (!rgb) return 1;
      const [r, g, b] = rgb.map(channel => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function firstUsableColor(...values) {
      return values.find(value => colorParts(value)) || '';
    }

    function readSiteTheme(fallbackColor) {
      const bodyStyle = window.getComputedStyle(document.body);
      const htmlStyle = window.getComputedStyle(document.documentElement);
      const siteBg = firstUsableColor(bodyStyle.backgroundColor, htmlStyle.backgroundColor);
      const siteText = firstUsableColor(bodyStyle.color, htmlStyle.color) || '#18181b';
      const siteAccent = firstUsableColor(bodyStyle.accentColor, htmlStyle.accentColor) || fallbackColor;
      const isDark = luminance(colorParts(siteBg || '#fff')) < 0.35;

      return {
        font: bodyStyle.fontFamily || htmlStyle.fontFamily || 'inherit',
        color: siteAccent,
        panelBg: siteBg || (isDark ? '#18181b' : '#fff'),
        surfaceBg: isDark ? '#27272a' : '#f7f7f8',
        inputBg: isDark ? '#09090b' : '#fff',
        textColor: siteText,
        mutedColor: isDark ? '#a1a1aa' : '#71717a',
        borderColor: isDark ? 'rgba(255,255,255,.12)' : 'rgba(24,24,27,.12)',
        headerBg: siteBg || (isDark ? '#18181b' : '#fff'),
        headerColor: siteText,
        shadow: isDark ? '0 18px 48px rgba(0,0,0,.42)' : '0 18px 48px rgba(0,0,0,.14)',
      };
    }

    function applyTheme(color) {
      const theme = WIDGET_OPTIONS.theme === 'auto' ? readSiteTheme(color) : {
        font: 'Sora, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color,
        panelBg: '#fff',
        surfaceBg: '#f8f7ff',
        inputBg: '#fafafa',
        textColor: '#1a1a2e',
        mutedColor: '#64748b',
        borderColor: 'rgba(79,70,229,.12)',
        headerBg: color,
        headerColor: '#fff',
        shadow: '0 24px 80px rgba(0,0,0,.18)',
      };
      wrap.style.setProperty('--lcp-font-family', theme.font);
      wrap.style.setProperty('--lcp-color', theme.color);
      wrap.style.setProperty('--lcp-panel-bg', theme.panelBg);
      wrap.style.setProperty('--lcp-surface-bg', theme.surfaceBg);
      wrap.style.setProperty('--lcp-input-bg', theme.inputBg);
      wrap.style.setProperty('--lcp-text-color', theme.textColor);
      wrap.style.setProperty('--lcp-muted-color', theme.mutedColor);
      wrap.style.setProperty('--lcp-border-color', theme.borderColor);
      wrap.style.setProperty('--lcp-header-bg', theme.headerBg);
      wrap.style.setProperty('--lcp-header-color', theme.headerColor);
      wrap.style.setProperty('--lcp-shadow', theme.shadow);
    }

    function isMobileViewport() {
      if (mobileQuery) return mobileQuery.matches;
      return window.innerWidth <= WIDGET_OPTIONS.mobileBreakpoint;
    }

    function updateViewportMetrics() {
      const visualViewport = window.visualViewport;
      const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 600);
      const viewportTop = Math.round(visualViewport?.offsetTop || 0);
      const layoutHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || viewportHeight);
      const keyboardInset = Math.max(0, layoutHeight - viewportHeight - viewportTop);
      const inputFocused = document.activeElement === inputEl || root.activeElement === inputEl;
      const edgeGap = inputFocused ? 10 : 0;
      const bottomReserve = WIDGET_OPTIONS.mobileMode === 'dock' ? 54 : WIDGET_OPTIONS.mobileMode === 'compact' ? 68 : 76;
      const edgeReserve = WIDGET_OPTIONS.mobileMode === 'dock'
        ? (inputFocused ? 20 : 8)
        : (inputFocused ? 28 : 20);
      const availableHeight = Math.max(220, viewportHeight - bottomReserve - edgeReserve);
      const focusedAvailableHeight = Math.max(220, viewportHeight - keyboardInset - (edgeGap * 2));
      const configuredFocusedHeight = Math.round(viewportHeight * (WIDGET_OPTIONS.mobileFocusedHeight / 100));
      const modeLimit = WIDGET_OPTIONS.mobileMode === 'dock' ? 420 : WIDGET_OPTIONS.mobileMode === 'compact' ? 380 : 500;
      const focusedLimit = WIDGET_OPTIONS.mobileMode === 'dock' ? 360 : 440;
      const effectiveLimit = inputFocused ? Math.min(modeLimit, focusedLimit) : modeLimit;
      const windowHeight = WIDGET_OPTIONS.mobileMode === 'fullscreen'
        ? availableHeight
        : Math.min(effectiveLimit, availableHeight);
      const focusedWindowHeight = Math.min(configuredFocusedHeight, focusedAvailableHeight);

      wrap.classList.toggle('lcp-input-focused', inputFocused);
      wrap.style.setProperty('--lcp-visual-top', `${viewportTop}px`);
      wrap.style.setProperty('--lcp-mobile-viewport-height', `${viewportHeight}px`);
      wrap.style.setProperty('--lcp-mobile-window-bottom', `${bottomReserve + keyboardInset}px`);
      wrap.style.setProperty('--lcp-mobile-window-height', `${windowHeight}px`);
      wrap.style.setProperty('--lcp-mobile-keyboard-inset', `${keyboardInset}px`);
      wrap.style.setProperty('--lcp-mobile-edge-gap', `${edgeGap}px`);
      wrap.style.setProperty('--lcp-mobile-window-width', `${WIDGET_OPTIONS.mobileWidth}%`);
      wrap.style.setProperty('--lcp-mobile-focused-window-width', `${WIDGET_OPTIONS.mobileFocusedWidth}%`);
      wrap.style.setProperty('--lcp-mobile-focused-window-height', `${focusedWindowHeight}px`);
    }

    function updateResponsiveMode() {
      updateViewportMetrics();
      wrap.classList.toggle('lcp-mobile', isMobileViewport());
      scrollBottom();
    }

    updateResponsiveMode();
    applyTheme(primaryColor);
    if (mobileQuery?.addEventListener) mobileQuery.addEventListener('change', updateResponsiveMode);
    else if (mobileQuery?.addListener) mobileQuery.addListener(updateResponsiveMode);
    else window.addEventListener('resize', updateResponsiveMode);
    window.addEventListener('resize', updateViewportMetrics);
    window.addEventListener('orientationchange', updateResponsiveMode);
    window.visualViewport?.addEventListener('resize', updateViewportMetrics);
    window.visualViewport?.addEventListener('scroll', updateViewportMetrics);

    function scrollBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleTimeString(WIDGET_LOCALE, { hour: '2-digit', minute: '2-digit' });
    }

    function attachmentHtml(attachments) {
      if (!attachments || !attachments.length) return '';
      return `<div class="lcp-attachments">${attachments.map(attachment => {
        const url = `${SERVER_URL}${attachment.url}`;
        return `
        <a class="lcp-attachment" href="${url}" target="_blank" rel="noopener" ${attachment.width && attachment.height ? `style="aspect-ratio:${attachment.width}/${attachment.height}"` : ''}>
          <img src="${url}" alt="${escapeHtml(attachment.originalName || 'imagen')}">
          <span>${escapeHtml(attachment.originalName || 'imagen')}</span>
        </a>`;
      }).join('')}</div>`;
    }

    function addMessage(msg) {
      const div = document.createElement('div');
      div.classList.add('lcp-msg', msg.from);
      if (msg.id) div.dataset.messageId = String(msg.id);
      const text = msg.text ? escapeHtml(msg.text) : '';
      div.innerHTML = `${text}${attachmentHtml(msg.attachments)}<div class="lcp-msg-time">${formatTime(msg.ts)}</div>`;
      messagesEl.insertBefore(div, typingEl);
      scrollBottom();
    }

    function showLocalError(message) {
      addMessage({ from: 'bot', text: message, ts: Date.now() });
    }

    function uploadWithProgress(url, form, headers, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.withCredentials = true;
        Object.entries(headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        xhr.upload.onprogress = event => {
          if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch { }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || uiText.uploadError));
        };
        xhr.onerror = () => reject(new Error(uiText.uploadError));
        xhr.send(form);
      });
    }

    function emitRead(ts = Date.now()) {
      socket.emit('read', { ts });
    }

    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }

    // ── Toggle ──────────────────────────────────────────────
    toggleBtn.addEventListener('click', () => {
      isOpen = !isOpen;
      updateViewportMetrics();
      win.classList.toggle('open', isOpen);
      wrap.classList.toggle('lcp-open', isOpen);
      btnIcon.innerHTML = isOpen ? closeIconSvg : chatIconSvg;
      if (isOpen) { unreadCount = 0; badge.textContent = '0'; badge.classList.remove('show'); inputEl.focus(); scrollBottom(); }
    });
    closeBtn.addEventListener('click', () => {
      if (!isOpen) return;
      isOpen = false;
      win.classList.remove('open');
      wrap.classList.remove('lcp-open');
      btnIcon.innerHTML = chatIconSvg;
    });

    // ── Send message ────────────────────────────────────────
    function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;
      socket.emit('message', { text });
      inputEl.value = '';
      inputEl.style.height = 'auto';
    }

    sendBtn.addEventListener('click', sendMessage);
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!allowedImageTypes.includes(file.type)) return showLocalError(uiText.fileTypeError);
      if (file.size > maxImageBytes) return showLocalError(uiText.fileTooLarge);

      const form = new FormData();
      form.set('image', file);
      const caption = inputEl.value.trim();
      if (caption) form.set('text', caption);

      attachBtn.disabled = true;
      sendBtn.disabled = true;
      const originalTitle = attachBtn.title;
      try {
        await uploadWithProgress(`${SERVER_URL}/api/chat/${encodeURIComponent(sessionId)}/attachments`, form, {
          ...(API_KEY ? { 'x-widget-api-key': API_KEY } : {}),
          'x-chat-session-id': sessionId,
        }, progress => {
          attachBtn.title = `${uiText.attach} ${progress}%`;
        });
        inputEl.value = '';
        inputEl.style.height = 'auto';
      } catch (error) {
        showLocalError(error.message || uiText.uploadError);
      } finally {
        attachBtn.title = originalTitle;
        attachBtn.disabled = false;
        sendBtn.disabled = false;
      }
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    inputEl.addEventListener('focus', () => {
      updateViewportMetrics();
      setTimeout(updateViewportMetrics, 80);
      setTimeout(updateViewportMetrics, 260);
    });
    inputEl.addEventListener('blur', () => {
      updateViewportMetrics();
      setTimeout(updateViewportMetrics, 80);
      setTimeout(updateViewportMetrics, 260);
    });

    // ── Typing indicator to server ──────────────────────────
    let typingTimer;
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
      clearTimeout(typingTimer);
      if (inputEl.value.trim()) {
        socket.emit('typing', inputEl.value);
        typingTimer = setTimeout(() => socket.emit('typing', ''), 3000);
      }
    });

    // ── Socket events ────────────────────────────────────────
    socket.on('session', ({ sessionId: sid, history, name, config: cfg }) => {
      localStorage.setItem('lchat_sid', sid);
      document.cookie = `lchat_sid=${sid};path=/;max-age=31536000`;
      if (cfg?.primaryColor) applyTheme(cfg.primaryColor);
      if (name) { nameBanner.textContent = uiText.greeting(name); nameBanner.style.display = 'block'; }
      if (history && history.length) {
        history.forEach(addMessage);
        const lastAgentMsg = [...history].reverse().find(m => m.from === 'admin' || m.from === 'bot');
        if (lastAgentMsg) emitRead(lastAgentMsg.ts);
      }
    });

    socket.on('message', (msg) => {
      addMessage(msg);
      if (!isOpen && msg.from !== 'user') {
        unreadCount++;
        badge.textContent = unreadCount;
        badge.classList.add('show');
      }
      if (msg.from === 'admin' || msg.from === 'bot') emitRead(msg.ts || Date.now());
      typingEl.style.display = 'none';
    });

    socket.on('attachment:deleted', ({ messageId }) => {
      const messageEl = messagesEl.querySelector(`[data-message-id="${String(messageId)}"]`);
      if (!messageEl) return;
      const attachments = messageEl.querySelector('.lcp-attachments');
      if (attachments) attachments.remove();
      if (!messageEl.textContent.trim()) messageEl.classList.add('deleted-attachment');
      if (!messageEl.querySelector('.lcp-deleted-note')) {
        const note = document.createElement('span');
        note.className = 'lcp-deleted-note';
        note.textContent = uiText.attachmentDeleted;
        messageEl.insertBefore(note, messageEl.querySelector('.lcp-msg-time'));
      }
    });

    socket.on('chat:cleared', () => {
      messagesEl.innerHTML = '';
      typingEl.style.display = 'none';
      unreadCount = 0;
      badge.classList.remove('show');
    });

    socket.on('chat:deleted', () => {
      localStorage.removeItem('lchat_sid');
      document.cookie = 'lchat_sid=;path=/;max-age=0';
      win.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b;font-family:inherit;"><b>${uiText.support}</b></div>`;
    });

    socket.on('name_set', ({ name }) => {
      nameBanner.textContent = uiText.greeting(name);
      nameBanner.style.display = 'block';
    });

    socket.on('typing_admin', (payload = { active: true }) => {
      if (payload.active === false) {
        typingEl.style.display = 'none';
        return;
      }

      typingEl.style.display = 'flex';
      scrollBottom();
      clearTimeout(adminTypingHideTimer);
      adminTypingHideTimer = setTimeout(() => {
        typingEl.style.display = 'none';
      }, 3000);
    });

    socket.on('banned', () => {
      win.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;font-family:inherit;"><b>${uiText.banned}</b></div>`;
    });

    socket.connect();
    socket.emit('page', window.location.pathname);
  }
})();
