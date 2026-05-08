#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = __dirname;
const ENV_PATH = process.env.LIVECHAT_ENV_PATH || path.join(ROOT, '.env');
const LEGACY_CONFIG_PATH = path.join(ROOT, 'config.json');
const SCRIPTED_INPUT = process.stdin.isTTY ? null : fs.readFileSync(0, 'utf8').split(/\r?\n/);
let rl = SCRIPTED_INPUT ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
const REQUIRED_NODE_MAJOR = 24;
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
const quoteEnv = value => JSON.stringify(String(value == null ? '' : value));
const shouldRunSystemChecks = process.env.LIVECHAT_SKIP_SYSTEM_CHECKS !== '1';
const setupLogger = createSetupLogger();
// ask() supports both interactive use and scripted stdin. Tests/install docs can
// pipe answers while normal users get readline prompts.
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

function createSetupLogger() {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stream = null;
  let logPath = '';

  try {
    logPath = setupLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    stream.write([
      '',
      '============================================================',
      `LiveChat Pro setup log - ${new Date().toISOString()}`,
      `Working directory: ${ROOT}`,
      `Command: ${process.argv.map(shellQuote).join(' ')}`,
      `Node.js: ${process.version}`,
      `Platform: ${process.platform} ${process.arch}`,
      '============================================================',
      '',
    ].join('\n'));
  } catch (error) {
    originalStderrWrite(color('yellow', `Setup log could not be opened: ${error.message}\n`));
  }

  const writeLog = chunk => {
    if (!stream) return;
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    stream.write(stripAnsi(text));
  };

  process.stdout.write = function writeStdout(chunk, encoding, callback) {
    writeLog(chunk);
    return originalStdoutWrite(chunk, encoding, callback);
  };
  process.stderr.write = function writeStderr(chunk, encoding, callback) {
    writeLog(chunk);
    return originalStderrWrite(chunk, encoding, callback);
  };

  return {
    path: logPath,
    write: writeLog,
    close() {
      if (stream) stream.end();
      stream = null;
    },
  };
}

function setupLogPath() {
  const explicitPath = String(process.env.LIVECHAT_SETUP_LOG_PATH || '').trim();
  if (explicitPath) return path.resolve(explicitPath);

  const explicitDir = String(process.env.LIVECHAT_SETUP_LOG_DIR || '').trim();
  const logDir = explicitDir ? path.resolve(explicitDir) : resolveDesktopDir();
  return path.join(logDir, `livechat-pro-setup-${timestampForFilename()}.log`);
}

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveDesktopDir() {
  const homeDir = resolveRealUserHome();
  const xdgDesktop = readXdgDesktopDir(homeDir);
  if (xdgDesktop) return xdgDesktop;

  const localizedDesktop = path.join(homeDir, 'Escritorio');
  if (fs.existsSync(localizedDesktop)) return localizedDesktop;
  return path.join(homeDir, 'Desktop');
}

function resolveRealUserHome() {
  const sudoUser = process.env.SUDO_USER && process.env.SUDO_USER !== 'root' ? process.env.SUDO_USER : '';
  if (sudoUser) {
    const sudoHome = path.join('/home', sudoUser);
    if (fs.existsSync(sudoHome)) return sudoHome;
  }
  return os.homedir();
}

function readXdgDesktopDir(homeDir) {
  const userDirsPath = path.join(homeDir, '.config', 'user-dirs.dirs');
  if (!fs.existsSync(userDirsPath)) return '';
  const content = fs.readFileSync(userDirsPath, 'utf8');
  const match = content.match(/^XDG_DESKTOP_DIR=(["']?)(.+?)\1$/m);
  if (!match) return '';
  return match[2].replace(/\$HOME/g, homeDir);
}

const COLOR_OPTIONS = [
  { key: '1', name: 'Professional indigo', value: '#4F46E5' },
  { key: '2', name: 'Support blue', value: '#2563EB' },
  { key: '3', name: 'Trust green', value: '#059669' },
  { key: '4', name: 'Terracotta red', value: '#BA4A2F' },
  { key: '5', name: 'Elegant gray', value: '#334155' },
  { key: '6', name: 'Custom', value: '' },
];

const ADMIN_LANGUAGES = [
  { key: '1', code: 'es', name: 'Spanish' },
  { key: '2', code: 'en', name: 'English' },
  { key: '3', code: 'pt', name: 'Portuguese' },
  { key: '4', code: 'fr', name: 'French' },
  { key: '5', code: 'de', name: 'German' },
  { key: '6', code: 'it', name: 'Italian' },
];

const TRANSLATION_PROVIDERS = [
  { key: '1', code: 'google_free', name: 'Free Google fallback (no API key)' },
  { key: '2', code: 'deepl', name: 'Official DeepL' },
  { key: '3', code: 'google_cloud', name: 'Official Google Cloud Translation' },
];

function header() {
  if (!process.env.LIVECHAT_SETUP_NO_CLEAR) console.clear();
  console.log(color('cyan', '╔════════════════════════════════════════════════════╗'));
  console.log(color('cyan', '║') + color('bright', '        LiveChat Pro — Guided installer             ') + color('cyan', '║'));
  console.log(color('cyan', '╚════════════════════════════════════════════════════╝'));
  console.log('');
}

function parseEnvFile(filePath) {
  // Minimal .env parser for setup defaults. Runtime loading is still delegated
  // to dotenv in src/config.
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
  // Older versions generated config.json. Preserve those answers so running the
  // modern installer can migrate without forcing the user to re-enter everything.
  if (!fs.existsSync(LEGACY_CONFIG_PATH)) return {};
  try {
    const old = JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, 'utf8'));
    return {
      TELEGRAM_TOKEN: old.telegram && old.telegram.token,
      TELEGRAM_ADMIN_ID: old.telegram && old.telegram.adminId,
      PORT: old.server && old.server.port,
      HOST_PORT: old.server && old.server.hostPort,
      WIDGET_BUTTON_STYLE: old.widget && old.widget.buttonStyle,
      WIDGET_PRIMARY_COLOR: old.widget && old.widget.primaryColor,
      WIDGET_WELCOME_MESSAGE: old.widget && old.widget.welcomeMessage,
      ADMIN_PANEL_PASSWORD: old.admin && old.admin.panelPassword,
      ADMIN_LANGUAGE: old.admin && old.admin.language,
    };
  } catch (error) {
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
    console.log(color('red', `  Invalid value. ${help}`));
  }
}

async function askSecret(label, current, validator, help) {
  while (true) {
    const suffix = current ? ` [${maskSecret(current)}]` : '';
    const value = await ask(color('yellow', `${label}${suffix}: `)) || current || '';
    if (!validator || validator(value)) return value;
    console.log(color('red', `  Invalid value. ${help}`));
  }
}

async function choose(label, options, currentValue) {
  // Reuses current .env values as defaults when rerunning setup.
  console.log('\n' + color('blue', label));
  for (const option of options) {
    const marker = option.value === currentValue || option.code === currentValue ? '  ← current' : '';
    console.log(`   [${option.key}] ${option.name}${option.value ? ` (${option.value})` : option.code ? ` (${option.code})` : ''}${marker}`);
  }
  const answer = await ask(color('yellow', '   Choose an option: '));
  return options.find(option => option.key === answer) || options.find(option => option.value === currentValue || option.code === currentValue) || options[0];
}

async function chooseYesNo(label, defaultValue = true) {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(color('yellow', `${label} [${hint}]: `))).toLowerCase();
  if (!answer) return defaultValue;
  return ['s', 'si', 'sí', 'y', 'yes'].includes(answer);
}

function randomPassword() {
  return Array.from(cryptoRandomBytes(18), byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.charAt(byte % 64)).join('');
}

