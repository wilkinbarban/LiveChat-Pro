#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = __dirname;
const ENV_PATH = process.env.LIVECHAT_ENV_PATH || path.join(ROOT, '.env');
const LEGACY_CONFIG_PATH = path.join(ROOT, 'config.json');
const SCRIPTED_INPUT = process.stdin.isTTY ? null : fs.readFileSync(0, 'utf8').split(/\r?\n/);
let rl = SCRIPTED_INPUT ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
const REQUIRED_NODE_MAJOR = 20;
let sudoValidated = false;

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

const color = (name, text) => `${COLORS[name]}${text}${COLORS.reset}`;
const quoteEnv = value => JSON.stringify(String(value ?? ''));
const shouldRunSystemChecks = process.env.LIVECHAT_SKIP_SYSTEM_CHECKS !== '1';
const ask = question => {
  if (SCRIPTED_INPUT) {
    process.stdout.write(question);
    return Promise.resolve((SCRIPTED_INPUT.shift() || '').trim());
  }
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
};

function closeReadlineForInteractiveCommand() {
  if (!rl) return false;
  rl.close();
  rl = null;
  return true;
}

const COLOR_OPTIONS = [
  { key: '1', name: 'Índigo profesional', value: '#4F46E5' },
  { key: '2', name: 'Azul soporte', value: '#2563EB' },
  { key: '3', name: 'Verde confianza', value: '#059669' },
  { key: '4', name: 'Rojo terracota', value: '#BA4A2F' },
  { key: '5', name: 'Gris elegante', value: '#334155' },
  { key: '6', name: 'Personalizado', value: '' },
];

const ADMIN_LANGUAGES = [
  { key: '1', code: 'es', name: 'Español' },
  { key: '2', code: 'en', name: 'Inglés' },
  { key: '3', code: 'pt', name: 'Portugués' },
  { key: '4', code: 'fr', name: 'Francés' },
  { key: '5', code: 'de', name: 'Alemán' },
  { key: '6', code: 'it', name: 'Italiano' },
];

const TRANSLATION_PROVIDERS = [
  { key: '1', code: 'google_free', name: 'Google gratuito (fallback, sin API key)' },
  { key: '2', code: 'deepl', name: 'DeepL oficial' },
  { key: '3', code: 'google_cloud', name: 'Google Cloud Translation oficial' },
];

function header() {
  if (!process.env.LIVECHAT_SETUP_NO_CLEAR) console.clear();
  console.log(color('cyan', '╔════════════════════════════════════════════════════╗'));
  console.log(color('cyan', '║') + color('bright', '        LiveChat Pro — Instalador guiado          ') + color('cyan', '║'));
  console.log(color('cyan', '╚════════════════════════════════════════════════════╝'));
  console.log('');
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const rawValue = match[2].trim();
    env[match[1]] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return env;
}

function readLegacyDefaults() {
  if (!fs.existsSync(LEGACY_CONFIG_PATH)) return {};
  try {
    const old = JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, 'utf8'));
    return {
      TELEGRAM_TOKEN: old.telegram?.token,
      TELEGRAM_ADMIN_ID: old.telegram?.adminId,
      PORT: old.server?.port,
      HOST_PORT: old.server?.hostPort,
      WIDGET_BUTTON_STYLE: old.widget?.buttonStyle,
      WIDGET_PRIMARY_COLOR: old.widget?.primaryColor,
      WIDGET_WELCOME_MESSAGE: old.widget?.welcomeMessage,
      ADMIN_PANEL_PASSWORD: old.admin?.panelPassword,
      ADMIN_LANGUAGE: old.admin?.language,
    };
  } catch {
    return {};
  }
}

function mergeDefaults() {
  return {
    ...readLegacyDefaults(),
    ...parseEnvFile(ENV_PATH),
  };
}

function maskSecret(value) {
  if (!value) return '';
  return `${String(value).slice(0, 8)}...`;
}

function isValidHexColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

async function askRequired(label, current, validator, help) {
  while (true) {
    const suffix = current ? ` [${current}]` : '';
    const value = await ask(color('yellow', `${label}${suffix}: `)) || current || '';
    if (!validator || validator(value)) return value;
    console.log(color('red', `  Valor inválido. ${help}`));
  }
}

async function askSecret(label, current, validator, help) {
  while (true) {
    const suffix = current ? ` [${maskSecret(current)}]` : '';
    const value = await ask(color('yellow', `${label}${suffix}: `)) || current || '';
    if (!validator || validator(value)) return value;
    console.log(color('red', `  Valor inválido. ${help}`));
  }
}

