# Plan de Implementación: Bot Inteligente para LiveChat Pro

> **Versión:** 1.1 — Generado por Sofia 🔥  
> **Proyecto:** `/home/wilkin/proyectos/Chat`  
> **Estado:** Listo para ejecutar por fases

---

## Resumen Ejecutivo

Se añade un **bot inteligente** que responde automáticamente a los visitantes antes de escalar al admin humano. Soporta dos modos:

| Modo | Descripción |
|------|-------------|
| **AI (OpenAI)** | Usa GPT para responder en lenguaje natural con contexto de conversación |
| **Base de conocimiento** | Responde con reglas/FAQs estáticas editables en JSON, sin API externa |
| **Desactivado** | Comportamiento actual del proyecto (sin cambios) |

Cuando el admin responde desde Telegram → el bot se silencia para esa sesión. Comando `/bot on` para reactivarlo.

---

## Árbol de Dependencias

```
FASE 1 (BD: bot_silenced)
  └── FASE 2 (knowledge-base.json) ──────────┐
        └── FASE 3 (ai-bot.js) ──────────────┤
              ├── FASE 4 (.example files)     │
              ├── FASE 5 (sockets/index.js)   │
              ├── FASE 6 (telegram/bot.js)    │
              └── FASE 7 (admin panel) ───────┘
                    └── FASE 8 (setup.js)
                          └── FASE 9 (READMEs)
```

**Regla:** nunca ejecutar una fase si la que está encima de ella en el árbol no está terminada.

---

## Fases de Implementación

---

### FASE 1 — Base de datos: columna `bot_silenced`

**Esfuerzo estimado:** 30 min  
**Depende de:** nada — es la base de todo  
**Archivo:** `db.js`

Esta es la primera porque `bot_silenced` lo necesitan los sockets, el bot de Telegram y el panel admin. Sin ella, ningún otro módulo puede persistir el estado del bot.

#### Migración SQL

```sql
ALTER TABLE sessions ADD COLUMN bot_silenced INTEGER NOT NULL DEFAULT 0;
```

#### Statement preparado (añadir en `db.js`)

```js
updateBotSilenced: db.prepare('UPDATE sessions SET bot_silenced = ? WHERE session_id = ?'),
```

#### Mapeo al cargar sesión desde BD

```js
session.botSilenced = Boolean(row.bot_silenced);
```

#### Flag inicial al crear sesión nueva (en `src/sockets/index.js`, sección `isNewSession`)

```js
session.botSilenced = false;
```

---

### FASE 2 — Base de conocimiento `data/knowledge-base.json`

**Esfuerzo estimado:** 1 hora  
**Depende de:** Fase 1  
**Archivos nuevos:** `data/knowledge-base.json.example`  
**Archivos creados por setup:** `data/knowledge-base.json`

Definir la estructura **antes** de implementar `ai-bot.js`, porque el servicio tiene que saber exactamente qué formato leer.

#### Estructura del JSON

```json
{
  "version": "1.0",
  "language": "es",
  "fallback": "Lo siento, no tengo respuesta para eso. Un agente te contactará pronto.",
  "entries": [
    {
      "id": "horario",
      "keywords": ["horario", "abierto", "atención", "horas", "cuando"],
      "question": "¿Cuál es el horario de atención?",
      "answer": "Atendemos de lunes a viernes de 9:00 a 18:00 (hora de Madrid).",
      "confidence": 0.9
    },
    {
      "id": "precio",
      "keywords": ["precio", "costo", "cuánto", "tarifa", "plan"],
      "question": "¿Cuánto cuesta el servicio?",
      "answer": "Tenemos planes desde $9/mes. Visita nuestra página de precios para más detalles.",
      "confidence": 0.85
    }
  ]
}
```

#### Algoritmo de matching (para referencia al implementar ai-bot.js)

1. Tokenizar texto del usuario (lowercase, sin tildes ni puntuación)
2. Para cada entry: contar keywords presentes / total keywords → score
3. Si `score >= BOT_CONFIDENCE_THRESHOLD` → usar esa respuesta
4. Si ninguna supera umbral → `escalate: true` (va a Telegram)

#### En esta fase crear también

- `data/knowledge-base.json.example` — archivo de ejemplo con 10 entries típicas, bien documentado en inglés

---

### FASE 3 — Servicio central `src/services/ai-bot.js`

**Esfuerzo estimado:** 3–4 horas  
**Depende de:** Fase 1 (columna BD), Fase 2 (estructura KB definida)  
**Archivos nuevos:** `src/services/ai-bot.js`

Este es el cerebro. Lo necesitan sockets, telegram y el panel admin, por eso va antes que todos ellos.

#### Arquitectura del servicio