function cryptoRandomBytes(size) {
  // Lazy require keeps setup startup lightweight and avoids holding crypto in the
  // top-level namespace until randomness is needed.
  return require('crypto').randomBytes(size);
}

function buildEnv(config) {
  // Emit a deterministic .env file so rerunning setup produces small diffs.
  return [
    '# ============================================================',
    '# LiveChat Pro — generated by setup.js',
    '# DO NOT commit this file to git',
    '# ============================================================',
    '',
    '# Telegram',
    `TELEGRAM_TOKEN=${quoteEnv(config.telegramToken)}`,
    `TELEGRAM_ADMIN_ID=${quoteEnv(config.telegramAdminId)}`,
    '',
    '# Server',
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
    '# Features (true/false)',
    `FEATURE_TRANSLATION=${quoteEnv(config.featureTranslation)}`,
    `FEATURE_SENTIMENT=${quoteEnv(config.featureSentiment)}`,
    `FEATURE_GHOST_TYPING=${quoteEnv(config.featureGhostTyping)}`,
    `FEATURE_GEOLOCATION=${quoteEnv(config.featureGeoLocation)}`,
    '',
    '# Translation',
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
    '# Image attachments',
    `MAX_UPLOAD_MB=${quoteEnv(config.maxUploadMb)}`,
    `UPLOAD_DIR=${quoteEnv(config.uploadDir)}`,
    `ALLOWED_IMAGE_TYPES=${quoteEnv(config.allowedImageTypes)}`,
    '',
    '# Smart Bot',
    `BOT_MODE=${quoteEnv(config.botMode)}`,
    `OPENAI_API_KEY=${quoteEnv(config.openaiApiKey)}`,
    `OPENAI_MODEL=${quoteEnv(config.openaiModel)}`,
    `OPENAI_MAX_TOKENS=${quoteEnv(config.openaiMaxTokens)}`,
    `BOT_SYSTEM_PROMPT=${quoteEnv(config.botSystemPrompt)}`,
    `BOT_CONFIDENCE_THRESHOLD=${quoteEnv(config.botConfidenceThreshold)}`,
    `BOT_CONTEXT_MESSAGES=${quoteEnv(config.botContextMessages)}`,
    `BOT_NOTIFY_ADMIN=${quoteEnv(config.botNotifyAdmin)}`,
    '',
    '# Redis (optional, recommended for multi-node)',
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
  } catch (error) {
    return false;
  }
}

function runCommand(command, args) {
  // Non-interactive command runner used for checks where stdout/stderr are only
  // needed to decide success.
  setupLogger.write(`\n$ ${[command].concat(args || []).map(shellQuote).join(' ')}\n`);
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('exit', code => {
      const exitCode = code || 0;
      setupLogger.write(`\n[exit ${exitCode}] ${command}\n`);
      resolve(exitCode);
    });
    child.on('error', error => {
      process.stderr.write(`${error.message}\n`);
      setupLogger.write(`\n[spawn error] ${command}: ${error.message}\n`);
      resolve(1);
    });
  });
}

function runInteractiveCommand(command, args) {
  // Interactive commands inherit stdio so package managers and sudo can prompt
  // normally.
  const hadReadline = closeReadlineForInteractiveCommand();
  setupLogger.write(`\n$ ${[command].concat(args || []).map(shellQuote).join(' ')}\n`);
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    const finish = code => {
      if (hadReadline && process.stdin.isTTY && !rl) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      }
      const exitCode = code || 0;
      setupLogger.write(`\n[exit ${exitCode}] ${command}\n`);
      resolve(exitCode);
    };
    child.on('exit', finish);
    child.on('error', error => {
      process.stderr.write(`${error.message}\n`);
      setupLogger.write(`\n[spawn error] ${command}: ${error.message}\n`);
      finish(1);
    });
  });
}

function runShell(command) {
  setupLogger.write(`\n$ ${command}\n`);
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-lc', command], { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('exit', code => {
      const exitCode = code || 0;
      setupLogger.write(`\n[exit ${exitCode}] ${command}\n`);
      resolve(exitCode);
    });
    child.on('error', error => {
      process.stderr.write(`${error.message}\n`);
      setupLogger.write(`\n[spawn error] ${command}: ${error.message}\n`);
      resolve(1);
    });
  });
}