async function choose(label, options, currentValue) {
  console.log('\n' + color('blue', label));
  for (const option of options) {
    const marker = option.value === currentValue || option.code === currentValue ? '  ← actual' : '';
    console.log(`   [${option.key}] ${option.name}${option.value ? ` (${option.value})` : option.code ? ` (${option.code})` : ''}${marker}`);
  }
  const answer = await ask(color('yellow', '   Elige una opción: '));
  return options.find(option => option.key === answer) || options.find(option => option.value === currentValue || option.code === currentValue) || options[0];
}

async function chooseYesNo(label, defaultValue = true) {
  const hint = defaultValue ? 'S/n' : 's/N';
  const answer = (await ask(color('yellow', `${label} [${hint}]: `))).toLowerCase();
  if (!answer) return defaultValue;
  return ['s', 'si', 'sí', 'y', 'yes'].includes(answer);
}

function randomPassword() {
  return Array.from(cryptoRandomBytes(18), byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.charAt(byte % 64)).join('');
}

function cryptoRandomBytes(size) {
  return require('crypto').randomBytes(size);
}

function buildEnv(config) {
  return [
    '# ============================================================',
    '# LiveChat Pro — generado por setup.js',
    '# NO subas este archivo a git',
    '# ============================================================',
    '',
    '# Telegram',
    `TELEGRAM_TOKEN=${quoteEnv(config.telegramToken)}`,
    `TELEGRAM_ADMIN_ID=${quoteEnv(config.telegramAdminId)}`,
    '',
    '# Servidor',
    `PORT=${quoteEnv(config.port)}`,
    `HOST_PORT=${quoteEnv(config.hostPort)}`,
    `ALLOWED_ORIGINS=${quoteEnv(config.allowedOrigins)}`,
    `ADMIN_PANEL_PASSWORD=${quoteEnv(config.adminPassword)}`,
    `ADMIN_LANGUAGE=${quoteEnv(config.adminLanguage)}`,
    `ADMIN_SESSION_TTL_HOURS=${quoteEnv(config.adminSessionTtlHours)}`,
    `LOG_LEVEL=${quoteEnv(config.logLevel)}`,
    `TRUST_PROXY_HOPS=${quoteEnv(config.trustProxyHops)}`,
    `TELEGRAM_LAUNCH_TIMEOUT_MS=${quoteEnv(config.telegramLaunchTimeoutMs)}`,
    `COOKIE_SAME_SITE=${quoteEnv(config.cookieSameSite)}`,
    '',
    '# Widget',
    `WIDGET_BUTTON_STYLE=${quoteEnv(config.widgetButtonStyle)}`,
    `WIDGET_PRIMARY_COLOR=${quoteEnv(config.widgetPrimaryColor)}`,
    `WIDGET_WELCOME_MESSAGE=${quoteEnv(config.widgetWelcomeMessage)}`,
    `WIDGET_API_KEY=${quoteEnv(config.widgetApiKey)}`,
    '',
    '# Funciones (true/false)',
    `FEATURE_TRANSLATION=${quoteEnv(config.featureTranslation)}`,
    `FEATURE_SENTIMENT=${quoteEnv(config.featureSentiment)}`,
    `FEATURE_GHOST_TYPING=${quoteEnv(config.featureGhostTyping)}`,
    `FEATURE_GEOLOCATION=${quoteEnv(config.featureGeoLocation)}`,
    '',
    '# Traducción',
    `TRANSLATION_PROVIDER=${quoteEnv(config.translationProvider)}`,
    `TRANSLATION_API_KEY=${quoteEnv(config.translationApiKey)}`,
    `DEEPL_API_URL=${quoteEnv(config.deeplApiUrl)}`,
    '',
    '# Rate limiting',
    `RATE_LIMIT_WINDOW_MINUTES=${quoteEnv(config.rateLimitWindowMinutes)}`,
    `RATE_LIMIT_PUBLIC_MAX=${quoteEnv(config.rateLimitPublicMax)}`,
    `RATE_LIMIT_ADMIN_MAX=${quoteEnv(config.rateLimitAdminMax)}`,
    `RATE_LIMIT_LOGIN_MAX=${quoteEnv(config.rateLimitLoginMax)}`,
    `RATE_LIMIT_UPLOAD_WINDOW_MINUTES=${quoteEnv(config.rateLimitUploadWindowMinutes)}`,
    `RATE_LIMIT_UPLOAD_MAX=${quoteEnv(config.rateLimitUploadMax)}`,
    '',
    '# Adjuntos de imagen',
    `MAX_UPLOAD_MB=${quoteEnv(config.maxUploadMb)}`,
    `UPLOAD_DIR=${quoteEnv(config.uploadDir)}`,
    `ALLOWED_IMAGE_TYPES=${quoteEnv(config.allowedImageTypes)}`,
    '',
    '# Redis (opcional, recomendado para multi-nodo)',
    `REDIS_URL=${quoteEnv(config.redisUrl)}`,
    `REDIS_KEY_PREFIX=${quoteEnv(config.redisKeyPrefix)}`,
    '',
  ].join('\n');
}

