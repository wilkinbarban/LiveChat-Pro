#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const ENV_PATH = process.env.LIVECHAT_ENV_PATH || path.join(ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const color = (name, text) => `${COLORS[name] || ''}${text}${COLORS.reset}`;
const quoteEnv = value => JSON.stringify(String(value == null ? '' : value));

const SCRIPTED_INPUT = process.stdin.isTTY ? null : fs.readFileSync(0, 'utf8').split(/\r?\n/);
let rl = SCRIPTED_INPUT ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = question => {
  if (SCRIPTED_INPUT) {
    process.stdout.write(question + '\n');
    return Promise.resolve((SCRIPTED_INPUT.shift() || '').trim());
  }
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
};


const chooseYesNo = async (questionText, defaultValue = true) => {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(`${questionText} [${hint}]: `)).toLowerCase();
  if (!answer) return defaultValue;
  return ['y', 'yes', 's', 'si', 'sí'].includes(answer);
};

const maskSecret = value => {
  if (!value) return '';
  return value.length > 8 ? `${value.slice(0, 4)}...${value.slice(-4)}` : '********';
};

const randomPassword = () => {
  return crypto.randomBytes(16).toString('hex');
};

function commandExists(command) {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const paths = (process.env.PATH || '').split(delimiter);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  
  for (const dir of paths) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, command + ext);
      try {
        if (fs.existsSync(fullPath)) return true;
      } catch {}
    }
  }
  return false;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let rawValue = match[2].trim();
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || 
        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      rawValue = rawValue.slice(1, -1);
    }
    env[match[1]] = rawValue;
  }
  return env;
}