function startProgress(label) {
  const frames = [
    '[>         ]',
    '[=>        ]',
    '[==>       ]',
    '[===>      ]',
    '[====>     ]',
    '[=====>    ]',
    '[======>   ]',
    '[=======>  ]',
    '[========> ]',
    '[=========>]',
  ];
  let index = 0;
  const write = () => {
    const frame = frames[index % frames.length];
    index += 1;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${color('cyan', frame)} ${label}...`);
    }
  };
  if (!process.stdout.isTTY) {
    console.log(color('cyan', `${label}...`));
    return () => {};
  }
  write();
  const timer = setInterval(write, 160);
  return status => {
    clearInterval(timer);
    const finalFrame = status === 'ok' ? '[==========]' : '[!!!!!!!!!]';
    const finalColor = status === 'ok' ? 'green' : 'red';
    process.stdout.write(`\r${color(finalColor, finalFrame)} ${label}${' '.repeat(20)}\n`);
  };
}

function logFileFor(label) {
  const safeLabel = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'command';
  return path.join(os.tmpdir(), `livechat-pro-${safeLabel}-${Date.now()}.log`);
}

function tailText(text, maxLines) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

function runShellQuiet(command, label) {
  const logPath = logFileFor(label);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const stopProgress = startProgress(label);
  setupLogger.write(`\n$ ${command}\n`);

  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-lc', command], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = chunk => {
      const text = String(chunk);
      output += text;
      logStream.write(text);
      setupLogger.write(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('exit', code => {
      const exitCode = code === 0 ? 0 : (code || 1);
      stopProgress(exitCode === 0 ? 'ok' : 'fail');
      setupLogger.write(`\n[exit ${exitCode}] ${label}\n`);
      logStream.end(() => resolve({ code: exitCode, logPath, tail: tailText(output, 18) }));
    });
    child.on('error', error => {
      collect(error.message);
      stopProgress('fail');
      setupLogger.write(`\n[spawn error] ${label}: ${error.message}\n`);
      logStream.end(() => resolve({ code: 1, logPath, tail: tailText(output || error.message, 18) }));
    });
  });
}

async function ensureSudoAccess() {
  // Validate sudo once before install steps so later package-manager commands do
  // not fail halfway through a setup profile.
  if (!process.getuid || process.getuid() === 0 || sudoValidated) return true;
  if (!commandExists('sudo')) {
    console.log(color('red', 'sudo was not found. Run setup.js as root or install sudo before preparing the VPS.'));
    return false;
  }

  console.log(color('yellow', 'sudo access will be validated to install packages and open ports.'));
  const cachedCode = await runCommand('sudo', ['-n', '-v']);
  if (cachedCode === 0) {
    sudoValidated = true;
    return true;
  }

  if (!process.stdin.isTTY) {
    console.log(color('red', 'sudo could not be validated without interaction. Run setup from an interactive terminal, run `sudo -v` first, or use LIVECHAT_SKIP_SYSTEM_CHECKS=1 if you only want to generate .env.'));
    return false;
  }

  console.log(color('yellow', 'Enter your sudo password if the system asks for it.'));
  const code = await runInteractiveCommand('sudo', ['-v']);
  if (code !== 0) {
    console.log(color('red', 'sudo could not be validated. Check the password or confirm that your user belongs to the sudo/wheel group.'));
    console.log(color('yellow', 'You can also run the installer as root, or prepare Node.js/Docker/firewall manually and run setup.js again.'));
    return false;
  }

  sudoValidated = true;
  return true;
}

function captureShell(command) {
  setupLogger.write(`\n$ ${command}\n`);
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-lc', command], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => {
      const exitCode = code || 0;
      if (stdout) setupLogger.write(stdout);
      if (stderr) setupLogger.write(stderr);
      setupLogger.write(`\n[exit ${exitCode}] ${command}\n`);
      resolve({ code: exitCode, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', error => {
      setupLogger.write(`\n[spawn error] ${command}: ${error.message}\n`);
      resolve({ code: 1, stdout: '', stderr: error.message });
    });
  });
}

function parseOsRelease() {
  // /etc/os-release gives enough signal to choose package-manager commands
  // without pulling in external platform detection packages.
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

function sudoEnvPrefix() {
  if (process.getuid && process.getuid() === 0) return '';
  return process.stdin.isTTY ? 'sudo -E ' : 'sudo -n -E ';
}

function sudoCommand(command) {
  if (process.getuid && process.getuid() === 0) return command;
  return `sudo ${command}`;
}

function sudoArgs(command, args) {
  if (process.getuid && process.getuid() === 0) return { command, args };
  return { command: 'sudo', args: [command].concat(args) };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function localLogPath() {
  return process.env.LIVECHAT_LOCAL_LOG_PATH || path.join(ROOT, 'data', 'livechat-pro.local.log');
}

function localPidPath() {
  return process.env.LIVECHAT_LOCAL_PID_PATH || path.join(ROOT, 'data', 'livechat-pro.local.pid');
}

function sudoNonInteractivePrefix() {
  if (process.getuid && process.getuid() === 0) return '';
  return 'sudo -n ';
}

function localBackgroundStartScript(logPath, pidPath) {
  const launcher = commandExists('setsid') ? 'setsid ' : '';
  return [
    `cd ${shellQuote(ROOT)}`,
    `mkdir -p ${shellQuote(path.dirname(logPath))}`,
    `{ ${launcher}nohup node server.js > ${shellQuote(logPath)} 2>&1 < /dev/null & pid=$!; echo "$pid" > ${shellQuote(pidPath)}; echo "$pid"; }`,
  ].join(' && ');
}

function localStartCommand() {
  const logPath = localLogPath();
  const pidPath = localPidPath();
  const inner = localBackgroundStartScript(logPath, pidPath);
  return `${sudoCommand('npm install')} && ${sudoNonInteractivePrefix()}sh -c ${shellQuote(inner)}`;
}

async function startLocalServerInBackground() {
  const logPath = localLogPath();
  const pidPath = localPidPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (!(await ensureSudoAccess())) return null;

  const inner = localBackgroundStartScript(logPath, pidPath);
  const command = `${sudoNonInteractivePrefix()}sh -c ${shellQuote(inner)}`;
  const result = await captureShell(command);
  if (result.code !== 0 || !result.stdout) {
    console.log(color('red', 'Local server could not be started in the background.'));
    if (result.stderr) console.log(color('yellow', result.stderr));
    console.log(color('yellow', `Log file: ${logPath}`));
    return null;
  }

  const pid = result.stdout.split(/\r?\n/).filter(Boolean).pop();
  console.log(color('green', `✓ Local server started in the background. PID: ${pid}`));
  console.log(color('blue', `Local server log: ${logPath}`));
  console.log(color('blue', `PID file: ${pidPath}`));
  console.log(color('yellow', `Stop it with: sudo kill ${pid}`));
  return { pid, logPath };
}

function hasSystemd() {
  return commandExists('systemctl') && fs.existsSync('/run/systemd/system');
}

function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch (error) {
    return false;
  }
}

function runtimeEnvironment(osInfo = parseOsRelease()) {
  const wsl = isWsl();
  const systemd = hasSystemd();
  const openRc = commandExists('rc-service');
  const service = commandExists('service');
  let kind = 'linux-custom';

  if (wsl && systemd) kind = 'wsl-systemd';
  else if (wsl) kind = 'wsl-no-systemd';
  else if (systemd) kind = 'linux-systemd';
  else if (openRc) kind = 'linux-openrc';

  return {
    osInfo,
    isWsl: wsl,
    hasSystemd: systemd,
    hasOpenRc: openRc,
    hasService: service,
    kind,
  };
}

function runtimeLabel(runtime) {
  const labels = {
    'wsl-systemd': 'WSL with systemd',
    'wsl-no-systemd': 'WSL without systemd',
    'linux-systemd': 'Linux with systemd',
    'linux-openrc': 'Linux with OpenRC',
    'linux-custom': 'Linux without a supported service manager',
  };
  return labels[runtime.kind] || runtime.kind;
}

function packageManagerCleanupCommand(osInfo) {
  const sudo = sudoPrefix();
  const id = osInfo.id;
  const like = osInfo.idLike;

  if (id === 'ubuntu' || id === 'debian' || like.includes('debian')) {
    return [
      `${sudo}dpkg --configure -a`,
      `${sudo}apt-get -f install -y`,
      `${sudo}apt-get autoremove -y`,
      `${sudo}apt-get autoclean -y`,
    ].join(' && ');
  }

  if (id === 'fedora' || ['centos', 'rhel', 'rocky', 'almalinux'].includes(id) || like.includes('rhel')) {
    const pkg = commandExists('dnf') ? 'dnf' : 'yum';
    return `${sudo}${pkg} -y autoremove && ${sudo}${pkg} clean all`;
  }

  if (id === 'arch' || like.includes('arch')) return `${sudo}pacman -Sc --noconfirm`;
  if (id === 'alpine') return `${sudo}apk cache clean`;
  return '';
}

function repairSuggestion(osInfo) {
  const id = osInfo.id;
  const like = osInfo.idLike;

  if (id === 'ubuntu' || id === 'debian' || like.includes('debian')) {
    return [
      'Run:',
      '  sudo dpkg --configure -a',
      '  sudo apt-get -f install -y',
      '  sudo apt autoremove -y',
      'Then run the LiveChat Pro install command again.',
    ].join('\n');
  }

  if (id === 'fedora' || ['centos', 'rhel', 'rocky', 'almalinux'].includes(id) || like.includes('rhel')) {
    const pkg = commandExists('dnf') ? 'dnf' : 'yum';
    return [
      'Run:',
      `  sudo ${pkg} -y autoremove`,
      `  sudo ${pkg} clean all`,
      'Then run the LiveChat Pro install command again.',
    ].join('\n');
  }

  if (id === 'arch' || like.includes('arch')) {
    return [
      'Run:',
      '  sudo pacman -Syu',
      '  sudo pacman -Sc --noconfirm',
      'Then run the LiveChat Pro install command again.',
    ].join('\n');
  }

  if (id === 'alpine') {
    return [
      'Run:',
      '  sudo apk fix',
      '  sudo apk cache clean',
      'Then run the LiveChat Pro install command again.',
    ].join('\n');
  }

  return 'Repair the package manager manually, then run the LiveChat Pro install command again.';
}

function dockerRepairSuggestion(osInfo) {
  if (isWsl()) {
    return [
      'Docker is installed, but the daemon is not available from this WSL distro.',
      'Recommended WSL options:',
      '  1. Open Docker Desktop on Windows and enable Settings > Resources > WSL integration for this distro.',
      '  2. Verify inside WSL: docker info && docker compose version.',
      '  3. Run node setup.js again and choose Docker, or choose local Node mode.',
      '',
      'Alternative WSL option with systemd:',
      '  sudo sh -c \'printf "[boot]\\nsystemd=true\\n" > /etc/wsl.conf\'',
      '  wsl.exe --shutdown',
      '  Reopen the distro, then run: sudo systemctl enable --now docker',
      '',
      'If you do not want Docker in WSL, choose local mode and start with Node/npm.',
    ].join('\n');
  }

  return [
    'Run:',
    '  sudo systemctl enable --now docker',
    '  sudo docker info',
    'If this server does not use systemd, start Docker with the distro service manager.',
    'Then run the LiveChat Pro install command again.',
    '',
    repairSuggestion(osInfo),
  ].join('\n');
}

function printManagedFailure(title, result, osInfo) {
  console.log(color('red', `${title} failed.`));
  if (result && result.logPath) console.log(color('yellow', `Full log: ${result.logPath}`));
  if (result && result.tail) {
    console.log(color('yellow', 'Last log lines:'));
    console.log(result.tail);
  }
  console.log(color('yellow', repairSuggestion(osInfo)));
}

function printDockerFailure(title, result, osInfo) {
  console.log(color('red', `${title} failed.`));
  if (result && result.logPath) console.log(color('yellow', `Full log: ${result.logPath}`));
  if (result && result.tail) {
    console.log(color('yellow', 'Last log lines:'));
    console.log(result.tail);
  }
  console.log(color('yellow', dockerRepairSuggestion(osInfo)));
}

async function runManagedSystemTask(label, command, osInfo) {
  const result = await runShellQuiet(command, label);
  if (result.code !== 0) {
    printManagedFailure(label, result, osInfo);
    return false;
  }

  const cleanupCommand = packageManagerCleanupCommand(osInfo);
  if (!cleanupCommand) return true;

  const cleanup = await runShellQuiet(cleanupCommand, `Cleaning package manager after ${label}`);
  if (cleanup.code !== 0) {
    printManagedFailure(`Package manager cleanup after ${label}`, cleanup, osInfo);
    return false;
  }

  return true;
}

function dockerInstallCommand(osInfo) {
  // Docker installation varies by distro family. Commands are intentionally
  // explicit so users can inspect what setup is about to run.
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
      dnfAddRepoCommand('https://download.docker.com/linux/fedora/docker-ce.repo'),
      `${sudo}dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`,
    ].join(' && ');
  }

  if (['centos', 'rhel', 'rocky', 'almalinux'].includes(id) || like.includes('rhel')) {
    const pkg = commandExists('dnf') ? 'dnf' : 'yum';
    return [
      `${sudo}${pkg} -y install ${pkg === 'dnf' ? 'dnf-plugins-core' : 'yum-utils'}`,
      pkg === 'dnf'
        ? dnfAddRepoCommand('https://download.docker.com/linux/centos/docker-ce.repo')
        : `${sudo}yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo`,
      `${sudo}${pkg} -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`,
    ].join(' && ');
  }

  if (id === 'arch' || like.includes('arch')) return `${sudo}pacman -Sy --noconfirm docker docker-compose`;
  if (id === 'alpine') return `${sudo}apk add --no-cache docker docker-cli-compose`;
  return '';
}

function dnfAddRepoCommand(repoUrl) {
  // dnf5 changed config-manager syntax. This keeps Fedora/RHEL-family installs
  // compatible with both dnf4 and dnf5.
  const sudo = sudoPrefix();
  const quotedRepoUrl = shellQuote(repoUrl);
  return [
    'if dnf config-manager --help 2>&1 | grep -q "addrepo"; then',
    `${sudo}dnf config-manager addrepo --from-repofile=${quotedRepoUrl};`,
    'else',
    `${sudo}dnf config-manager --add-repo ${quotedRepoUrl};`,
    'fi',
  ].join(' ');
}

function parseNodeMajor(versionText) {
  const match = String(versionText || '').match(/v?(\d+)\./);
  return match ? Number(match[1]) : 0;
}

function compareVersions(left, right) {
  const leftParts = String(left || '').split('.').map(part => Number(part) || 0);
  const rightParts = String(right || '').split('.').map(part => Number(part) || 0);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function getSystemNodeInfo() {
  const resolved = await captureShell('command -v node 2>/dev/null && node --version');
  if (resolved.code !== 0 || !resolved.stdout) return null;
  const lines = resolved.stdout.split(/\r?\n/).filter(Boolean);
  const binary = lines[0] || '';
  const version = lines[1] || '';
  const realpath = await captureShell(`realpath "${binary}" 2>/dev/null || readlink -f "${binary}" 2>/dev/null || echo "${binary}"`);
  const npm = await captureShell('npm --version 2>/dev/null');
  const location = realpath.stdout || binary;
  const localRoot = path.join(ROOT, '.local');
  const isProjectLocal = location === path.join(ROOT, 'node-local') || location.startsWith(`${localRoot}${path.sep}`);
  return {
    binary,
    location,
    version,
    npmVersion: npm.code === 0 ? npm.stdout : '',
    major: parseNodeMajor(version),
    isProjectLocal,
  };
}

function nodeInstallCommand(osInfo) {
  const sudo = sudoPrefix();
  const sudoEnv = sudoEnvPrefix();
  const id = osInfo.id;
  const like = osInfo.idLike;

  if (id === 'ubuntu' || id === 'debian' || like.includes('debian')) {
    return [
      `${sudo}apt-get remove -y nodejs npm || true`,
      `${sudo}apt-get update`,
      `${sudo}apt-get install -y ca-certificates curl gnupg`,
      `curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | ${sudoEnv}bash -`,
      `${sudo}apt-get install -y nodejs`,
    ].join(' && ');
  }

  if (id === 'fedora') {
    return [
      rpmNodeRemovalCommand('dnf'),
      `${sudo}dnf -y install ca-certificates curl`,
      `curl -fsSL https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | ${sudoEnv}bash -`,
      `${sudo}dnf -y install nodejs`,
    ].join(' && ');
  }

  if (['centos', 'rhel', 'rocky', 'almalinux'].includes(id) || like.includes('rhel')) {
    const pkg = commandExists('dnf') ? 'dnf' : 'yum';
    return [
      rpmNodeRemovalCommand(pkg),
      `${sudo}${pkg} -y module reset nodejs || true`,
      `${sudo}${pkg} -y install ca-certificates curl`,
      `curl -fsSL https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | ${sudoEnv}bash -`,
      `${sudo}${pkg} -y install nodejs`,
    ].join(' && ');
  }

  if (id === 'arch' || like.includes('arch')) return `${sudo}pacman -Sy --noconfirm nodejs npm`;
  if (id === 'alpine') return `${sudo}apk add --no-cache nodejs npm`;
  return '';
}

function rpmNodeRemovalCommand(pkg) {
  // Fedora can install versioned Node.js packages such as nodejs22-bin and
  // nodejs22-npm-bin. Removing only "nodejs npm" leaves file conflicts with
  // NodeSource's nodejs package, so remove whichever RPMs own the binaries.
  const sudo = sudoPrefix();
  const manager = pkg === 'yum' ? 'yum' : 'dnf';
  const removeOwners = [
    'rpm -q --whatprovides /usr/bin/node /usr/bin/npm /usr/bin/npx 2>/dev/null',
    'sort -u',
    `xargs -r ${sudo}${manager} -y remove`,
  ].join(' | ');
  return [
    `${removeOwners} || true`,
    `${sudo}${manager} -y remove nodejs npm nodejs*-bin nodejs*-npm-bin || true`,
  ].join(' && ');
}

async function ensureLatestNpm(osInfo) {
  const before = await captureShell('npm --version 2>/dev/null');
  if (before.code !== 0 || !before.stdout) {
    console.log(color('red', 'npm is not available after Node.js preparation.'));
    return false;
  }

  const latest = await captureShell('npm view npm version 2>/dev/null');
  if (latest.code !== 0 || !latest.stdout) {
    console.log(color('yellow', 'Could not check the latest npm version from the npm registry. Continuing with the installed npm version.'));
    if (latest.stderr) console.log(color('yellow', latest.stderr));
    console.log(color('green', `✓ npm is available: ${before.stdout}`));
    return true;
  }

  if (compareVersions(before.stdout, latest.stdout) >= 0) {
    console.log(color('green', `✓ npm is up to date: ${before.stdout}`));
    return true;
  }

  console.log(color('yellow', `npm ${before.stdout} detected. Updating npm to ${latest.stdout}.`));
  if (!(await ensureSudoAccess())) return false;
  const result = await runShellQuiet(`${sudoCommand('npm install -g npm@latest --no-fund --no-audit')}`, 'Updating npm to latest');
  if (result.code !== 0) {
    console.log(color('yellow', 'npm could not be updated automatically. Continuing with the installed npm version.'));
    if (result && result.logPath) console.log(color('yellow', `Full log: ${result.logPath}`));
    if (result && result.tail) {
      console.log(color('yellow', 'Last log lines:'));
      console.log(result.tail);
    }
    console.log(color('green', `✓ npm is available: ${before.stdout}`));
    return true;
  }

  const after = await captureShell('npm --version 2>/dev/null');
  if (after.code !== 0 || !after.stdout || compareVersions(after.stdout, latest.stdout) < 0) {
    console.log(color('yellow', `npm was not updated to the expected latest version (${latest.stdout}). Continuing with ${before.stdout}.`));
    return true;
  }

  console.log(color('green', `✓ npm updated and verified: ${after.stdout}`));
  return true;
}

async function ensureSystemNode(osInfo) {
  // The project uses the system Node.js installation rather than bundling a
  // version manager. setup can install Node where a supported package path exists.
  const nodeInfo = await getSystemNodeInfo();
  if (nodeInfo && !nodeInfo.isProjectLocal && nodeInfo.major >= REQUIRED_NODE_MAJOR && nodeInfo.npmVersion) {
    console.log(color('green', `✓ System Node.js detected: ${nodeInfo.version} (${nodeInfo.location})`));
    console.log(color('green', `✓ npm detected: ${nodeInfo.npmVersion}`));
    return ensureLatestNpm(osInfo);
  }

  if (nodeInfo && nodeInfo.isProjectLocal) {
    console.log(color('yellow', `⚠ Project-local Node.js detected (${nodeInfo.location}); it will be ignored for VPS preparation.`));
  } else if (nodeInfo) {
    const reason = nodeInfo.major >= REQUIRED_NODE_MAJOR && !nodeInfo.npmVersion
      ? 'npm is not available'
      : `System Node.js is outdated: ${nodeInfo.version}. Required: >= ${REQUIRED_NODE_MAJOR}`;
    console.log(color('yellow', `⚠ ${reason}; Node ${REQUIRED_NODE_MAJOR} with npm will be installed.`));
  } else {
    console.log(color('yellow', `System Node.js is not installed. Node ${REQUIRED_NODE_MAJOR} will be installed.`));
  }

  const installCommand = nodeInstallCommand(osInfo);
  if (!installCommand) {
    console.log(color('red', `No automatic Node.js install recipe is available for ${osInfo.prettyName}.`));
    return false;
  }
  if (!(await ensureSudoAccess())) return false;

  if (!(await runManagedSystemTask(`Installing Node.js ${REQUIRED_NODE_MAJOR}`, installCommand, osInfo))) return false;

  const installed = await getSystemNodeInfo();
  const ok = installed && !installed.isProjectLocal && installed.major >= REQUIRED_NODE_MAJOR && installed.npmVersion;
  if (ok) {
    console.log(color('green', `✓ Node.js installed and verified: ${installed.version} (${installed.location})`));
    console.log(color('green', `✓ npm installed and verified: ${installed.npmVersion}`));
  } else {
    console.log(installed && installed.major >= REQUIRED_NODE_MAJOR
      ? color('red', `Node.js is ${installed.version}, but npm is not available.`)
      : color('red', `Node.js was not verified with version >= ${REQUIRED_NODE_MAJOR}.`));
    console.log(color('yellow', repairSuggestion(osInfo)));
  }
  if (!ok) return false;
  return ensureLatestNpm(osInfo);
}

async function ensureDocker(osInfo) {
  // Docker is required for the recommended VPS profile. Validating it here makes
  // the final deployment instructions actionable.
  const runtime = runtimeEnvironment(osInfo);
  if (commandExists('docker')) {
    const dockerVersion = await captureShell('docker --version');
    const composeVersion = await captureShell('docker compose version');
    console.log(color('green', `✓ Docker detected: ${dockerVersion.stdout || 'docker installed'}`));
    if (composeVersion.code !== 0) {
      console.log(color('yellow', '⚠ Docker is installed, but the docker compose plugin was not detected.'));
      return false;
    }
    console.log(color('green', `✓ Docker Compose detected: ${composeVersion.stdout}`));
    return ensureDockerDaemon(osInfo);
  }

  if (runtime.isWsl && !runtime.hasSystemd) {
    console.log(color('yellow', `Docker was not found in ${runtimeLabel(runtime)}.`));
    console.log(color('yellow', dockerRepairSuggestion(osInfo)));
    return false;
  }

  console.log(color('yellow', 'Docker is not installed. Docker Engine will be installed from the official repository when the distro is supported.'));
  const installCommand = dockerInstallCommand(osInfo);
  if (!installCommand) {
    console.log(color('red', `No automatic Docker install recipe is available for ${osInfo.prettyName}.`));
    console.log('Install Docker manually and run setup.js again.');
    return false;
  }
  if (!(await ensureSudoAccess())) return false;

  if (!(await runManagedSystemTask('Installing Docker Engine', installCommand, osInfo))) return false;

  const dockerVersion = await captureShell('docker --version');
  const composeVersion = await captureShell('docker compose version');
  const ok = dockerVersion.code === 0 && composeVersion.code === 0 && await ensureDockerDaemon(osInfo);
  console.log(ok
    ? color('green', `✓ Docker installed and verified: ${dockerVersion.stdout}; ${composeVersion.stdout}`)
    : color('red', 'Docker was installed, but verification failed.'));
  if (!ok) console.log(color('yellow', dockerRepairSuggestion(osInfo)));
  return ok;
}

async function ensureDockerDaemon(osInfo) {
  if (!(await ensureSudoAccess())) return false;
  const infoCommand = sudoCommand('docker info >/dev/null 2>&1');
  const before = await captureShell(infoCommand);
  if (before.code === 0) {
    console.log(color('green', '✓ Docker daemon is running.'));
    return true;
  }

  console.log(color('yellow', 'Docker is installed, but the daemon is not running. Starting Docker service.'));
  const service = await startDockerService(osInfo);
  if (service.code !== 0) {
    printDockerFailure('Starting Docker service', service, osInfo);
    return false;
  }

  const after = await captureShell(infoCommand);
  if (after.code === 0) {
    console.log(color('green', '✓ Docker daemon started and verified.'));
    return true;
  }

  console.log(color('red', 'Docker service was started, but the daemon still did not answer to docker info.'));
  console.log(color('yellow', dockerRepairSuggestion(osInfo)));
  return false;
}

async function startDockerService(osInfo) {
  const sudo = sudoPrefix();
  const runtime = runtimeEnvironment(osInfo);
  if (runtime.hasSystemd) {
    return runShellQuiet(`${sudo}systemctl enable --now docker`, 'Starting Docker service');
  }
  if (runtime.isWsl) {
    return {
      code: 1,
      logPath: '',
      tail: dockerServiceManagerMissingMessage(osInfo),
    };
  }
  if (runtime.hasOpenRc) {
    return runShellQuiet(`${sudo}rc-update add docker default || true; ${sudo}rc-service docker start`, 'Starting Docker service');
  }
  if (runtime.hasService) {
    return runShellQuiet(`${sudo}service docker start`, 'Starting Docker service');
  }
  if (commandExists('dockerd')) {
    return startDockerdFallback(osInfo);
  }
  return {
    code: 1,
    logPath: '',
    tail: dockerServiceManagerMissingMessage(osInfo),
  };
}

async function startDockerdFallback(osInfo) {
  const logPath = path.join(os.tmpdir(), 'livechat-pro-dockerd.log');
  const sudo = sudoPrefix();
  const startCommand = `${sudo}sh -c ${shellQuote(`nohup dockerd > ${shellQuote(logPath)} 2>&1 < /dev/null &`)}`;
  const start = await runShellQuiet(startCommand, 'Starting Docker daemon with dockerd');
  if (start.code !== 0) return start;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const info = await captureShell(`${sudoCommand('docker info >/dev/null 2>&1')}`);
    if (info.code === 0) {
      return { code: 0, logPath, tail: `dockerd started successfully. Log: ${logPath}` };
    }
    await sleep(1000);
  }

  return {
    code: 1,
    logPath,
    tail: [
      `dockerd was started in the background, but Docker did not become ready within 20 seconds.`,
      `dockerd log: ${logPath}`,
      tailFile(logPath, 18) || dockerServiceManagerMissingMessage(osInfo),
    ].join('\n'),
  };
}

function dockerServiceManagerMissingMessage(osInfo) {
  if (isWsl()) {
    return [
      `Docker cannot be started with Linux init scripts inside this WSL distro (${osInfo.prettyName}).`,
      'Use Docker Desktop WSL integration, enable systemd in WSL, or choose local Node mode.',
    ].join('\n');
  }
  return `No supported service manager was detected on ${osInfo.prettyName}. Start Docker manually, then run setup.js again.`;
}

function tailFile(filePath, maxLines) {
  try {
    return tailText(fs.readFileSync(filePath, 'utf8'), maxLines);
  } catch (error) {
    return '';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkPortListening(port) {
  const ss = await captureShell(`ss -ltn 2>/dev/null | awk '{print $4}' | grep -E '(^|:)${port}$'`);
  if (ss.code === 0 && ss.stdout) return true;
  const netstat = await captureShell(`netstat -ltn 2>/dev/null | awk '{print $4}' | grep -E '(^|:)${port}$'`);
  return netstat.code === 0 && !!netstat.stdout;
}

async function openFirewallPorts() {
  // Firewall opening is best-effort and limited to common Linux firewalls.
  if (isWsl()) {
    console.log('\n' + color('bright', 'Firewall and public ports'));
    console.log(color('yellow', 'WSL detected. Skipping Linux firewall changes; expose ports through Windows/Docker Desktop if needed.'));
    return;
  }

  console.log('\n' + color('bright', 'Firewall and public ports'));
  const publicPort = 8080;
  const publicPortRule = `${publicPort}/tcp`;
  for (const port of [publicPort]) {
    const busy = await checkPortListening(port);
    console.log(busy
      ? color('yellow', `⚠ Port ${port} is already used by another process.`)
      : color('green', `✓ Port ${port} appears to be available.`));
  }

  const sudo = sudoPrefix();
  if (commandExists('ufw')) {
    if (!(await ensureSudoAccess())) return;
    await runShell(`${sudo}ufw allow ${publicPortRule}`);
    console.log(color('green', `✓ UFW rule applied for ${publicPortRule}.`));
    return;
  }

  const firewalldState = await captureShell('firewall-cmd --state 2>/dev/null');
  if (commandExists('firewall-cmd') && firewalldState.code === 0) {
    if (!(await ensureSudoAccess())) return;
    await runShell(`${sudo}firewall-cmd --permanent --add-port=${publicPortRule} && ${sudo}firewall-cmd --reload`);
    console.log(color('green', `✓ firewalld rule applied for ${publicPortRule}.`));
    return;
  }

  console.log(color('yellow', `⚠ No active UFW or firewalld firewall was detected. If your VPS uses a cloud firewall, open ${publicPortRule} in the provider panel.`));
}

async function preflightSystem() {
  if (!shouldRunSystemChecks) {
    console.log(color('yellow', 'System checks skipped because LIVECHAT_SKIP_SYSTEM_CHECKS=1.'));
    return;
  }

  console.log(color('bright', 'Base environment validation'));
  const osInfo = parseOsRelease();
  const runtime = runtimeEnvironment(osInfo);
  console.log(color('blue', `Detected system: ${osInfo.prettyName}`));
  console.log(color('blue', `Detected runtime: ${runtimeLabel(runtime)}`));
  if (!(await ensureSystemNode(osInfo))) {
    throw new Error('Node.js preparation failed. Fix the package manager issue above and run the LiveChat Pro install command again.');
  }
  console.log(fs.existsSync(path.join(ROOT, 'package-lock.json'))
    ? color('green', '✓ package-lock.json found.')
    : color('yellow', '⚠ package-lock.json was not found; npm ci will not be reproducible.'));
}

function normalizeOrigins(input) {
  // CORS origins are stored as a clean comma-separated list. "*" remains the
  // default for simple widget embedding during setup.
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
  // Prefer an explicit public origin; otherwise fall back to localhost for the
  // generated snippets shown at the end of setup.
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
    } catch (error) {
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
  // This is the exact script tag expected by widget.js: data-server points to the
  // LiveChat Pro backend and data-api-key is optional.
  const keyAttr = apiKey ? ` data-api-key="${apiKey.replace(/"/g, '&quot;')}"` : '';
  return `<script src="${baseUrl}/widget.js" data-server="${baseUrl}"${keyAttr}></script>`;
}