function commandExists(command) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  return paths.some(dir => fs.existsSync(path.join(dir, command)));
}

function executableExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', code => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

function runInteractiveCommand(command, args) {
  const hadReadline = closeReadlineForInteractiveCommand();
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    const finish = code => {
      if (hadReadline && process.stdin.isTTY && !rl) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      }
      resolve(code || 0);
    };
    child.on('exit', finish);
    child.on('error', () => finish(1));
  });
}

function runShell(command) {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-lc', command], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', code => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

async function ensureSudoAccess() {
  if (!process.getuid || process.getuid() === 0 || sudoValidated) return true;
  if (!commandExists('sudo')) {
    console.log(color('red', 'No encontré sudo. Ejecuta setup.js como root o instala sudo para preparar el VPS.'));
    return false;
  }

  console.log(color('yellow', 'Se validará sudo para instalar paquetes y abrir puertos.'));
  const cachedCode = await runCommand('sudo', ['-n', '-v']);
  if (cachedCode === 0) {
    sudoValidated = true;
    return true;
  }

  if (!process.stdin.isTTY) {
    console.log(color('red', 'No se pudo validar sudo sin interacción. Ejecuta el setup desde una terminal, ejecuta primero `sudo -v`, o usa LIVECHAT_SKIP_SYSTEM_CHECKS=1 si solo quieres generar .env.'));
    return false;
  }

  console.log(color('yellow', 'Introduce tu contraseña sudo si el sistema la solicita.'));
  const code = await runInteractiveCommand('sudo', ['-v']);
  if (code !== 0) {
    console.log(color('red', 'No se pudo validar sudo. Revisa la contraseña o confirma que tu usuario pertenece al grupo sudo/wheel.'));
    console.log(color('yellow', 'También puedes ejecutar el instalador como root o preparar Node.js/Docker/firewall manualmente y volver a lanzar setup.js.'));
    return false;
  }

  sudoValidated = true;
  return true;
}

function captureShell(command) {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-lc', command], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => resolve({ code: code || 0, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', error => resolve({ code: 1, stdout: '', stderr: error.message }));
  });
}

function parseOsRelease() {
  const filePath = '/etc/os-release';
  if (!fs.existsSync(filePath)) return { id: process.platform, idLike: '', prettyName: process.platform };
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return {
    id: (values.ID || '').toLowerCase(),
    idLike: (values.ID_LIKE || '').toLowerCase(),
    prettyName: values.PRETTY_NAME || values.NAME || 'Linux',
  };
}

function sudoPrefix() {
  if (process.getuid && process.getuid() === 0) return '';
  return process.stdin.isTTY ? 'sudo ' : 'sudo -n ';
}

function hasSystemd() {
  return commandExists('systemctl') && fs.existsSync('/run/systemd/system');
}

function dockerInstallCommand(osInfo) {
  const sudo = sudoPrefix();
  const id = osInfo.id;
  const like = osInfo.idLike;

  if (id === 'ubuntu' || id === 'debian' || like.includes('debian')) {
    const repoId = id === 'debian' ? 'debian' : 'ubuntu';
    const codenameExpr = '. /etc/os-release && echo "${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"';
    return [
      `${sudo}apt-get update`,
      `${sudo}apt-get install -y ca-certificates curl gnupg`,
      `${sudo}install -m 0755 -d /etc/apt/keyrings`,
      `curl -fsSL https://download.docker.com/linux/${repoId}/gpg | ${sudo}gpg --dearmor -o /etc/apt/keyrings/docker.gpg`,
      `${sudo}chmod a+r /etc/apt/keyrings/docker.gpg`,
      `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${repoId} $(${codenameExpr}) stable" | ${sudo}tee /etc/apt/sources.list.d/docker.list > /dev/null`,
      `${sudo}apt-get update`,
      `${sudo}apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`,
    ].join(' && ');
  }

  if (id === 'fedora') {
    return [
      `${sudo}dnf -y install dnf-plugins-core`,
      `${sudo}dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo`,
      `${sudo}dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`,
    ].join(' && ');
  }

  if (['centos', 'rhel', 'rocky', 'almalinux'].includes(id) || like.includes('rhel')) {
    const pkg = commandExists('dnf') ? 'dnf' : 'yum';
    return [
      `${sudo}${pkg} -y install ${pkg === 'dnf' ? 'dnf-plugins-core' : 'yum-utils'}`,
      `${sudo}${pkg} config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo`,
      `${sudo}${pkg} -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`,
    ].join(' && ');
  }

  if (id === 'arch' || like.includes('arch')) return `${sudo}pacman -Sy --noconfirm docker docker-compose`;
  if (id === 'alpine') return `${sudo}apk add --no-cache docker docker-cli-compose`;
  return '';
}