async function detectPublicIp() {
  const fromEnv = String(process.env.LIVECHAT_PUBLIC_IP || '').trim();
  if (fromEnv) return fromEnv;

  const fetchIp = (cmd) => {
    return new Promise(resolve => {
      const child = spawn(cmd.split(' ')[0], cmd.split(' ').slice(1), { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.on('close', code => {
        const ip = output.trim();
        if (code === 0 && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) resolve(ip);
        else resolve('');
      });
    });
  };

  for (const command of [
    'curl -fsS --max-time 3 https://api.ipify.org',
    'curl -fsS --max-time 3 https://ifconfig.me/ip'
  ]) {
    const ip = await fetchIp(command);
    if (ip) return ip;
  }
  return '';
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

const TEXTS = {
  en: {
    title: "LiveChat Pro — Environment Setup Wizard",
    desc: "This script configures the .env file for LiveChat Pro.",
    langPrompt: "Select Language / Selecciona el Idioma:",
    modePrompt: "Select Configuration Mode:",
    modeBasic: "Basic Setup (Core parameters only, recommended)",
    modeAll: "Full Setup (All 44 parameters from .env.example)",
    telegramSec: "1. Telegram Integration",
    teleToken: "Telegram Bot Token",
    teleAdmin: "Telegram Admin ID (numeric)",
    teleTimeout: "Telegram Startup Timeout (ms)",
    serverSec: "2. Server & Security",
    port: "Internal Node.js Port",
    hostPort: "Public Host Port (Docker)",
    nodeEnv: "Node Environment (production/development/test)",
    cors: "Allowed CORS Origins (comma-separated, e.g. example.com or * for all)",
    adminPass: "Admin Panel Password",
    adminLang: "Admin Panel Language (es, en, pt, fr, de, it)",
    adminSess: "Admin Session TTL (hours)",
    logLevel: "Log Level (trace, debug, info, warn, error, fatal, silent)",
    proxyHops: "Trusted Proxy Hops count",
    sameSite: "Cookie SameSite Policy (lax, strict, none)",
    widgetSec: "3. Widget",
    widgetApiKey: "Widget API Key (leave empty to disable validation)",
    settingsKey: "Settings encryption key (optional, 64 hex chars; empty = auto-generate)",
    featuresSec: "4. Features (true/false)",
    featTrans: "Enable Translation Feature",
    featSent: "Enable Sentiment Analysis Feature",
    featGhost: "Enable Ghost Typing Indicator Feature",
    featGeo: "Enable IP Geolocation Feature",
    transSec: "5. Translation Service",
    transProvider: "Translation Provider (google_free, deepl, google_cloud)",
    transKey: "Translation API Key (if using DeepL or Google Cloud)",
    transUrl: "DeepL API URL",
    rateSec: "6. Rate Limiting",
    rateWin: "Rate Limit Window (minutes)",
    ratePub: "Max Public API requests per window",
    rateAdm: "Max Admin API requests per window",
    rateLog: "Max Login attempts per window",
    rateUpWin: "Upload Rate Limit Window (minutes)",
    rateUpMax: "Max uploads per upload window",
    uploadSec: "7. File Uploads",
    maxUpload: "Max Upload Image Size (MB)",
    uploadDir: "Upload Directory path",
    allowedTypes: "Allowed Image MIME Types (comma-separated)",
    redisSec: "8. Redis Cache & Multi-node (Optional)",
    redisUrl: "Redis Connection URL (leave empty to disable)",
    redisPrefix: "Redis Key Prefix",
    redisEnabled: "Enable Redis scaling",
    confirmOverwrite: "already exists. Overwrite it?",
    setupCanceled: "Configuration canceled. No changes made.",
    writingConfig: "Writing configuration to .env...",
    success: "Configuration successfully created!",
    dockerSec: "Docker Service Start",
    dockerPrompt: "Do you want to build and start the server in Docker now?",
    dockerRunning: "Starting Docker Compose in the background...",
    dockerSuccess: "Docker started successfully! LiveChat Pro is running.",
    nodeSec: "Node.js Service Start",
    nodePrompt: "Do you want to start the server with Node now?",
    nodeRunning: "Starting Node.js server in the background...",
    nodeStarting: "Starting the server...",
    dockerFail: "Failed to start Docker Compose. Please check the logs above.",
    recommendedCmd: "Recommended final command to launch:",
    widgetSnippetTitle: "Snippet to paste into your HTML:",
    invalidVal: "Invalid value. Please try again.",
  },
  es: {
    title: "LiveChat Pro — Asistente de Configuración",
    desc: "Este script configura el archivo de entorno .env para LiveChat Pro.",
    langPrompt: "Select Language / Selecciona el Idioma:",
    modePrompt: "Selecciona el Modo de Configuración:",
    modeBasic: "Configuración Básica (Parámetros esenciales solamente, recomendado)",
    modeAll: "Configuración Completa (Todos los 44 parámetros de .env.example)",
    telegramSec: "1. Integración con Telegram",
    teleToken: "Token del Bot de Telegram",
    teleAdmin: "ID de Administrador de Telegram (numérico)",
    teleTimeout: "Tiempo Límite de Arranque del Bot (ms)",
    serverSec: "2. Servidor y Seguridad",
    port: "Puerto Interno de Node.js",
    hostPort: "Puerto Público del Host (Docker)",
    nodeEnv: "Entorno de Node (production/development/test)",
    cors: "Orígenes CORS Permitidos (separados por coma, ej. miweb.com o * para todos)",
    adminPass: "Contraseña del Panel Admin",
    adminLang: "Idioma del Panel Admin (es, en, pt, fr, de, it)",
    adminSess: "Duración de Sesión Admin (horas)",
    logLevel: "Nivel de Log (trace, debug, info, warn, error, fatal, silent)",
    proxyHops: "Número de saltos de Proxy de confianza",
    sameSite: "Política SameSite de Cookies (lax, strict, none)",
    widgetSec: "3. Widget",
    widgetApiKey: "Clave API del Widget (vacío para desactivar validación)",
    settingsKey: "Clave de cifrado de ajustes (opcional, 64 caracteres hex; vacío = autogenerar)",
    featuresSec: "4. Funcionalidades (true/false)",
    featTrans: "Activar Traducción Automática",
    featSent: "Activar Análisis de Sentimiento",
    featGhost: "Activar Indicador de Escritura Admin (Ghost Typing)",
    featGeo: "Activar Geolocalización por IP",
    transSec: "5. Servicio de Traducción",
    transProvider: "Proveedor de Traducción (google_free, deepl, google_cloud)",
    transKey: "Clave API del Traductor (si usas DeepL o Google Cloud)",
    transUrl: "URL de la API de DeepL",
    rateSec: "6. Rate Limiting (Límite de Peticiones)",
    rateWin: "Ventana de Rate Limit (minutos)",
    ratePub: "Máximo de peticiones API Públicas por ventana",
    rateAdm: "Máximo de peticiones API Admin por ventana",
    rateLog: "Máximo de intentos de Login por ventana",
    rateUpWin: "Ventana de Rate Limit de subida (minutos)",
    rateUpMax: "Máximo de subidas de archivos por ventana",
    uploadSec: "7. Subida de Archivos",
    maxUpload: "Tamaño Máximo de Imagen (MB)",
    uploadDir: "Carpeta de Subidas",
    allowedTypes: "Tipos de Imagen MIME Permitidos (separados por coma)",
    redisSec: "8. Servidor Redis y Multi-nodo (Opcional)",
    redisUrl: "URL de Conexión de Redis (vacío para desactivar)",
    redisPrefix: "Prefijo de claves de Redis",
    redisEnabled: "Activar escalado con Redis",
    confirmOverwrite: "ya existe. ¿Deseas sobrescribirlo?",
    setupCanceled: "Configuración cancelada. No se hicieron cambios.",
    writingConfig: "Escribiendo configuración en .env...",
    success: "¡Configuración creada con éxito!",
    dockerSec: "Arranque del Servicio en Docker",
    dockerPrompt: "¿Deseas compilar y arrancar el servidor en Docker ahora?",
    dockerRunning: "Iniciando Docker Compose en segundo plano...",
    dockerSuccess: "¡Docker iniciado con éxito! LiveChat Pro está corriendo.",
    nodeSec: "Arranque del Servicio con Node.js",
    nodePrompt: "¿Deseas arrancar el servidor con Node ahora?",
    nodeRunning: "Iniciando el servidor Node.js en segundo plano...",
    nodeStarting: "Iniciando el servidor...",
    dockerFail: "No se pudo iniciar Docker Compose. Revisa los logs superiores.",
    recommendedCmd: "Comando recomendado para arrancar manualmente:",
    widgetSnippetTitle: "Snippet de código para pegar en tu HTML:",
    invalidVal: "Valor inválido. Por favor, intenta de nuevo.",
  },
  pt: {
    title: "LiveChat Pro — Assistente de Configuração",
    desc: "Este script configura o arquivo de ambiente .env para o LiveChat Pro.",
    langPrompt: "Selecione o Idioma do Assistente:",
    modePrompt: "Selecione o Modo de Configuração:",
    modeBasic: "Configuração Básica (Apenas parâmetros essenciais, recomendado)",
    modeAll: "Configuração Completa (Todos os 44 parâmetros do .env.example)",
    telegramSec: "1. Integração com o Telegram",
    teleToken: "Token do Bot do Telegram",
    teleAdmin: "ID de Administrador do Telegram (numérico)",
    teleTimeout: "Tempo Limite de Inicialização do Telegram (ms)",
    serverSec: "2. Servidor e Segurança",
    port: "Porta Interna do Node.js",
    hostPort: "Porta Pública do Host (Docker)",
    nodeEnv: "Ambiente do Node (production/development/test)",
    cors: "Origens CORS Permitidas (separadas por vírgula, ex: site.com ou * para todos)",
    adminPass: "Senha do Painel Administrativo",
    adminLang: "Idioma do Painel Admin (es, en, pt, fr, de, it)",
    adminSess: "Duração da Sessão Admin (horas)",
    logLevel: "Nível de Log (trace, debug, info, warn, error, fatal, silent)",
    proxyHops: "Número de saltos de Proxy confiáveis",
    sameSite: "Política SameSite de Cookies (lax, strict, none)",
    widgetSec: "3. Widget",
    widgetApiKey: "Chave API do Widget (vazio para desativar validação)",
    settingsKey: "Chave de criptografia de ajustes (opcional, 64 caracteres hex; vazio = autogerar)",
    featuresSec: "4. Funcionalidades (true/false)",
    featTrans: "Ativar Recurso de Tradução",
    featSent: "Ativar Análise de Sentimento",
    featGhost: "Ativar Indicador de Digitação (Ghost Typing)",
    featGeo: "Ativar Geolocalização por IP",
    transSec: "5. Serviço de Tradução",
    transProvider: "Provedor de Tradução (google_free, deepl, google_cloud)",
    transKey: "Chave API do Tradutor (se usar DeepL ou Google Cloud)",
    transUrl: "URL da API do DeepL",
    rateSec: "6. Limite de Requisições (Rate Limiting)",
    rateWin: "Janela de Rate Limit (minutos)",
    ratePub: "Máximo de requisições públicas da API por janela",
    rateAdm: "Máximo de requisições do admin por janela",
    rateLog: "Máximo de tentativas de login por janela",
    rateUpWin: "Janela de Rate Limit para uploads (minutos)",
    rateUpMax: "Máximo de uploads por janela",
    uploadSec: "7. Upload de Arquivos",
    maxUpload: "Tamanho Máximo da Imagem (MB)",
    uploadDir: "Diretório de Uploads",
    allowedTypes: "Tipos MIME de Imagem Permitidos (separados por vírgula)",
    redisSec: "8. Servidor Redis e Multi-nó (Opcional)",
    redisUrl: "URL de Conexão do Redis (vazio para desativar)",
    redisPrefix: "Prefixo de Chave do Redis",
    redisEnabled: "Ativar escalonamento do Redis",
    confirmOverwrite: "já existe. Deseja sobrescrever?",
    setupCanceled: "Configuração cancelada. Nenhuma alteração feita.",
    writingConfig: "Escrevendo configuração no .env...",
    success: "Configuração criada com sucesso!",
    dockerSec: "Inicialização do Serviço Docker",
    dockerPrompt: "Deseja compilar e iniciar o servidor no Docker agora?",
    dockerRunning: "Iniciando Docker Compose em segundo plano...",
    dockerSuccess: "Docker iniciado com sucesso! LiveChat Pro está rodando.",
    nodeSec: "Inicialização do Serviço Node.js",
    nodePrompt: "Deseja iniciar o servidor com Node agora?",
    nodeRunning: "Iniciando o servidor Node.js em segundo plano...",
    nodeStarting: "Iniciando o servidor...",
    dockerFail: "Falha ao iniciar o Docker Compose. Verifique os logs acima.",
    recommendedCmd: "Comando recomendado para iniciar manualmente:",
    widgetSnippetTitle: "Snippet de código para colar no seu HTML:",
    invalidVal: "Valor inválido. Por favor, tente novamente.",
  }
};

let currentLang = 'en';
const t = (key) => TEXTS[currentLang][key] || key;

async function askQuestion(label, defaultValue, validator, mask = false) {
  while (true) {
    const displayDefault = mask ? maskSecret(defaultValue) : defaultValue;
    const suffix = displayDefault !== undefined && displayDefault !== '' ? ` [${displayDefault}]` : '';
    const answer = await ask(`${color('yellow', '   ' + label)}${suffix}: `);
    const finalVal = answer !== '' ? answer : defaultValue;
    
    if (!validator || validator(finalVal)) {
      return finalVal;
    }
    console.log(color('red', '     ⚠ ' + t('invalidVal')));
  }
}

async function askSelection(label, options, defaultValue) {
  console.log('\n' + color('cyan', '   ' + label));
  for (const opt of options) {
    const marker = opt.value === defaultValue ? '  ' + color('green', '← current') : '';
    console.log(`     [${opt.key}] ${opt.name}${marker}`);
  }
  while (true) {
    const ans = await ask(color('yellow', '     Choose option: '));
    if (ans === '') return defaultValue;
    const match = options.find(o => o.key === ans);
    if (match) return match.value;
    console.log(color('red', '     ⚠ ' + t('invalidVal')));
  }
}

function printSectionHeader(title) {
  console.log('\n' + color('bright', `  ── ${title} ` + '─'.repeat(Math.max(10, 50 - title.length))));
}

function spawnAndLog(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(__dirname, 'install.log');
    
    // Append the section header to the log file
    try {
      fs.appendFileSync(logPath, `\n=== Servidor ===\nIniciando comando: ${command} ${args.join(' ')}\nFecha: ${new Date().toISOString()}\n\n`);
    } catch (e) {
      console.error('Error escribiendo en install.log:', e.message);
    }

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    let isSpinnerRunning = process.stdout.isTTY && command === 'node';
    let spinnerFrame = 0;
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinnerInterval;

    if (isSpinnerRunning) {
      process.stdout.write('   Iniciando el servidor...  ');
      spinnerInterval = setInterval(() => {
        if (!isSpinnerRunning) return;
        readline.cursorTo(process.stdout, 28);
        process.stdout.write(color('cyan', spinnerFrames[spinnerFrame]));
        spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
      }, 80);
    }

    const stopSpinner = () => {
      if (isSpinnerRunning) {
        isSpinnerRunning = false;
        clearInterval(spinnerInterval);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }
    };

    const child = spawn(command, args, {
      ...options,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const handleOutput = (data, isErrorStream = false) => {
      stopSpinner();
      logStream.write(data);
      
      const str = data.toString();
      let buffer = isErrorStream ? stderrBuffer : stdoutBuffer;
      buffer += str;
      const lines = buffer.split(/\r?\n/);
      if (isErrorStream) {
        stderrBuffer = lines.pop();
      } else {
        stdoutBuffer = lines.pop();
      }
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && parsed.msg) {
            const timeStr = parsed.time ? `[${new Date(parsed.time).toLocaleTimeString()}] ` : '';
            let levelStr = '';
            let levelColor = 'reset';
            if (parsed.level === 10) { levelStr = 'TRACE'; levelColor = 'gray'; }
            else if (parsed.level === 20) { levelStr = 'DEBUG'; levelColor = 'cyan'; }
            else if (parsed.level === 30) { levelStr = 'INFO '; levelColor = 'green'; }
            else if (parsed.level === 40) { levelStr = 'WARN '; levelColor = 'yellow'; }
            else if (parsed.level === 50) { levelStr = 'ERROR'; levelColor = 'red'; }
            else if (parsed.level === 60) { levelStr = 'FATAL'; levelColor = 'red'; }
            
            const levelFormatted = levelStr ? `${color(levelColor, levelStr)}: ` : '';
            const errStr = parsed.err ? `\n${parsed.err.stack || JSON.stringify(parsed.err, null, 2)}` : '';
            
            process.stdout.write(`   ${color('gray', timeStr)}${levelFormatted}${parsed.msg}${errStr}\n`);
          } else {
            if (isErrorStream) {
              process.stderr.write(`   ${line}\n`);
            } else {
              process.stdout.write(`   ${line}\n`);
            }
          }
        } catch {
          if (isErrorStream) {
            process.stderr.write(`   ${line}\n`);
          } else {
            process.stdout.write(`   ${line}\n`);
          }
        }
      }
    };

    child.stdout.on('data', (data) => {
      handleOutput(data, false);
    });

    child.stderr.on('data', (data) => {
      handleOutput(data, true);
    });

    child.on('error', (err) => {
      stopSpinner();
      const errMsg = `Error al iniciar el proceso: ${err.message}\n`;
      process.stderr.write(errMsg);
      logStream.write(errMsg);
      logStream.end();
      reject(err);
    });

    child.on('close', (code) => {
      stopSpinner();
      
      const flushRemaining = (buffer, isErrorStream) => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            if (parsed && parsed.msg) {
              const timeStr = parsed.time ? `[${new Date(parsed.time).toLocaleTimeString()}] ` : '';
              process.stdout.write(`   ${color('gray', timeStr)}${parsed.msg}\n`);
            } else {
              if (isErrorStream) process.stderr.write(`   ${buffer}\n`);
              else process.stdout.write(`   ${buffer}\n`);
            }
          } catch {
            if (isErrorStream) process.stderr.write(`   ${buffer}\n`);
            else process.stdout.write(`   ${buffer}\n`);
          }
        }
      };
      
      flushRemaining(stdoutBuffer, false);
      flushRemaining(stderrBuffer, true);

      const exitMsg = `\nEl proceso terminó con el código: ${code}\n`;
      logStream.write(exitMsg);
      logStream.end();
      resolve(code);
    });
  });
}