function hiddenWidgetOpenSnippet() {
  return '<button type="button" onclick="document.getElementById(\'lcp-btn\')?.click()">Open chat</button>';
}

async function chooseDeploymentProfile() {
  console.log('\n' + color('blue', 'Deployment profile'));
  console.log('   [1] Public VPS with Docker (recommended: HOST_PORT=8080, keeps 80/443 free)');
  console.log('   [2] Development/local or custom port');
  const choice = await ask(color('yellow', '   Choose an option [1]: '));
  return choice === '2' ? 'custom' : 'vps-docker';
}

async function chooseRunMode(recommendedMode = 'local') {
  console.log('\n' + color('blue', 'Startup mode'));
  const localMarker = recommendedMode === 'local' ? '  ← recommended' : '';
  const dockerMarker = recommendedMode === 'docker' ? '  ← recommended' : '';
  console.log(`   [1] Local in background with npm install + nohup${localMarker}`);
  console.log(`   [2] Docker with sudo docker compose up -d${dockerMarker}`);
  console.log('   [3] Only generate .env, do not start now');
  const choice = await ask(color('yellow', `   Choose an option [${recommendedMode === 'docker' ? '2' : '1'}]: `));
  if (!choice) return recommendedMode;
  if (choice === '2') return 'docker';
  if (choice === '3') return 'none';
  return 'local';
}