function parseNodeMajor(versionText) {
  const match = String(versionText || '').match(/v?(\d+)\./);
  return match ? Number(match[1]) : 0;
}

async function getSystemNodeInfo() {
  const resolved = await captureShell('command -v node 2>/dev/null && node --version');
  if (resolved.code !== 0 || !resolved.stdout) return null;
  const lines = resolved.stdout.split(/\r?\n/).filter(Boolean);
  const binary = lines[0] || '';
  const version = lines[1] || '';
  const realpath = await captureShell(`realpath "${binary}" 2>/dev/null || readlink -f "${binary}" 2>/dev/null || echo "${binary}"`);
  const location = realpath.stdout || binary;
  const localRoot = path.join(ROOT, '.local');
  const isProjectLocal = location === path.join(ROOT, 'node-local') || location.startsWith(`${localRoot}${path.sep}`);
  return {
    binary,
    location,
    version,
    major: parseNodeMajor(version),
    isProjectLocal,
  };
}

function nodeInstallCommand(osInfo) {
  const sudo = sudoPrefix();
  const id = osInfo.id;
  const like = osInfo.idLike;

  if (id === 'ubuntu' || id === 'debian' || like.includes('debian')) {
    return [
      `${sudo}apt-get update`,
      `${sudo}apt-get install -y ca-certificates curl gnupg`,
      `curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | ${sudo}bash -`,
      `${sudo}apt-get install -y nodejs`,
    ].join(' && ');
  }

  if (id === 'fedora') return `${sudo}dnf -y install nodejs npm`;

  if (['centos', 'rhel', 'rocky', 'almalinux'].includes(id) || like.includes('rhel')) {
    const pkg = commandExists('dnf') ? 'dnf' : 'yum';
    return [
      `${sudo}${pkg} -y module reset nodejs || true`,
      `${sudo}${pkg} -y module enable nodejs:${REQUIRED_NODE_MAJOR} || true`,
      `${sudo}${pkg} -y install nodejs npm`,
    ].join(' && ');
  }

  if (id === 'arch' || like.includes('arch')) return `${sudo}pacman -Sy --noconfirm nodejs npm`;
  if (id === 'alpine') return `${sudo}apk add --no-cache nodejs npm`;
  return '';
}

async function ensureSystemNode(osInfo) {
  const nodeInfo = await getSystemNodeInfo();
  if (nodeInfo && !nodeInfo.isProjectLocal && nodeInfo.major >= REQUIRED_NODE_MAJOR) {
    console.log(color('green', `✓ Node.js del sistema detectado: ${nodeInfo.version} (${nodeInfo.location})`));
    return true;
  }

  if (nodeInfo?.isProjectLocal) {
    console.log(color('yellow', `⚠ Detecté Node del proyecto (${nodeInfo.location}); se ignorará para preparar el VPS.`));
  } else if (nodeInfo) {
    console.log(color('yellow', `⚠ Node.js del sistema es antiguo: ${nodeInfo.version}. Se requiere >= ${REQUIRED_NODE_MAJOR}.`));
  } else {
    console.log(color('yellow', 'Node.js del sistema no está instalado.'));
  }

  const installCommand = nodeInstallCommand(osInfo);
  if (!installCommand) {
    console.log(color('red', `No tengo receta automática para instalar Node.js en ${osInfo.prettyName}.`));
    return false;
  }
  if (!(await ensureSudoAccess())) return false;

  const installCode = await runShell(installCommand);
  if (installCode !== 0) {
    console.log(color('red', 'La instalación de Node.js falló. Revisa la salida anterior.'));
    return false;
  }

  const installed = await getSystemNodeInfo();
  const ok = installed && !installed.isProjectLocal && installed.major >= REQUIRED_NODE_MAJOR;
  console.log(ok
    ? color('green', `✓ Node.js instalado y verificado: ${installed.version} (${installed.location})`)
    : color('red', `Node.js no quedó verificado con versión >= ${REQUIRED_NODE_MAJOR}.`));
  return ok;
}