```
AiBot
  ├── init(config)             → carga modo, clave API, base de conocimiento
  ├── isEnabled()              → lee BOT_MODE del .env
  ├── shouldBotHandle(session) → false si session.botSilenced === true
  ├── getReply(session, text)
  │     ├── modo knowledge-base → matchQuery(text) → respuesta o null
  │     ├── modo ai (OpenAI)   → llamada a OpenAI con contexto de sesión
  │     └── retorna { reply: string|null, confidence: 0–1, escalate: bool }
  └── buildContext(session)    → últimos N mensajes para OpenAI
```

#### Lógica de escalado

```js
// Umbral configurable via BOT_CONFIDENCE_THRESHOLD (default 0.6)
if (result.confidence < threshold || result.escalate) {
  // → flujo normal: mensaje va a Telegram
  // → bot NO responde al usuario
} else {
  // → bot responde al usuario directamente
  // → Telegram recibe notificación silenciosa si BOT_NOTIFY_ADMIN=true
}
```

#### Variables de entorno nuevas (añadir a `.env.example`)

```env
# ── Bot Inteligente ───────────────────────────────────────────
# Opciones: disabled | knowledge-base | ai
BOT_MODE="disabled"

# Solo si BOT_MODE=ai
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-4o-mini"
OPENAI_MAX_TOKENS="300"
BOT_SYSTEM_PROMPT="You are a friendly support assistant. Be brief and reply in the user's language."

# Umbral de confianza para knowledge-base (0.0 – 1.0)
BOT_CONFIDENCE_THRESHOLD="0.6"

# Número máximo de mensajes de contexto enviados a OpenAI
BOT_CONTEXT_MESSAGES="6"

# Notificar al admin cuando el bot responde (true/false)
BOT_NOTIFY_ADMIN="false"
```

#### Integración en `server.js`

```js
const aiBot = require('./src/services/ai-bot');
aiBot.init({
  mode: process.env.BOT_MODE || 'disabled',
  openaiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 300,
  systemPrompt: process.env.BOT_SYSTEM_PROMPT,
  confidenceThreshold: parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD) || 0.6,
  contextMessages: parseInt(process.env.BOT_CONTEXT_MESSAGES) || 6,
  notifyAdmin: process.env.BOT_NOTIFY_ADMIN === 'true',
  kbPath: path.join(__dirname, 'data/knowledge-base.json'),
});
// Pasar aiBot como dep a setupSockets y setupTelegramBot
```

---

### FASE 4 — Archivos `.example` documentados en inglés

**Esfuerzo estimado:** 1 hora  
**Depende de:** Fase 3 (ai-bot.js ya implementado, se documenta lo real)  
**Archivos nuevos:** `src/services/ai-bot.js.example`

Con `ai-bot.js` ya implementado, el `.example` documenta la implementación real con JSDoc detallado en inglés. No al revés.

- **`src/services/ai-bot.js.example`** — Clase `AiBot` completa con:
  - JSDoc en cada método
  - Lógica de matching para knowledge-base comentada paso a paso
  - Llamada a OpenAI explicada (prompt building, contexto, tokens)
  - Sección de extensión: cómo añadir otros proveedores (Anthropic, Ollama)

- **`data/knowledge-base.json.example`** — ya creado en Fase 2

---

### FASE 5 — Modificar `src/sockets/index.js`

**Esfuerzo estimado:** 2 horas  
**Depende de:** Fase 1 (bot_silenced en BD), Fase 3 (ai-bot.js existe)

Añadir en `socket.on('message')`, DESPUÉS de guardar el mensaje en BD, ANTES de `sendToAdmin`:

```js
const aiBot = deps.aiBot;
if (aiBot?.isEnabled() && aiBot.shouldBotHandle(session)) {
  const botResult = await aiBot.getReply(session, text);

  if (botResult?.reply && !botResult.escalate) {
    // Typing indicator mientras procesaba (emitir typing_stop)
    socket.emit('typing_stop');

    const botMsg = { from: 'bot', text: botResult.reply, ts: Date.now(), lang: session.lang };
    socket.emit('message', botMsg);
    session.messages.push(botMsg);
    await stmts.insertMessage.run({
      session_id: sessionId, from_role: 'bot',
      text: botMsg.text, ts: botMsg.ts, lang: session.lang
    });
    await broadcastAdminMessage(session, botMsg);

    if (features.botNotifyAdmin) {
      await sendToAdmin(
        `🤖 Bot respondió a <b>${escapeTelegramHtml(session.name)}</b>: "${escapeTelegramHtml(botResult.reply.slice(0,80))}..."`,
        {}, sessionId
      );
    }
    return; // No escalar a Telegram
  }
}
// ... código existente: sendToAdmin(telegramText, ...) ...
```

