# ============================================================
# LiveChat Pro — Dockerfile
# Build multi-stage: instala sólo dependencias de producción,
# luego copia al contenedor final con usuario no-root.
# ============================================================

# ── Stage 1: instalar dependencias de producción ─────────────
FROM node:24-slim AS deps

WORKDIR /app

# Copiar sólo los manifiestos para aprovechar la caché de capas:
# mientras package.json no cambie, esta capa no se reconstruye.
COPY package.json package-lock.json ./

# npm ci garantiza reproducibilidad; --omit=dev excluye nodemon, etc.
RUN npm ci --omit=dev --ignore-scripts


# ── Stage 2: imagen de producción ────────────────────────────
FROM node:24-slim AS final

# Metadatos
LABEL org.opencontainers.image.title="LiveChat Pro" \
      org.opencontainers.image.description="Chat en vivo auto-hospedado con integración Telegram" \
      org.opencontainers.image.source="https://github.com/tu-usuario/livechat-pro"

# Variables de entorno de Node.js para producción
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Copiar node_modules ya instalados desde la stage anterior
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copiar solo los ficheros necesarios en runtime para reducir el contexto efectivo
# y evitar trabajo extra de chown sobre archivos de desarrollo.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server.js db.js widget.js cluster-state.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node kb-trainer ./kb-trainer

# Crear el directorio de datos con el propietario correcto para el usuario node.
RUN mkdir -p /app/data && chown node:node /app/data

# Cambiar a usuario no-root antes de ejecutar el proceso
USER node

# Documentar el puerto por defecto (el valor real lo aporta --env-file o el compose)
EXPOSE 3000

# Healthcheck usando Node.js puro — no depende de curl/wget
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e " \
    const h = require('http'); \
    h.get('http://localhost:' + (process.env.PORT || 3000) + '/health', r => { \
      process.exit(r.statusCode === 200 ? 0 : 1); \
    }).on('error', () => process.exit(1));"

CMD ["node", "server.js"]