async function ensureDocker(osInfo) {
  if (commandExists('docker')) {
    const dockerVersion = await captureShell('docker --version');
    const composeVersion = await captureShell('docker compose version');
    console.log(color('green', `✓ Docker detectado: ${dockerVersion.stdout || 'docker instalado'}`));
    console.log(composeVersion.code === 0
      ? color('green', `✓ Docker Compose detectado: ${composeVersion.stdout}`)
      : color('yellow', '⚠ Docker está instalado, pero no detecté el plugin docker compose.'));
    return composeVersion.code === 0;
  }

  console.log(color('yellow', 'Docker no está instalado. Intentaré instalar Docker Engine desde el repositorio oficial cuando la distro lo soporte.'));
  const installCommand = dockerInstallCommand(osInfo);
  if (!installCommand) {
    console.log(color('red', `No tengo receta automática para instalar Docker en ${osInfo.prettyName}.`));
    console.log('Instala Docker manualmente y vuelve a ejecutar setup.js.');
    return false;
  }
  if (!(await ensureSudoAccess())) return false;

  const installCode = await runShell(installCommand);
  if (installCode !== 0) {
    console.log(color('red', 'La instalación de Docker falló. Revisa la salida anterior.'));
    return false;
  }

  const sudo = sudoPrefix();
  if (hasSystemd()) await runShell(`${sudo}systemctl enable --now docker`);
  else if (commandExists('service')) await runShell(`${sudo}service docker start`);

  const dockerVersion = await captureShell('docker --version');
  const composeVersion = await captureShell('docker compose version');
  const ok = dockerVersion.code === 0 && composeVersion.code === 0;
  console.log(ok
    ? color('green', `✓ Docker instalado y verificado: ${dockerVersion.stdout}; ${composeVersion.stdout}`)
    : color('red', 'Docker se instaló, pero la verificación no pasó.'));
  return ok;
}

async function checkPortListening(port) {
  const ss = await captureShell(`ss -ltn 2>/dev/null | awk '{print $4}' | grep -E '(^|:)${port}$'`);
  if (ss.code === 0 && ss.stdout) return true;
  const netstat = await captureShell(`netstat -ltn 2>/dev/null | awk '{print $4}' | grep -E '(^|:)${port}$'`);
  return netstat.code === 0 && !!netstat.stdout;
}

async function openFirewallPorts() {
  console.log('\n' + color('bright', 'Firewall y puertos públicos'));
  const publicPort = 8080;
  const publicPortRule = `${publicPort}/tcp`;
  for (const port of [publicPort]) {
    const busy = await checkPortListening(port);
    console.log(busy
      ? color('yellow', `⚠ El puerto ${port} ya está siendo usado por otro proceso.`)
      : color('green', `✓ El puerto ${port} parece disponible.`));
  }

  const sudo = sudoPrefix();
  if (commandExists('ufw')) {
    if (!(await ensureSudoAccess())) return;
    await runShell(`${sudo}ufw allow ${publicPortRule}`);
    console.log(color('green', `✓ Regla UFW aplicada para ${publicPortRule}.`));
    return;
  }

  const firewalldState = await captureShell('firewall-cmd --state 2>/dev/null');
  if (commandExists('firewall-cmd') && firewalldState.code === 0) {
    if (!(await ensureSudoAccess())) return;
    await runShell(`${sudo}firewall-cmd --permanent --add-port=${publicPortRule} && ${sudo}firewall-cmd --reload`);
    console.log(color('green', `✓ Regla firewalld aplicada para ${publicPortRule}.`));
    return;
  }

  console.log(color('yellow', `⚠ No detecté UFW ni firewalld activo. Si tu VPS usa firewall cloud, abre ${publicPortRule} en el panel del proveedor.`));
}

async function preflightSystem() {
  if (!shouldRunSystemChecks) {
    console.log(color('yellow', 'Checks de sistema omitidos por LIVECHAT_SKIP_SYSTEM_CHECKS=1.'));
    return;
  }

  console.log(color('bright', 'Validación del entorno VPS'));
  const osInfo = parseOsRelease();
  console.log(color('blue', `Sistema detectado: ${osInfo.prettyName}`));
  await ensureSystemNode(osInfo);
  await ensureDocker(osInfo);
  await openFirewallPorts();
  console.log(fs.existsSync(path.join(ROOT, 'package-lock.json'))
    ? color('green', '✓ package-lock.json presente.')
    : color('yellow', '⚠ No encontré package-lock.json; npm ci no será reproducible.'));
}

function normalizeOrigins(input) {
  const value = String(input || '').trim();
  if (!value || value === '*') return '*';
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => /^https?:\/\//i.test(item) ? item : `https://${item}`)
    .join(',');
}

function publicBaseUrl(allowedOrigins, port) {
  const firstOrigin = String(allowedOrigins || '')
    .split(',')
    .map(item => item.trim())
    .find(item => item && item !== '*');
  if (firstOrigin) {
    const cleanOrigin = firstOrigin.replace(/\/+$/, '');
    try {
      const url = new URL(cleanOrigin);
      const needsPort = Number(port) && !['80', '443'].includes(String(port)) && !url.port;
      if (needsPort) url.port = String(port);
      return url.toString().replace(/\/+$/, '');
    } catch {
      return cleanOrigin;
    }
  }
  return `http://localhost:${port}`;
}