También emitir `typing_start` justo antes de llamar a `aiBot.getReply()` para dar feedback visual al usuario:

```js
socket.emit('typing_start', { from: 'bot' });
const botResult = await aiBot.getReply(session, text);
socket.emit('typing_stop');
```

---

### FASE 6 — Modificar `src/telegram/bot.js`

**Esfuerzo estimado:** 1.5 horas  
**Depende de:** Fase 1 (bot_silenced en BD), Fase 3 (ai-bot.js existe)

#### 6a. Silenciar bot cuando el admin responde

En `bot.on('message')`, tras enviar la respuesta al usuario:

```js
if (session && deps.aiBot?.isEnabled()) {
  session.botSilenced = true;
  await stmts.updateBotSilenced?.run(1, sessionId);
  logger.info({ sessionId }, 'Bot silenciado por intervención humana');
}
```

#### 6b. Nuevo comando `/bot on|off`

```js
bot.command('bot', async (ctx) => {
  if (ctx.from.id !== adminId) return;
  const [, action, prefix] = ctx.message.text.split(' ');

  if (!['on', 'off'].includes(action))
    return ctx.reply('Uso: /bot on [sessionId] | /bot off [sessionId]');

  const sid = prefix
    ? await findSessionIdByPrefix(prefix)
    : await clusterState.getPendingReply(adminId);
  if (!sid) return ctx.reply('❓ Sesión no encontrada.');

  const session = await ensureSessionLoaded(sid);
  if (!session) return ctx.reply('❓ Sesión no encontrada.');

  session.botSilenced = action === 'off';
  await stmts.updateBotSilenced?.run(action === 'off' ? 1 : 0, sid);

  ctx.reply(
    `🤖 Bot ${action === 'on' ? 'activado ✅' : 'desactivado 🔇'} para ${session.name || sid.slice(0,8)}`
  );
});
```

---

### FASE 7 — Panel Admin: toggle bot por sesión

**Esfuerzo estimado:** 2 horas  
**Depende de:** Fase 1 (BD), Fase 3 (ai-bot.js), Fase 5 y 6 ya funcionando

#### Endpoint REST (`src/routes/admin.js`)

```js
// POST /admin/sessions/:sessionId/bot  — body: { enabled: true|false }
router.post('/sessions/:sessionId/bot', authMiddleware, async (req, res) => {
  const session = await ensureSessionLoaded(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.botSilenced = !req.body.enabled;
  await stmts.updateBotSilenced.run(session.botSilenced ? 1 : 0, session.sessionId);
  res.json({ ok: true, botSilenced: session.botSilenced });
});
```

#### UI en tarjeta de sesión (panel admin)

```html
<label class="bot-toggle" title="Activar/desactivar bot para esta sesión">
  <input type="checkbox"
    onchange="toggleBot('{{sessionId}}', this.checked)"
    {{#unless botSilenced}}checked{{/unless}}>
  🤖 Bot
</label>
```

```js
async function toggleBot(sessionId, enabled) {
  await fetch(`/admin/sessions/${sessionId}/bot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
}
```

---

### FASE 8 — Cambios en `setup.js`

**Esfuerzo estimado:** 2 horas  
**Depende de:** Fase 3 (saber qué vars existen), Fase 2 (saber qué crear para KB)

Con toda la implementación ya conocida, el setup puede hacer las preguntas correctas y escribir exactamente las vars que el sistema necesita.

#### Nueva pregunta (tras configuración del admin panel)

```
12. Smart bot mode
   [1] Disabled — no bot, all messages go directly to Telegram (default)
   [2] Knowledge-base bot — FAQ answers from data/knowledge-base.json
   [3] AI bot (OpenAI) — GPT-powered conversational responses

   Choose an option [1]:
```

**Branching por opción:**

**[1] Disabled:**
```
BOT_MODE="disabled"
→ Fin, no preguntar más.
```

**[2] Knowledge-base:**
```
BOT_MODE="knowledge-base"
→ Pregunta: Confidence threshold [0.6]:
→ Pregunta: Notify admin when bot replies? [no]:
→ Copia template interno a data/knowledge-base.json si no existe
→ Muestra: "Edit data/knowledge-base.json to add your FAQ entries."
```

**[3] AI (OpenAI):**
```
BOT_MODE="ai"
→ Pregunta: OpenAI API Key (required): [secret]
→ Pregunta: OpenAI model [gpt-4o-mini]:
→ Pregunta: Max tokens per reply [300]:
→ Pregunta: System prompt (Enter for default):
→ Pregunta: Notify admin when bot replies? [no]:
```

---

### FASE 9 — Actualizar los 3 READMEs

**Esfuerzo estimado:** 1.5 horas  
**Depende de:** todas las fases anteriores completadas

Última fase porque documenta la implementación real, no la planeada.

#### Sección a añadir en los 3 archivos

**README.md (English):**
```markdown
## 🤖 Smart Bot