async function main() {
  // Main orchestrates prompt collection, optional system preparation, .env
  // generation and final run/deploy guidance.
  header();
  if (setupLogger.path) console.log(color('blue', `Setup log: ${setupLogger.path}`));
  await preflightSystem();
  const defaults = mergeDefaults();

  if (fs.existsSync(LEGACY_CONFIG_PATH)) {
    console.log(color('magenta', 'Legacy config.json detected; its values are used as defaults when .env is missing them.'));
  }

  console.log(color('bright', 'Telegram'));
  console.log('  Create your bot by talking to @BotFather and copy the token.');
  console.log('  Token example: 123456789:ABCdefGhiJKlmNOpqrSTUvwxYZ');
  console.log('  To get your numeric ID you can message @userinfobot or @RawDataBot.');
  console.log('  ID example: 9031274104\n');

  const telegramToken = await askSecret(
    '1. Telegram bot token',
    defaults.TELEGRAM_TOKEN || '',
    value => /^\d+:[A-Za-z0-9_-]{20,}$/.test(value),
    'It must look like 123456789:ABC...'
  );
  const telegramAdminId = await askRequired(
    '2. Numeric Telegram admin ID',
    defaults.TELEGRAM_ADMIN_ID || '',
    value => /^\d+$/.test(value),
    'It must contain digits only.'
  );

  console.log('\n' + color('bright', 'Admin web panel'));
  const suggestedPassword = defaults.ADMIN_PANEL_PASSWORD || randomPassword();
  const adminPassword = await askSecret(
    '3. /admin panel password',
    suggestedPassword,
    value => String(value).length >= 8,
    'Use at least 8 characters; 12 or more is recommended.'
  );
  if (adminPassword.length < 12) {
    console.log(color('yellow', '  Recommendation: use 12+ characters for production.'));
  }

  const adminLanguageOption = await choose(
    '4. Language used for translated admin messages',
    ADMIN_LANGUAGES,
    defaults.ADMIN_LANGUAGE || 'es'
  );

  console.log('\n' + color('bright', 'Chat widget'));
  const colorOption = await choose('5. Main chat color', COLOR_OPTIONS, defaults.WIDGET_PRIMARY_COLOR || '#4F46E5');
  let widgetPrimaryColor = colorOption.value;
  if (!widgetPrimaryColor) {
    widgetPrimaryColor = await askRequired(
      '   Custom hexadecimal color',
      defaults.WIDGET_PRIMARY_COLOR || '#4F46E5',
      isValidHexColor,
      'Valid example: #4F46E5'
    );
  }

  const styleOption = await choose('6. Widget button style', [
    { key: '1', name: 'Floating in the bottom-right corner', value: 'floating' },
    { key: '2', name: 'Persistent bottom bar', value: 'persistent' },
    { key: '3', name: 'Hidden, opened by custom code', value: 'hidden' },
  ], defaults.WIDGET_BUTTON_STYLE || 'floating');

  console.log('\n' + color('blue', '7. Welcome message'));
  console.log('   Leave empty to use the automatic greeting based on the browser language (es/en/pt).');
  if (defaults.WIDGET_WELCOME_MESSAGE) {
    console.log(`   Current fixed message detected: ${defaults.WIDGET_WELCOME_MESSAGE}`);
  }
  const widgetWelcomeMessage = await ask(color('yellow', '   Fixed message (Enter = automatic multilingual): '));

  console.log('\n' + color('bright', 'Server'));
  const detectedPublicIp = await detectPublicIp();
  if (detectedPublicIp) {
    console.log(color('green', `✓ Public IP detected for VPS setup: ${detectedPublicIp}`));
  } else {
    console.log(color('yellow', '⚠ The public IP could not be detected automatically. You can set LIVECHAT_PUBLIC_IP before running setup.js.'));
  }
  const deploymentProfile = await chooseDeploymentProfile();
  const recommendedRunMode = deploymentProfile === 'vps-docker' ? 'docker' : 'local';
  let port = defaults.PORT || '3000';
  let hostPort = defaults.HOST_PORT || '8080';

  if (deploymentProfile === 'vps-docker') {
    console.log(color('green', `✓ Public VPS with Docker selected: PORT=${port} inside the container and HOST_PORT=${hostPort} exposed to the internet.`));
  } else {
    console.log('   In Docker, HOST_PORT=8080 and PORT=3000 inside the container are recommended so 80/443 stay free.');
    port = await askRequired('8. Internal app port', defaults.PORT || '3000', value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536, 'Use a port between 1 and 65535.');
    hostPort = await askRequired('9. Public VPS port for Docker', defaults.HOST_PORT || '8080', value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536, 'Use a port between 1 and 65535.');
  }
  console.log('   Enter your real domain for CORS. Examples: example.com, https://chat.example.com');
  console.log('   If you leave it empty, the VPS public IP will be used for development.');
  const originDefault = defaults.ALLOWED_ORIGINS && defaults.ALLOWED_ORIGINS !== '*'
    ? defaults.ALLOWED_ORIGINS
    : (detectedPublicIp ? `http://${detectedPublicIp}` : '*');
  const domainInput = await ask(color('yellow', `10. Real domain / allowed origins [${originDefault}]: `));
  const allowedOrigins = domainInput
    ? normalizeOrigins(domainInput)
    : publicOriginFromDomainOrIp(defaults.ALLOWED_ORIGINS === '*' ? '' : defaults.ALLOWED_ORIGINS, detectedPublicIp);
  const widgetApiKey = await ask('11. Optional widget API key (Enter to disable): ') || defaults.WIDGET_API_KEY || '';
  const translationProviderOption = await choose(
    '12. Translation provider',
    TRANSLATION_PROVIDERS,
    defaults.TRANSLATION_PROVIDER || 'google_free'
  );
  const translationApiKey = translationProviderOption.code === 'google_free'
    ? ''
    : await ask(`   API key for ${translationProviderOption.name} (Enter to leave pending): `) || defaults.TRANSLATION_API_KEY || '';

  const smartBotOption = await choose('13. Smart bot mode', [
    { key: '1', code: 'disabled', name: 'Disabled — no bot, all messages go directly to Telegram (default)' },
    { key: '2', code: 'knowledge-base', name: 'Knowledge-base bot — answers from data/knowledge-base.json (no API needed)' },
    { key: '3', code: 'ai', name: 'AI bot (OpenAI) — GPT-powered responses (requires API key)' },
  ], defaults.BOT_MODE || 'disabled');
  let botConfidenceThreshold = defaults.BOT_CONFIDENCE_THRESHOLD || '0.6';
  let botNotifyAdmin = defaults.BOT_NOTIFY_ADMIN || 'false';
  let openaiApiKey = defaults.OPENAI_API_KEY || '';
  let openaiModel = defaults.OPENAI_MODEL || 'gpt-4o-mini';
  let openaiMaxTokens = defaults.OPENAI_MAX_TOKENS || '300';
  let botSystemPrompt = defaults.BOT_SYSTEM_PROMPT || "You are a friendly support assistant. Be brief and reply in the user's language.";
  if (smartBotOption.code === 'knowledge-base') {
    botConfidenceThreshold = await askRequired('   BOT_CONFIDENCE_THRESHOLD', botConfidenceThreshold, value => !Number.isNaN(Number(value)) && Number(value) >= 0 && Number(value) <= 1, 'Use a number between 0.0 and 1.0.');
    botNotifyAdmin = String(await chooseYesNo('   Notify admin when bot replies?', botNotifyAdmin === 'true'));
    const kbExample = path.join(ROOT, 'data', 'knowledge-base.json.example');
    const kbTarget = path.join(ROOT, 'data', 'knowledge-base.json');
    if (!fs.existsSync(kbTarget) && fs.existsSync(kbExample)) {
      fs.mkdirSync(path.dirname(kbTarget), { recursive: true });
      fs.copyFileSync(kbExample, kbTarget);
      console.log(color('green', '✓ Created data/knowledge-base.json. Edit it to add your FAQ entries.'));
    }

    console.log('\n' + color('bright', 'Knowledge Base Training'));
    console.log('  The kb-trainer script can populate your knowledge base automatically.');
    console.log('  It supports URLs, local files, and optional AI enhancement (OpenRouter/OpenAI/Ollama).');
    console.log('  You can run it now or later with: node kb-trainer/index.js --help\n');

    const runTrainer = await chooseYesNo('Would you like to run the kb-trainer to populate your knowledge base now?', false);
    if (runTrainer) {
      const trainerProviderOption = await choose('AI provider for training (optional)', [
        { key: '1',  code: 'none',      name: 'No AI — extract structure from content only (free, no key)' },
        { key: '2',  code: 'openrouter',name: 'OpenRouter — free models available (recommended)' },
        { key: '3',  code: 'groq',      name: 'Groq — ultra-fast, free tier (llama, mixtral)' },
        { key: '4',  code: 'gemini',    name: 'Google Gemini — free quota (gemini-1.5-flash)' },
        { key: '5',  code: 'openai',    name: 'OpenAI — GPT models (gpt-4o-mini, etc.)' },
        { key: '6',  code: 'xai',       name: 'xAI — Grok models' },
        { key: '7',  code: 'anthropic', name: 'Anthropic — Claude models' },
        { key: '8',  code: 'mistral',   name: 'Mistral AI — Mistral models' },
        { key: '9',  code: 'cohere',    name: 'Cohere — Command models' },
        { key: '10', code: 'ollama',    name: 'Ollama — local models (no key, requires Ollama running)' },
        { key: '11', code: 'custom',    name: 'Custom — any OpenAI-compatible endpoint (LM Studio, etc.)' },
      ], 'none');

      const noKeyProviders = ['none', 'ollama', 'custom'];
      let trainerKey = '';
      let trainerModel = '';
      let trainerBaseUrl = '';

      const providerDefaults = {
        openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
        openai:     'gpt-4o-mini',
        xai:        'grok-beta',
        groq:       'llama-3.1-8b-instant',
        anthropic:  'claude-3-haiku-20240307',
        gemini:     'gemini-1.5-flash',
        mistral:    'mistral-small-latest',
        cohere:     'command-r',
        ollama:     'llama3',
        custom:     'local-model',
      };

      const prov = trainerProviderOption.code;
      if (!noKeyProviders.includes(prov)) {
        trainerKey = await askSecret(`   ${trainerProviderOption.name} API key`, '', null, '');
      }
      if (prov === 'custom') {
        trainerBaseUrl = await ask('   Base URL (e.g. http://localhost:1234/v1): ');
      }
      if (prov !== 'none') {
        const defModel = providerDefaults[prov] || '';
        trainerModel = await ask(`   Model [${defModel}]: `) || defModel;
      }

      const trainerUrls = await ask('   URLs or file paths (comma-separated, Enter to skip): ');

      if (trainerUrls.trim()) {
        const trainerArgs = ['kb-trainer/index.js', '--mode', 'replace', '--lang', adminLanguageOption.code, '--urls', trainerUrls.trim()];
        if (trainerProviderOption.code !== 'none') {
          trainerArgs.push('--provider', trainerProviderOption.code);
          if (trainerKey) trainerArgs.push('--key', trainerKey);
          if (trainerModel) trainerArgs.push('--model', trainerModel);
          if (trainerBaseUrl) trainerArgs.push('--base-url', trainerBaseUrl);
        }
        console.log(color('blue', '\nRunning kb-trainer...'));
        const trainerCode = await runCommand('node', trainerArgs);
        console.log(trainerCode === 0
          ? color('green', '✓ Knowledge base populated successfully.')
          : color('yellow', '⚠ kb-trainer finished with warnings. Check data/knowledge-base.json.'));
      } else {
        console.log(color('yellow', 'No URLs provided. Run the trainer later: node kb-trainer/index.js --help'));
      }
    }
  } else if (smartBotOption.code === 'ai') {
    openaiApiKey = await askSecret('   OPENAI_API_KEY', openaiApiKey, value => String(value).length > 10, 'OpenAI API key is required for AI mode.');
    openaiModel = await askRequired('   OPENAI_MODEL', openaiModel, value => !!String(value).trim(), 'Model cannot be empty.');
    openaiMaxTokens = await askRequired('   OPENAI_MAX_TOKENS', openaiMaxTokens, value => /^\d+$/.test(value) && Number(value) > 0, 'Use a positive integer.');
    botSystemPrompt = await ask('   BOT_SYSTEM_PROMPT (Enter for default): ') || botSystemPrompt;
    botNotifyAdmin = String(await chooseYesNo('   Notify admin when bot replies?', botNotifyAdmin === 'true'));
  }

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
    botMode: smartBotOption.code,
    openaiApiKey,
    openaiModel,
    openaiMaxTokens,
    botSystemPrompt,
    botConfidenceThreshold,
    botContextMessages: defaults.BOT_CONTEXT_MESSAGES || '6',
    botNotifyAdmin,
    redisUrl: defaults.REDIS_URL || '',
    redisKeyPrefix: defaults.REDIS_KEY_PREFIX || 'lcp',
  };

  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await chooseYesNo(`\n${ENV_PATH} already exists. Overwrite it?`, true);
    if (!overwrite) {
      console.log(color('yellow', 'Installation canceled without modifying .env.'));
      if (rl) rl.close();
      return;
    }
  }

  fs.writeFileSync(ENV_PATH, buildEnv(config), 'utf8');
  console.log('\n' + color('green', `✓ Configuration written to ${ENV_PATH}`));

  const mode = await chooseRunMode(recommendedRunMode);
  let finalCommand = localStartCommand();
  let startupSucceeded = true;

  if (mode === 'docker') {
    finalCommand = sudoCommand('docker compose up -d');
    const osInfo = parseOsRelease();
    if (!(await ensureDocker(osInfo))) {
      startupSucceeded = false;
      console.log(color('yellow', 'Docker is not ready. The .env file was generated, but the application was not started.'));
    } else {
      if (deploymentProfile === 'vps-docker') await openFirewallPorts();
      if (await chooseYesNo('Build and start now with Docker?', true)) {
        const dockerCommand = sudoArgs('docker', ['compose', 'up', '-d', '--build']);
        const code = await runCommand(dockerCommand.command, dockerCommand.args);
        startupSucceeded = code === 0;
        console.log(startupSucceeded ? color('green', '✓ Docker started successfully.') : color('red', 'Docker exited with errors. Review the output above.'));
      }
    }
  } else if (mode === 'local') {
    finalCommand = localStartCommand();
    const needsDependencies = !fs.existsSync(path.join(ROOT, 'node_modules'));
    const installPrompt = needsDependencies
      ? 'node_modules was not found. Install dependencies with sudo npm install?'
      : 'Refresh local dependencies with sudo npm install before starting?';
    if (await chooseYesNo(installPrompt, true)) {
      const npmInstallCommand = sudoArgs('npm', ['install']);
      const installCode = await runCommand(npmInstallCommand.command, npmInstallCommand.args);
      if (installCode !== 0) {
        console.log(color('red', 'npm install failed. Install dependencies successfully before starting local mode.'));
        return;
      }
    }
    if (await chooseYesNo('Start now in local mode?', false)) {
      console.log(color('blue', 'Starting local mode in the background...'));
      const started = await startLocalServerInBackground();
      if (!started) return;
    }
  } else {
    finalCommand = recommendedRunMode === 'docker' ? sudoCommand('docker compose up -d') : localStartCommand();
  }

  console.log('\n' + (startupSucceeded ? color('green', 'Installation ready.') : color('yellow', 'Configuration ready; startup still needs attention.')));
  console.log(color('bright', `Recommended final command: ${finalCommand}`));
  const shownPort = finalCommand.includes('docker compose') ? config.hostPort : config.port;
  const baseUrl = publicBaseUrl(config.allowedOrigins, shownPort);
  console.log(color('blue', `Widget demo: ${baseUrl}`));
  console.log(color('blue', `Visual healthcheck: ${baseUrl}/health`));
  console.log(color('blue', `Admin panel: ${baseUrl}/admin`));
  console.log('\n' + color('bright', 'Code to paste into your website'));
  console.log(color('cyan', widgetSnippet(baseUrl, config.widgetApiKey)));
  if (config.widgetButtonStyle === 'hidden') {
    console.log('\n' + color('bright', 'Custom button to open the hidden chat'));
    console.log(color('cyan', hiddenWidgetOpenSnippet()));
  }
  if (rl) rl.close();
}

main().then(() => {
  setupLogger.close();
}).catch(error => {
  console.error(color('red', error.stack || error.message));
  if (rl) rl.close();
  setupLogger.close();
  process.exitCode = 1;
});