async function detectPublicIp() {
  const fromEnv = String(process.env.LIVECHAT_PUBLIC_IP || '').trim();
  if (fromEnv) return fromEnv;

  for (const command of [
    'curl -fsS --max-time 4 https://api.ipify.org',
    'curl -fsS --max-time 4 https://ifconfig.me/ip',
    "hostname -I 2>/dev/null | awk '{print $1}'",
  ]) {
    const result = await captureShell(command);
    const candidate = result.stdout.trim();
    if (result.code === 0 && /^(\d{1,3}\.){3}\d{1,3}$/.test(candidate)) return candidate;
  }
  return '';
}

function publicOriginFromDomainOrIp(input, publicIp) {
  const value = String(input || '').trim();
  if (value) return normalizeOrigins(value);
  return publicIp ? `http://${publicIp}` : '*';
}

function widgetSnippet(baseUrl, apiKey) {
  const keyAttr = apiKey ? ` data-api-key="${apiKey.replace(/"/g, '&quot;')}"` : '';
  return `<script src="${baseUrl}/widget.js" data-server="${baseUrl}"${keyAttr}></script>`;
}

function hiddenWidgetOpenSnippet() {
  return '<button type="button" onclick="document.getElementById(\'lcp-btn\')?.click()">Abrir chat</button>';
}

async function chooseDeploymentProfile() {
  console.log('\n' + color('blue', 'Perfil de despliegue'));
  console.log('   [1] VPS público con Docker (recomendado: HOST_PORT=8080, deja 80/443 libres)');
  console.log('   [2] Desarrollo/local o puerto personalizado');
  const choice = await ask(color('yellow', '   Elige una opción [1]: '));
  return choice === '2' ? 'custom' : 'vps-docker';
}

async function chooseRunMode(recommendedMode = 'local') {
  console.log('\n' + color('blue', 'Modo de arranque'));
  const localMarker = recommendedMode === 'local' ? '  ← recomendado' : '';
  const dockerMarker = recommendedMode === 'docker' ? '  ← recomendado' : '';
  console.log(`   [1] Local con node server.js${localMarker}`);
  console.log(`   [2] Docker con docker compose up -d${dockerMarker}`);
  console.log('   [3] Solo generar .env, no arrancar ahora');
  const choice = await ask(color('yellow', `   Elige una opción [${recommendedMode === 'docker' ? '2' : '1'}]: `));
  if (!choice) return recommendedMode;
  if (choice === '2') return 'docker';
  if (choice === '3') return 'none';
  return 'local';
}