LiveChat Pro includes an optional smart bot that answers visitors automatically before escalating to a human.

| Mode | Description |
|------|-------------|
| `disabled` | No bot — all messages go to Telegram (default) |
| `knowledge-base` | FAQ answers from `data/knowledge-base.json` |
| `ai` | OpenAI-powered conversational responses |

Configure during `node setup.js` or set `BOT_MODE` in `.env`.

**How it works:**
- Bot greets visitors and answers FAQs instantly, 24/7
- If confidence is too low or topic is unusual → escalates to your Telegram
- When you reply from Telegram → bot silences automatically for that session
- Re-enable with `/bot on [sessionId]` from Telegram
- Toggle per-session in the admin panel

**Telegram commands:**
- `/bot on [sessionId]` — re-enable bot for a session
- `/bot off [sessionId]` — silence bot for a session

See `data/knowledge-base.json.example` and `src/services/ai-bot.js.example` for configuration details.
```

**README_ES.md:** misma sección en español  
**README_BR.md:** misma sección en portugués

---

## Mejoras Adicionales Propuestas

### Corto plazo (incluir en esta misma iteración)

| # | Mejora | Valor |
|---|--------|-------|
| A | **Typing indicator** — emitir `typing_start` al socket mientras OpenAI procesa | UX premium |
| B | **Escalado por sentimiento** — si `isHighPriority === true`, forzar `escalate: true` aunque el bot tenga respuesta | Seguridad |
| C | **Rate limiting del bot** — máx 1 llamada OpenAI por sesión cada 3s | Protección de costos |
| D | **Fallback knowledge-base si OpenAI falla** — intentar KB antes de escalar | Resiliencia |

### Mediano plazo

| # | Mejora | Descripción |
|---|--------|-------------|
| E | **Analytics del bot** | Tabla `bot_interactions` en SQLite: queries, respuestas, escalados, confianza. Panel de métricas en admin |
| F | **Hot-reload de knowledge-base** | `fs.watch()` sobre el JSON, recarga sin reiniciar el servidor |
| G | **Comando /train desde Telegram** | `/train pregunta → respuesta` añade entry al knowledge-base automáticamente |
| H | **Multiidioma en KB** | `answer` como objeto `{ es, en, pt }` — responde en el idioma del usuario |

### Largo plazo

| # | Mejora | Descripción |
|---|--------|-------------|
| I | **Embeddings / búsqueda semántica** | Vectorizar KB con `@xenova/transformers` (local, sin costo) para matching semántico real |
| J | **Panel de entrenamiento visual** | Editor del knowledge-base.json desde el admin panel en el navegador |
| K | **Multi-proveedor** | Abstracción `BOT_PROVIDER`: openai, anthropic, gemini, ollama |
| L | **OpenAI Assistants API** | Usar `thread_id` por sesión para memoria real y contexto persistente |

---

## Resumen de Archivos Afectados

| Archivo | Acción | Fase |
|---------|--------|------|
| `db.js` | **MODIFICAR** — columna bot_silenced | 1 |
| `data/knowledge-base.json.example` | **NUEVO** | 2 |
| `data/knowledge-base.json` | **NUEVO** (vía setup o manual) | 2 |
| `src/services/ai-bot.js` | **NUEVO** | 3 |
| `.env.example` | **MODIFICAR** — nuevas variables | 3 |
| `server.js` | **MODIFICAR** — init aiBot + pasar como dep | 3 |
| `src/services/ai-bot.js.example` | **NUEVO** | 4 |
| `src/sockets/index.js` | **MODIFICAR** | 5 |
| `src/telegram/bot.js` | **MODIFICAR** | 6 |
| `src/routes/admin.js` | **MODIFICAR** | 7 |
| `setup.js` | **MODIFICAR** | 8 |
| `README.md` | **MODIFICAR** | 9 |
| `README_ES.md` | **MODIFICAR** | 9 |
| `README_BR.md` | **MODIFICAR** | 9 |

---

## Estimación Total

| Fase | Tarea | Horas |
|------|-------|-------|
| 1 | BD: bot_silenced | 0.5h |
| 2 | knowledge-base.json + example | 1h |
| 3 | ai-bot.js + vars .env + server.js | 4h |
| 4 | ai-bot.js.example | 1h |
| 5 | sockets/index.js | 2h |
| 6 | telegram/bot.js | 1.5h |
| 7 | Admin panel toggle | 2h |
| 8 | setup.js | 2h |
| 9 | 3 READMEs | 1.5h |
| **Total** | | **~15.5h** |

---

*Plan generado por Sofia 🔥 — listo para ejecutar cuando Wil diga.*