async function main() {
  // Clear console
  if (!process.env.LIVECHAT_SETUP_NO_CLEAR) console.clear();
  
  // Header
  console.log(color('cyan', '┌──────────────────────────────────────────────────────────┐'));
  console.log(color('cyan', '│') + color('bright', '             LiveChat Pro — Setup Wizard                  ') + color('cyan', '│'));
  console.log(color('cyan', '└──────────────────────────────────────────────────────────┘'));
  
  // Language Prompt
  console.log('\n   Select Wizard Language / Selecciona el Idioma del Asistente / Selecione o Idioma do Assistente:');
  console.log('     [1] English');
  console.log('     [2] Español');
  console.log('     [3] Português');
  const langChoice = await ask(color('yellow', '   Choose / Elige / Escolha [1]: '));
  currentLang = langChoice === '2' ? 'es' : (langChoice === '3' ? 'pt' : 'en');

  console.log('\n' + color('gray', '   ' + t('desc')));

  const defaults = {
    // 1. Telegram
    TELEGRAM_TOKEN: '',
    TELEGRAM_ADMIN_ID: '',
    TELEGRAM_LAUNCH_TIMEOUT_MS: '15000',
    // 2. Server
    PORT: '3000',
    HOST_PORT: '8080',
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: '',
    ADMIN_PANEL_PASSWORD: randomPassword(),
    ADMIN_LANGUAGE: currentLang,
    ADMIN_SESSION_TTL_HOURS: '12',
    LOG_LEVEL: 'info',
    TRUST_PROXY_HOPS: '1',
    COOKIE_SAME_SITE: 'lax',
    SETTINGS_KEY: '',
    // 3. Widget
    WIDGET_API_KEY: '',
    // 4. Features
    FEATURE_TRANSLATION: 'true',
    FEATURE_SENTIMENT: 'true',
    FEATURE_GHOST_TYPING: 'true',
    FEATURE_GEOLOCATION: 'true',
    // 5. Translation
    TRANSLATION_PROVIDER: 'google_free',
    TRANSLATION_API_KEY: '',
    DEEPL_API_URL: 'https://api.deepl.com/v2/translate',
    // 6. Rate limit
    RATE_LIMIT_WINDOW_MINUTES: '15',
    RATE_LIMIT_PUBLIC_MAX: '300',
    RATE_LIMIT_ADMIN_MAX: '2000',
    RATE_LIMIT_LOGIN_MAX: '20',
    RATE_LIMIT_UPLOAD_WINDOW_MINUTES: '1',
    RATE_LIMIT_UPLOAD_MAX: '10',
    // 7. Image Attachments
    MAX_UPLOAD_MB: '5',
    UPLOAD_DIR: 'data/uploads',
    ALLOWED_IMAGE_TYPES: 'image/jpeg,image/png,image/webp,image/gif',
    // 8. Redis
    REDIS_URL: '',
    REDIS_KEY_PREFIX: 'lcp',
    REDIS_ENABLED: process.platform === 'win32' ? 'false' : 'true',
  };

  // Merge existing config
  const existing = parseEnvFile(ENV_PATH);
  const parsedExample = parseEnvFile(ENV_EXAMPLE_PATH);
  
  const mergedDefaults = { ...defaults, ...parsedExample, ...existing };

  // Setup mode selection
  const configMode = await askSelection(t('modePrompt'), [
    { key: '1', name: t('modeBasic'), value: 'basic' },
    { key: '2', name: t('modeAll'), value: 'all' }
  ], 'basic');

  const answers = {};

  // Group 1: Telegram (Always prompt Telegram Token and Admin ID)
  printSectionHeader(t('telegramSec'));
  answers.TELEGRAM_TOKEN = await askQuestion(
    t('teleToken'),
    mergedDefaults.TELEGRAM_TOKEN,
    val => /^\d+:[A-Za-z0-9_-]{20,}$/.test(val),
    true
  );
  answers.TELEGRAM_ADMIN_ID = await askQuestion(
    t('teleAdmin'),
    mergedDefaults.TELEGRAM_ADMIN_ID,
    val => /^\d+$/.test(val)
  );

  if (configMode === 'all') {
    answers.TELEGRAM_LAUNCH_TIMEOUT_MS = await askQuestion(
      t('teleTimeout'),
      mergedDefaults.TELEGRAM_LAUNCH_TIMEOUT_MS,
      val => /^\d+$/.test(val)
    );
  } else {
    answers.TELEGRAM_LAUNCH_TIMEOUT_MS = mergedDefaults.TELEGRAM_LAUNCH_TIMEOUT_MS;
  }

  // Group 2: Server (Always prompt Admin password and Allowed origins)
  printSectionHeader(t('serverSec'));
  
  answers.ADMIN_PANEL_PASSWORD = await askQuestion(
    t('adminPass'),
    mergedDefaults.ADMIN_PANEL_PASSWORD,
    val => String(val).length >= 8,
    true
  );

  const detectedIp = await detectPublicIp();
  const defaultOrigin = mergedDefaults.ALLOWED_ORIGINS || (detectedIp ? `http://${detectedIp}` : '*');
  const rawOrigins = await askQuestion(
    t('cors'),
    defaultOrigin
  );
  answers.ALLOWED_ORIGINS = normalizeOrigins(rawOrigins);

  if (configMode === 'all') {
    answers.PORT = await askQuestion(
      t('port'),
      mergedDefaults.PORT,
      val => /^\d+$/.test(val) && Number(val) > 0 && Number(val) < 65536
    );
    answers.HOST_PORT = await askQuestion(
      t('hostPort'),
      mergedDefaults.HOST_PORT,
      val => /^\d+$/.test(val) && Number(val) > 0 && Number(val) < 65536
    );
    answers.NODE_ENV = await askSelection(
      t('nodeEnv'),
      [
        { key: '1', name: 'production', value: 'production' },
        { key: '2', name: 'development', value: 'development' },
        { key: '3', name: 'test', value: 'test' }
      ],
      mergedDefaults.NODE_ENV
    );
    answers.ADMIN_LANGUAGE = await askSelection(
      t('adminLang'),
      [
        { key: '1', name: 'Spanish (es)', value: 'es' },
        { key: '2', name: 'English (en)', value: 'en' },
        { key: '3', name: 'Portuguese (pt)', value: 'pt' },
        { key: '4', name: 'French (fr)', value: 'fr' },
        { key: '5', name: 'German (de)', value: 'de' },
        { key: '6', name: 'Italian (it)', value: 'it' }
      ],
      mergedDefaults.ADMIN_LANGUAGE
    );
    answers.ADMIN_SESSION_TTL_HOURS = await askQuestion(
      t('adminSess'),
      mergedDefaults.ADMIN_SESSION_TTL_HOURS,
      val => /^\d+$/.test(val)
    );
    answers.LOG_LEVEL = await askSelection(
      t('logLevel'),
      [
        { key: '1', name: 'info', value: 'info' },
        { key: '2', name: 'trace', value: 'trace' },
        { key: '3', name: 'debug', value: 'debug' },
        { key: '4', name: 'warn', value: 'warn' },
        { key: '5', name: 'error', value: 'error' },
        { key: '6', name: 'fatal', value: 'fatal' },
        { key: '7', name: 'silent', value: 'silent' }
      ],
      mergedDefaults.LOG_LEVEL
    );
    answers.TRUST_PROXY_HOPS = await askQuestion(
      t('proxyHops'),
      mergedDefaults.TRUST_PROXY_HOPS,
      val => /^\d+$/.test(val)
    );
    answers.COOKIE_SAME_SITE = await askSelection(
      t('sameSite'),
      [
        { key: '1', name: 'lax', value: 'lax' },
        { key: '2', name: 'strict', value: 'strict' },
        { key: '3', name: 'none', value: 'none' }
      ],
      mergedDefaults.COOKIE_SAME_SITE
    );
    answers.SETTINGS_KEY = await askQuestion(
      t('settingsKey'),
      mergedDefaults.SETTINGS_KEY,
      val => val === '' || /^[0-9a-fA-F]{64}$/.test(val),
      true
    );
  } else {
    answers.PORT = mergedDefaults.PORT;
    answers.HOST_PORT = mergedDefaults.HOST_PORT;
    answers.NODE_ENV = mergedDefaults.NODE_ENV;
    answers.ADMIN_LANGUAGE = mergedDefaults.ADMIN_LANGUAGE;
    answers.ADMIN_SESSION_TTL_HOURS = mergedDefaults.ADMIN_SESSION_TTL_HOURS;
    answers.LOG_LEVEL = mergedDefaults.LOG_LEVEL;
    answers.TRUST_PROXY_HOPS = mergedDefaults.TRUST_PROXY_HOPS;
    answers.COOKIE_SAME_SITE = mergedDefaults.COOKIE_SAME_SITE;
    answers.SETTINGS_KEY = mergedDefaults.SETTINGS_KEY;
  }

  // Group 3: Widget — only the bootstrap embed credential is kept in .env;
  // visual settings moved to the admin panel (ADR-10).
  printSectionHeader(t('widgetSec'));

  answers.WIDGET_API_KEY = await askQuestion(
    t('widgetApiKey'),
    mergedDefaults.WIDGET_API_KEY
  );

  // Group 4: Features
  if (configMode === 'all') {
    printSectionHeader(t('featuresSec'));
    answers.FEATURE_TRANSLATION = String(await chooseYesNo('   ' + t('featTrans'), mergedDefaults.FEATURE_TRANSLATION === 'true'));
    answers.FEATURE_SENTIMENT = String(await chooseYesNo('   ' + t('featSent'), mergedDefaults.FEATURE_SENTIMENT === 'true'));
    answers.FEATURE_GHOST_TYPING = String(await chooseYesNo('   ' + t('featGhost'), mergedDefaults.FEATURE_GHOST_TYPING === 'true'));
    answers.FEATURE_GEOLOCATION = String(await chooseYesNo('   ' + t('featGeo'), mergedDefaults.FEATURE_GEOLOCATION === 'true'));
  } else {
    answers.FEATURE_TRANSLATION = mergedDefaults.FEATURE_TRANSLATION;
    answers.FEATURE_SENTIMENT = mergedDefaults.FEATURE_SENTIMENT;
    answers.FEATURE_GHOST_TYPING = mergedDefaults.FEATURE_GHOST_TYPING;
    answers.FEATURE_GEOLOCATION = mergedDefaults.FEATURE_GEOLOCATION;
  }

  // Group 5: Translation Provider
  if (configMode === 'all' || answers.FEATURE_TRANSLATION === 'true') {
    printSectionHeader(t('transSec'));
    answers.TRANSLATION_PROVIDER = await askSelection(
      t('transProvider'),
      [
        { key: '1', name: 'Google Free Fallback (google_free)', value: 'google_free' },
        { key: '2', name: 'DeepL API (deepl)', value: 'deepl' },
        { key: '3', name: 'Google Cloud Translation (google_cloud)', value: 'google_cloud' }
      ],
      mergedDefaults.TRANSLATION_PROVIDER
    );

    if (answers.TRANSLATION_PROVIDER !== 'google_free') {
      answers.TRANSLATION_API_KEY = await askQuestion(
        t('transKey'),
        mergedDefaults.TRANSLATION_API_KEY,
        val => !!val,
        true
      );
    } else {
      answers.TRANSLATION_API_KEY = '';
    }

    if (answers.TRANSLATION_PROVIDER === 'deepl') {
      answers.DEEPL_API_URL = await askQuestion(
        t('transUrl'),
        mergedDefaults.DEEPL_API_URL
      );
    } else {
      answers.DEEPL_API_URL = '';
    }
  } else {
    answers.TRANSLATION_PROVIDER = mergedDefaults.TRANSLATION_PROVIDER;
    answers.TRANSLATION_API_KEY = mergedDefaults.TRANSLATION_API_KEY;
    answers.DEEPL_API_URL = mergedDefaults.DEEPL_API_URL;
  }

  // Group 6: Rate Limiting
  if (configMode === 'all') {
    printSectionHeader(t('rateSec'));
    answers.RATE_LIMIT_WINDOW_MINUTES = await askQuestion(
      t('rateWin'),
      mergedDefaults.RATE_LIMIT_WINDOW_MINUTES,
      val => /^\d+$/.test(val)
    );
    answers.RATE_LIMIT_PUBLIC_MAX = await askQuestion(
      t('ratePub'),
      mergedDefaults.RATE_LIMIT_PUBLIC_MAX,
      val => /^\d+$/.test(val)
    );
    answers.RATE_LIMIT_ADMIN_MAX = await askQuestion(
      t('rateAdm'),
      mergedDefaults.RATE_LIMIT_ADMIN_MAX,
      val => /^\d+$/.test(val)
    );
    answers.RATE_LIMIT_LOGIN_MAX = await askQuestion(
      t('rateLog'),
      mergedDefaults.RATE_LIMIT_LOGIN_MAX,
      val => /^\d+$/.test(val)
    );
    answers.RATE_LIMIT_UPLOAD_WINDOW_MINUTES = await askQuestion(
      t('rateUpWin'),
      mergedDefaults.RATE_LIMIT_UPLOAD_WINDOW_MINUTES,
      val => /^\d+$/.test(val)
    );
    answers.RATE_LIMIT_UPLOAD_MAX = await askQuestion(
      t('rateUpMax'),
      mergedDefaults.RATE_LIMIT_UPLOAD_MAX,
      val => /^\d+$/.test(val)
    );
  } else {
    answers.RATE_LIMIT_WINDOW_MINUTES = mergedDefaults.RATE_LIMIT_WINDOW_MINUTES;
    answers.RATE_LIMIT_PUBLIC_MAX = mergedDefaults.RATE_LIMIT_PUBLIC_MAX;
    answers.RATE_LIMIT_ADMIN_MAX = mergedDefaults.RATE_LIMIT_ADMIN_MAX;
    answers.RATE_LIMIT_LOGIN_MAX = mergedDefaults.RATE_LIMIT_LOGIN_MAX;
    answers.RATE_LIMIT_UPLOAD_WINDOW_MINUTES = mergedDefaults.RATE_LIMIT_UPLOAD_WINDOW_MINUTES;
    answers.RATE_LIMIT_UPLOAD_MAX = mergedDefaults.RATE_LIMIT_UPLOAD_MAX;
  }

  // Group 7: File Uploads
  if (configMode === 'all') {
    printSectionHeader(t('uploadSec'));
    answers.MAX_UPLOAD_MB = await askQuestion(
      t('maxUpload'),
      mergedDefaults.MAX_UPLOAD_MB,
      val => /^\d+$/.test(val)
    );
    answers.UPLOAD_DIR = await askQuestion(
      t('uploadDir'),
      mergedDefaults.UPLOAD_DIR
    );
    answers.ALLOWED_IMAGE_TYPES = await askQuestion(
      t('allowedTypes'),
      mergedDefaults.ALLOWED_IMAGE_TYPES
    );
  } else {
    answers.MAX_UPLOAD_MB = mergedDefaults.MAX_UPLOAD_MB;
    answers.UPLOAD_DIR = mergedDefaults.UPLOAD_DIR;
    answers.ALLOWED_IMAGE_TYPES = mergedDefaults.ALLOWED_IMAGE_TYPES;
  }

  // Group 8: Redis
  if (configMode === 'all') {
    printSectionHeader(t('redisSec'));
    answers.REDIS_URL = await askQuestion(
      t('redisUrl'),
      mergedDefaults.REDIS_URL
    );
    answers.REDIS_KEY_PREFIX = await askQuestion(
      t('redisPrefix'),
      mergedDefaults.REDIS_KEY_PREFIX
    );
    if (process.platform === 'win32') {
      answers.REDIS_ENABLED = 'false';
    } else {
      answers.REDIS_ENABLED = String(await chooseYesNo(
        '   ' + t('redisEnabled'),
        mergedDefaults.REDIS_ENABLED === 'true'
      ));
    }
  } else {
    answers.REDIS_URL = mergedDefaults.REDIS_URL;
    answers.REDIS_KEY_PREFIX = mergedDefaults.REDIS_KEY_PREFIX;
    answers.REDIS_ENABLED = process.platform === 'win32' ? 'false' : (mergedDefaults.REDIS_ENABLED !== undefined ? mergedDefaults.REDIS_ENABLED : 'true');
  }


  // Double check overwriting
  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await chooseYesNo(`\n   ${ENV_PATH} ${t('confirmOverwrite')}`, true);
    if (!overwrite) {
      console.log('\n' + color('yellow', '   ' + t('setupCanceled')));
      rl.close();
      return;
    }
  }

  // Construct env file content
  const envContent = [
    '# ============================================================',
    '# LiveChat Pro — Environment variables config',
    `# Generated by setup.js on ${new Date().toISOString()}`,
    '# ============================================================',
    '',
    '# 1. Telegram',
    `TELEGRAM_TOKEN=${quoteEnv(answers.TELEGRAM_TOKEN)}`,
    `TELEGRAM_ADMIN_ID=${quoteEnv(answers.TELEGRAM_ADMIN_ID)}`,
    `TELEGRAM_LAUNCH_TIMEOUT_MS=${quoteEnv(answers.TELEGRAM_LAUNCH_TIMEOUT_MS)}`,
    '',
    '# 2. Server',
    `PORT=${quoteEnv(answers.PORT)}`,
    `HOST_PORT=${quoteEnv(answers.HOST_PORT)}`,
    `NODE_ENV=${quoteEnv(answers.NODE_ENV)}`,
    `ALLOWED_ORIGINS=${quoteEnv(answers.ALLOWED_ORIGINS)}`,
    `ADMIN_PANEL_PASSWORD=${quoteEnv(answers.ADMIN_PANEL_PASSWORD)}`,
    `ADMIN_LANGUAGE=${quoteEnv(answers.ADMIN_LANGUAGE)}`,
    `ADMIN_SESSION_TTL_HOURS=${quoteEnv(answers.ADMIN_SESSION_TTL_HOURS)}`,
    `LOG_LEVEL=${quoteEnv(answers.LOG_LEVEL)}`,
    `TRUST_PROXY_HOPS=${quoteEnv(answers.TRUST_PROXY_HOPS)}`,
    `COOKIE_SAME_SITE=${quoteEnv(answers.COOKIE_SAME_SITE)}`,
    '# Optional AES-256-GCM key (64 hex chars) for encrypting settings at rest.',
    '# Leave empty to auto-generate one at data/.settings-key on first boot.',
    `SETTINGS_KEY=${quoteEnv(answers.SETTINGS_KEY)}`,
    '',
    '# 3. Widget',
    `WIDGET_API_KEY=${quoteEnv(answers.WIDGET_API_KEY)}`,
    '',
    '# 4. Features',
    `FEATURE_TRANSLATION=${quoteEnv(answers.FEATURE_TRANSLATION)}`,
    `FEATURE_SENTIMENT=${quoteEnv(answers.FEATURE_SENTIMENT)}`,
    `FEATURE_GHOST_TYPING=${quoteEnv(answers.FEATURE_GHOST_TYPING)}`,
    `FEATURE_GEOLOCATION=${quoteEnv(answers.FEATURE_GEOLOCATION)}`,
    '',
    '# 5. Translation',
    `TRANSLATION_PROVIDER=${quoteEnv(answers.TRANSLATION_PROVIDER)}`,
    `TRANSLATION_API_KEY=${quoteEnv(answers.TRANSLATION_API_KEY)}`,
    `DEEPL_API_URL=${quoteEnv(answers.DEEPL_API_URL)}`,
    '',
    '# 6. Rate Limiting',
    `RATE_LIMIT_WINDOW_MINUTES=${quoteEnv(answers.RATE_LIMIT_WINDOW_MINUTES)}`,
    `RATE_LIMIT_PUBLIC_MAX=${quoteEnv(answers.RATE_LIMIT_PUBLIC_MAX)}`,
    `RATE_LIMIT_ADMIN_MAX=${quoteEnv(answers.RATE_LIMIT_ADMIN_MAX)}`,
    `RATE_LIMIT_LOGIN_MAX=${quoteEnv(answers.RATE_LIMIT_LOGIN_MAX)}`,
    `RATE_LIMIT_UPLOAD_WINDOW_MINUTES=${quoteEnv(answers.RATE_LIMIT_UPLOAD_WINDOW_MINUTES)}`,
    `RATE_LIMIT_UPLOAD_MAX=${quoteEnv(answers.RATE_LIMIT_UPLOAD_MAX)}`,
    '',
    '# 7. File Uploads',
    `MAX_UPLOAD_MB=${quoteEnv(answers.MAX_UPLOAD_MB)}`,
    `UPLOAD_DIR=${quoteEnv(answers.UPLOAD_DIR)}`,
    `ALLOWED_IMAGE_TYPES=${quoteEnv(answers.ALLOWED_IMAGE_TYPES)}`,
    '',
    '# 8. Redis scaling',
    `REDIS_URL=${quoteEnv(answers.REDIS_URL)}`,
    `REDIS_KEY_PREFIX=${quoteEnv(answers.REDIS_KEY_PREFIX)}`,
    `REDIS_ENABLED=${quoteEnv(answers.REDIS_ENABLED)}`,
    '',
  ].join('\n');

  console.log('\n   ' + t('writingConfig'));
  fs.writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log(color('green', '   ✓ ' + t('success')));

  // Launch Option
  let launchCommandUsed = '';

  if (process.platform === 'win32') {
    printSectionHeader(t('nodeSec'));
    const runNode = await chooseYesNo('   ' + t('nodePrompt'), true);
    if (runNode) {
      console.log('\n   ' + color('cyan', t('nodeRunning')));
      launchCommandUsed = 'node server.js';
      
      if (rl) rl.close();
      
      const { spawn } = require('child_process');
      const logPath = path.join(ROOT, 'install.log');
      
      const isSpinnerRunning = process.stdout.isTTY;
      let spinnerFrame = 0;
      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let spinnerInterval;

      if (isSpinnerRunning) {
        process.stdout.write('   ' + t('nodeStarting') + '  ');
        spinnerInterval = setInterval(() => {
          readline.cursorTo(process.stdout, 28);
          process.stdout.write(color('cyan', spinnerFrames[spinnerFrame]));
          spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
        }, 80);
      }

      let child;
      try {
        const outLog = fs.openSync(logPath, 'a');
        fs.writeSync(outLog, `\n=== Servidor (Background) ===\nIniciando 'node server.js'\nFecha: ${new Date().toISOString()}\n\n`);

        child = spawn('node', ['server.js'], {
          detached: true,
          stdio: ['ignore', outLog, outLog]
        });
        
        fs.closeSync(outLog);
        child.unref();
      } catch (err) {
        if (isSpinnerRunning) {
          clearInterval(spinnerInterval);
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
        }
        console.log('\n' + color('red', `   ✘ Error al iniciar el servidor Node.js: ${err.message}`));
      }

      await new Promise(resolve => setTimeout(resolve, 1500));

      if (isSpinnerRunning) {
        clearInterval(spinnerInterval);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }

      if (child) {
        const hasExited = child.exitCode !== null;
        if (hasExited) {
          console.log('\n' + color('red', `   ✘ El servidor no pudo arrancar. Código de salida: ${child.exitCode}`));
          console.log(color('red', `     Revisa los detalles en: ${logPath}`));
        } else {
          console.log('\n' + color('green', `   ✓ El servidor se inició en segundo plano. Logs en: ${logPath}`));
        }
      }
      
      if (!SCRIPTED_INPUT) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      }
    }
  } else {
    // Docker Compose Launch Option (Linux/other)
    printSectionHeader(t('dockerSec'));
    if (commandExists('docker')) {
      const runDocker = await chooseYesNo('   ' + t('dockerPrompt'), true);
      if (runDocker) {
        console.log('\n   ' + color('cyan', t('dockerRunning')));
        const isComposePlugin = commandExists('docker-compose') ? false : true;
        const cmd = isComposePlugin ? 'docker' : 'docker-compose';
        const args = isComposePlugin ? ['compose', 'up', '-d', '--build'] : ['up', '-d', '--build'];
        
        launchCommandUsed = `${cmd} ${args.join(' ')}`;
        
        if (rl) rl.close();
        
        let code;
        try {
          code = await spawnAndLog(cmd, args);
        } catch (err) {
          console.log('\n' + color('red', `   ✘ Error al iniciar Docker Compose: ${err.message}`));
          code = -1;
        }

        // Restore readline
        if (!SCRIPTED_INPUT) {
          rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        }
        
        if (code === 0) {
          console.log('\n' + color('green', '   ✓ ' + t('dockerSuccess')));
        } else {
          console.log('\n' + color('red', '   ✘ ' + t('dockerFail')));
        }
      }
    }
  }

  // Display snippets
  const isWindows = process.platform === 'win32';
  const shownPort = isWindows ? answers.PORT : answers.HOST_PORT;
  const baseUrl = publicBaseUrl(answers.ALLOWED_ORIGINS, shownPort);
  
  console.log('\n' + color('cyan', '=========================================================='));
  console.log(color('bright', `   ${t('recommendedCmd')}`));
  console.log(`   ${launchCommandUsed || (isWindows ? 'node server.js' : 'docker compose up -d --build')}`);
  console.log('\n   ' + color('blue', `Widget Demo:     ${baseUrl}`));
  console.log('   ' + color('blue', `Health Check:    ${baseUrl}/health`));
  console.log('   ' + color('blue', `Admin Panel:     ${baseUrl}/admin`));
  console.log('\n   ' + color('bright', t('widgetSnippetTitle')));
  
  const keyAttr = answers.WIDGET_API_KEY ? ` data-api-key="${answers.WIDGET_API_KEY.replace(/"/g, '&quot;')}"` : '';
  const snippet = `<script src="${baseUrl}/widget.js" data-server="${baseUrl}"${keyAttr}></script>`;
  console.log(color('green', `   ${snippet}`));
  console.log(color('cyan', '=========================================================='));

  if (rl) rl.close();
}

main().catch(err => {
  console.error(color('red', err.stack || err.message));
  if (rl) rl.close();
  process.exitCode = 1;
});