async function main() {
  header();
  await preflightSystem();
  const defaults = mergeDefaults();

  if (fs.existsSync(LEGACY_CONFIG_PATH)) {
    console.log(color('magenta', 'Se detectó config.json legado; sus valores se usan como predeterminados si faltan en .env.'));
  }

  console.log(color('bright', 'Telegram'));
  console.log('  Crea tu bot hablando con @BotFather y copia el token.');
  console.log('  Ejemplo de token: 123456789:ABCdefGhiJKlmNOpqrSTUvwxYZ');
  console.log('  Para tu ID numérico puedes escribir a @userinfobot o @RawDataBot.');
  console.log('  Ejemplo de ID: 7051275102\n');

  const telegramToken = await askSecret(
    '1. Token del bot de Telegram',
    defaults.TELEGRAM_TOKEN || '',
    value => /^\d+:[A-Za-z0-9_-]{20,}$/.test(value),
    'Debe tener formato 123456789:ABC...'
  );
  const telegramAdminId = await askRequired(
    '2. ID numérico del admin de Telegram',
    defaults.TELEGRAM_ADMIN_ID || '',
    value => /^\d+$/.test(value),
    'Debe contener solo números.'
  );

  console.log('\n' + color('bright', 'Panel web admin'));
  const suggestedPassword = defaults.ADMIN_PANEL_PASSWORD || randomPassword();
  const adminPassword = await askSecret(
    '3. Contraseña del panel /admin',
    suggestedPassword,
    value => String(value).length >= 8,
    'Usa al menos 8 caracteres; recomendado 12 o más.'
  );
  if (adminPassword.length < 12) {
    console.log(color('yellow', '  Recomendación: usa 12+ caracteres para producción.'));
  }

  const adminLanguageOption = await choose(
    '4. Idioma en que el admin verá los mensajes traducidos',
    ADMIN_LANGUAGES,
    defaults.ADMIN_LANGUAGE || 'es'
  );

  console.log('\n' + color('bright', 'Widget del chat'));
  const colorOption = await choose('5. Color principal del chat', COLOR_OPTIONS, defaults.WIDGET_PRIMARY_COLOR || '#4F46E5');
  let widgetPrimaryColor = colorOption.value;
  if (!widgetPrimaryColor) {
    widgetPrimaryColor = await askRequired(
      '   Color personalizado en hexadecimal',
      defaults.WIDGET_PRIMARY_COLOR || '#4F46E5',
      isValidHexColor,
      'Ejemplo válido: #4F46E5'
    );
  }

  const styleOption = await choose('6. Estilo del botón del widget', [
    { key: '1', name: 'Flotante en la esquina inferior derecha', value: 'floating' },
    { key: '2', name: 'Barra inferior persistente', value: 'persistent' },
    { key: '3', name: 'Oculto, para abrirlo por código', value: 'hidden' },
  ], defaults.WIDGET_BUTTON_STYLE || 'floating');

  console.log('\n' + color('blue', '7. Mensaje de bienvenida'));
  console.log('   Deja vacío para usar el saludo automático por idioma del navegador (es/en/pt).');
  if (defaults.WIDGET_WELCOME_MESSAGE) {
    console.log(`   Mensaje fijo actual detectado: ${defaults.WIDGET_WELCOME_MESSAGE}`);
  }
  const widgetWelcomeMessage = await ask(color('yellow', '   Mensaje fijo (Enter = automático multidioma): '));

  console.log('\n' + color('bright', 'Servidor'));
  const detectedPublicIp = await detectPublicIp();
  if (detectedPublicIp) {
    console.log(color('green', `✓ IP pública detectada para desarrollo VPS: ${detectedPublicIp}`));
  } else {
    console.log(color('yellow', '⚠ No pude detectar la IP pública automáticamente. Puedes definir LIVECHAT_PUBLIC_IP antes de ejecutar setup.js.'));
  }
  const deploymentProfile = await chooseDeploymentProfile();
  const recommendedRunMode = deploymentProfile === 'vps-docker' ? 'docker' : 'local';
  let port = defaults.PORT || '3000';
  let hostPort = defaults.HOST_PORT || '8080';

  if (deploymentProfile === 'vps-docker') {
    console.log(color('green', `✓ Perfil VPS público con Docker seleccionado: PORT=${port} dentro del contenedor y HOST_PORT=${hostPort} hacia internet.`));
  } else {
    console.log('   En Docker se recomienda publicar HOST_PORT=8080 y mantener PORT=3000 dentro del contenedor para dejar 80/443 libres.');
    port = await askRequired('8. Puerto interno de la app', defaults.PORT || '3000', value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536, 'Usa un puerto entre 1 y 65535.');
    hostPort = await askRequired('9. Puerto público del VPS para Docker', defaults.HOST_PORT || '8080', value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536, 'Usa un puerto entre 1 y 65535.');
  }
  console.log('   Escribe tu dominio real para CORS. Ejemplos: ejemplo.com, https://chat.ejemplo.com');
  console.log('   Si lo dejas en blanco, se usará la IP pública del VPS para desarrollo.');
  const originDefault = defaults.ALLOWED_ORIGINS && defaults.ALLOWED_ORIGINS !== '*'
    ? defaults.ALLOWED_ORIGINS
    : (detectedPublicIp ? `http://${detectedPublicIp}` : '*');
  const domainInput = await ask(color('yellow', `10. Dominio real / orígenes permitidos [${originDefault}]: `));
  const allowedOrigins = domainInput
    ? normalizeOrigins(domainInput)
    : publicOriginFromDomainOrIp(defaults.ALLOWED_ORIGINS === '*' ? '' : defaults.ALLOWED_ORIGINS, detectedPublicIp);
  const widgetApiKey = await ask('11. API key opcional del widget (Enter para desactivar): ') || defaults.WIDGET_API_KEY || '';
  const translationProviderOption = await choose(
    '12. Proveedor de traducción',
    TRANSLATION_PROVIDERS,
    defaults.TRANSLATION_PROVIDER || 'google_free'
  );
  const translationApiKey = translationProviderOption.code === 'google_free'
    ? ''
    : await ask(`   API key para ${translationProviderOption.name} (Enter para dejar pendiente): `) || defaults.TRANSLATION_API_KEY || '';

  const config = {
    telegramToken,
    telegramAdminId,
    adminPassword,
    adminLanguage: adminLanguageOption.code,
    adminSessionTtlHours: defaults.ADMIN_SESSION_TTL_HOURS || '12',
    logLevel: defaults.LOG_LEVEL || 'info',
    trustProxyHops: defaults.TRUST_PROXY_HOPS || '1',
    telegramLaunchTimeoutMs: defaults.TELEGRAM_LAUNCH_TIMEOUT_MS || '15000',
    cookieSameSite: defaults.COOKIE_SAME_SITE || 'lax',
    widgetButtonStyle: styleOption.value,
    widgetPrimaryColor,
    widgetWelcomeMessage,
    widgetApiKey,
    port,
    hostPort,
    allowedOrigins,
    featureTranslation: defaults.FEATURE_TRANSLATION || 'true',
    featureSentiment: defaults.FEATURE_SENTIMENT || 'true',
    featureGhostTyping: defaults.FEATURE_GHOST_TYPING || 'true',
    featureGeoLocation: defaults.FEATURE_GEOLOCATION || 'true',
    translationProvider: translationProviderOption.code,
    translationApiKey,
    deeplApiUrl: defaults.DEEPL_API_URL || '',
    rateLimitWindowMinutes: defaults.RATE_LIMIT_WINDOW_MINUTES || '15',
    rateLimitPublicMax: defaults.RATE_LIMIT_PUBLIC_MAX || '300',
    rateLimitAdminMax: defaults.RATE_LIMIT_ADMIN_MAX || '2000',
    rateLimitLoginMax: defaults.RATE_LIMIT_LOGIN_MAX || '20',
    rateLimitUploadWindowMinutes: defaults.RATE_LIMIT_UPLOAD_WINDOW_MINUTES || '1',
    rateLimitUploadMax: defaults.RATE_LIMIT_UPLOAD_MAX || '10',
    maxUploadMb: defaults.MAX_UPLOAD_MB || '5',
    uploadDir: defaults.UPLOAD_DIR || 'data/uploads',
    allowedImageTypes: defaults.ALLOWED_IMAGE_TYPES || 'image/jpeg,image/png,image/webp,image/gif',
    redisUrl: defaults.REDIS_URL || '',
    redisKeyPrefix: defaults.REDIS_KEY_PREFIX || 'lcp',
  };

  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await chooseYesNo(`\n${ENV_PATH} ya existe. ¿Sobrescribirlo?`, true);
    if (!overwrite) {
      console.log(color('yellow', 'Instalación cancelada sin modificar .env.'));
      rl?.close();
      return;
    }
  }

  fs.writeFileSync(ENV_PATH, buildEnv(config), 'utf8');
  console.log('\n' + color('green', `✓ Configuración escrita en ${ENV_PATH}`));

  const mode = await chooseRunMode(recommendedRunMode);
  let finalCommand = 'node server.js';

  if (mode === 'docker') {
    finalCommand = 'docker compose up -d';
    if (!commandExists('docker')) {
      console.log(color('yellow', 'No encontré docker en PATH. Instala Docker o usa el arranque local.'));
    } else if (await chooseYesNo('¿Quieres construir y arrancar ahora con Docker?', true)) {
      const code = await runCommand('docker', ['compose', 'up', '-d', '--build']);
      console.log(code === 0 ? color('green', '✓ Docker arrancó correctamente.') : color('red', 'Docker terminó con errores. Revisa la salida anterior.'));
    }
  } else if (mode === 'local') {
    finalCommand = 'node server.js';
    if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
      const npmCommand = 'npm';
      if (await chooseYesNo(`No encontré node_modules. ¿Instalar dependencias con ${npmCommand} install?`, true)) {
        await runCommand(npmCommand, ['install']);
      }
    }
    if (await chooseYesNo('¿Quieres arrancar ahora en modo local?', false)) {
      console.log(color('blue', `Ejecutando ${finalCommand}. Presiona Ctrl+C para detener.`));
      await runCommand('node', ['server.js']);
    }
  } else {
    finalCommand = recommendedRunMode === 'docker' ? 'docker compose up -d' : 'node server.js';
  }

  console.log('\n' + color('green', 'Instalación lista.'));
  console.log(color('bright', `Comando final recomendado: ${finalCommand}`));
  const shownPort = finalCommand.startsWith('docker') ? config.hostPort : config.port;
  const baseUrl = publicBaseUrl(config.allowedOrigins, shownPort);
  console.log(color('blue', `Demo del widget: ${baseUrl}`));
  console.log(color('blue', `Healthcheck visual: ${baseUrl}/health`));
  console.log(color('blue', `Panel admin: ${baseUrl}/admin`));
  console.log('\n' + color('bright', 'Código para pegar en tu página web'));
  console.log(color('cyan', widgetSnippet(baseUrl, config.widgetApiKey)));
  if (config.widgetButtonStyle === 'hidden') {
    console.log('\n' + color('bright', 'Botón personalizado para abrir el chat oculto'));
    console.log(color('cyan', hiddenWidgetOpenSnippet()));
  }
  rl?.close();
}

main().catch(error => {
  console.error(color('red', error.stack || error.message));
  rl?.close();
  process.exitCode = 1;
});
