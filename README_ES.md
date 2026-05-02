# LiveChat Pro

> Proyecto educativo: este repositorio está pensado para aprendizaje, experimentación y referencia técnica. Revisa, endurece y adapta la configuración antes de usarlo en producción.

[Español](README_ES.md) | [English](README.md) | [Português](README_BR.md)

Chat en vivo auto-hospedado con widget embebible, integración con Telegram, panel web de administración único, persistencia SQLite y despliegue recomendado con Docker.

## Qué Hace

- Inserta un chat en cualquier web con un solo `<script>`.
- Mantiene una sesión por visitante con historial persistente.
- Envía mensajes del visitante a Telegram y al panel web `/admin`.
- Permite responder desde Telegram o desde el panel admin.
- Muestra IP, geolocalización, página actual, idioma, user-agent y métricas generales.
- Permite limpiar, bloquear, banear o eliminar chats individuales.
- Traduce mensajes entre el idioma del visitante y el idioma configurado para el admin.

## Requisitos

Para desarrollo local:

- Node.js del sistema `>=24`
- npm
- Acceso a internet para instalar dependencias y usar traducción automática

Para VPS público:

- Linux con usuario que tenga `sudo`
- Node.js del sistema `>=24`
- Docker Engine + plugin Docker Compose
- Puerto `8080/tcp` abierto para LiveChat Pro
- Bot de Telegram creado con [@BotFather](https://t.me/BotFather)
- Tu ID numérico de Telegram

`setup.js` valida Node.js del sistema antes de continuar. Para poder ejecutarlo debe existir primero el comando `node`; si esa versión inicial es menor que v24 o no trae `npm`, el instalador intenta actualizar a Node.js 24 en distribuciones soportadas. En Ubuntu/Debian elimina paquetes antiguos `nodejs`/`npm`, agrega el repositorio NodeSource 24.x, instala `nodejs` y luego verifica `node --version` y `npm --version`. También valida Docker/Compose y puede instalar Docker en distribuciones soportadas.

El proyecto utiliza únicamente Node.js del sistema.

## Instalación con un Comando

Primero asegúrate de que el comando `node` existe. Si el servidor está limpio y no tiene Node.js instalado, instala el paquete inicial según tu distro:

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

Fedora:

```bash
sudo dnf install -y nodejs npm
```

CentOS/RHEL/Rocky Linux/AlmaLinux:

```bash
sudo dnf install -y nodejs npm
```

Si tu sistema usa `yum`:

```bash
sudo yum install -y nodejs npm
```

Arch Linux:

```bash
sudo pacman -Sy --noconfirm nodejs npm
```

Alpine Linux:

```bash
sudo apk add --no-cache nodejs npm
```

Después ejecuta la instalación de un clic:

```bash
git clone https://github.com/wilkinbarban/LiveChat-Pro.git && cd LiveChat-Pro && node setup.js
```

Si ese primer paquete instala una versión antigua de Node.js, como `v12.22.9` en Ubuntu, el instalador intentará actualizarla primero a Node.js 24 y después continuará con el asistente guiado.

## Inicio Rápido Local

```bash
sudo npm install
node setup.js
sudo node server.js
```

Después abre:

- Demo del widget: `http://localhost:3000/`
- Panel admin: `http://localhost:3000/admin`
- Estado: `http://localhost:3000/health`

## Instalación Recomendada en VPS

```bash
git clone https://github.com/wilkinbarban/LiveChat-Pro.git && cd LiveChat-Pro && node setup.js
```

Durante el asistente, elige:

```text
Perfil de despliegue: VPS público con Docker
Modo de arranque: Docker con docker compose up -d
```

Ese perfil configura:

```env
PORT="3000"
HOST_PORT="8080"
```

Node escucha dentro del contenedor en `3000`, pero Docker publica el proyecto hacia internet en `8080`. Este puerto es la opción recomendada para dejar `80` y `443` libres para tu sitio web público o para un proxy HTTPS.

Si no tienes dominio todavía, `setup.js` detecta la IP pública del VPS y genera un script como:

```html
<script src="http://IP-PUBLICA:8080/widget.js" data-server="http://IP-PUBLICA:8080"></script>
```

Si tienes dominio, escríbelo cuando el asistente pregunte por dominio/orígenes permitidos:

```text
midominio.com
https://chat.midominio.com
```

Al finalizar, el instalador muestra la URL del demo, panel admin, healthcheck y el `<script>` final para pegar en la web externa.

Para omitir checks de sistema en CI o pruebas:

```bash
LIVECHAT_SKIP_SYSTEM_CHECKS=1 node setup.js
```

Si `setup.js` falla al validar permisos elevados, ejecuta el instalador desde una terminal interactiva para que `sudo` pueda pedir contraseña. En ejecuciones automatizadas puedes validar antes con:

```bash
sudo -v
node setup.js
```

Si tu usuario no tiene permisos sudo, entra como root o agrega el usuario al grupo sudo/wheel antes de instalar Node.js, Docker o abrir el firewall.

## Docker

Si ya tienes `.env` configurado:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f livechat
```

Con `HOST_PORT=8080`, revisa:

```bash
curl http://localhost:8080/health
```

En Docker, el directorio interno `/app/data` se monta sobre el volumen `livechat_data`. Por eso la base SQLite real del contenedor queda dentro de ese volumen como `/app/data/livechat.db` y sobrevive a reinicios y reconstrucciones.

Importante: el archivo `data/livechat.db` que puedas ver en el directorio del proyecto pertenece a ejecuciones locales sin Docker o a datos antiguos del host. No es necesariamente la base que está usando el contenedor. Para inspeccionar la base activa en Docker, entra al contenedor o copia el archivo desde el volumen/contenedor.

Actualizar:

```bash
git pull
docker compose up -d --build
```

Detener:

```bash
docker compose down
```

Borrar contenedores y datos persistentes:

```bash
docker compose down -v
```

## Sin Docker

```bash
sudo npm install
node setup.js
sudo node server.js
```

Con PM2:

```bash
npm install -g pm2
pm2 start server.js --name livechat-pro
pm2 startup
pm2 save
```

## Variables de Entorno

El archivo `.env` lo genera `node setup.js`. También puedes crearlo manualmente.

| Variable | Obligatoria | Descripción |
|---|---:|---|
| `TELEGRAM_TOKEN` | Sí | Token del bot de Telegram |
| `TELEGRAM_ADMIN_ID` | Sí | ID numérico del admin en Telegram |
| `ADMIN_PANEL_PASSWORD` | Sí | Contraseña para `/admin` |
| `ADMIN_LANGUAGE` | No | Idioma del admin: `es`, `en`, `pt`, `fr`, `de`, `it` |
| `PORT` | No | Puerto interno de Node. Defecto: `3000` |
| `HOST_PORT` | No | Puerto publicado por Docker. En VPS público usa `8080` para dejar `80`/`443` libres |
| `ALLOWED_ORIGINS` | No | Orígenes CORS permitidos, separados por coma |
| `ADMIN_SESSION_TTL_HOURS` | No | Duración de sesión admin. Defecto: `12` |
| `COOKIE_SAME_SITE` | No | Política SameSite de cookies admin: `lax`, `strict` o `none`. Defecto: `lax`; `none` requiere HTTPS |
| `LOG_LEVEL` | No | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `DB_PATH` | No | Ruta SQLite. Defecto: `data/livechat.db` |
| `WIDGET_PRIMARY_COLOR` | No | Color principal del widget |
| `WIDGET_BUTTON_STYLE` | No | `floating`, `persistent` o `hidden` |
| `WIDGET_WELCOME_MESSAGE` | No | Mensaje fijo. Vacío activa saludo automático por idioma |
| `WIDGET_API_KEY` | No | Credencial opcional del widget. Si se define, el cliente debe enviarla en `data-api-key` o el servidor rechazará la conexión del chat |
| `FEATURE_TRANSLATION` | No | `true`/`false` |
| `TRANSLATION_PROVIDER` | No | Proveedor de traducción: `google_free`, `google_cloud` o `deepl`. Defecto: `google_free` |
| `TRANSLATION_API_KEY` | No | API key para `google_cloud` o `deepl`; si falta, se usa el fallback gratuito |
| `FEATURE_GEOLOCATION` | No | `true`/`false` |
| `FEATURE_SENTIMENT` | No | `true`/`false` |
| `FEATURE_GHOST_TYPING` | No | `true`/`false` |
| `REDIS_URL` | No | Redis para estado compartido/Socket.IO multi-nodo |
| `REDIS_KEY_PREFIX` | No | Prefijo de claves Redis. Defecto: `lcp` |
| `RATE_LIMIT_WINDOW_MINUTES` | No | Ventana de rate limit. Defecto: `15` |
| `RATE_LIMIT_PUBLIC_MAX` | No | Máximo para rutas públicas como `widget.js` y `/config-public`. Defecto: `300` |
| `RATE_LIMIT_ADMIN_MAX` | No | Máximo para admin no autenticado. Admin autenticado queda excluido. Defecto: `2000` |
| `RATE_LIMIT_LOGIN_MAX` | No | Máximo de intentos a `/api/admin/login`. Defecto: `20` |
| `TRUST_PROXY_HOPS` | No | Saltos de proxy confiables para IP real. Defecto: `1` |

Ejemplo VPS por IP:

```env
PORT="3000"
HOST_PORT="8080"
ALLOWED_ORIGINS="http://185.194.221.162:8080"
```

Ejemplo con dominio HTTPS:

```env
PORT="3000"
HOST_PORT="8080"
ALLOWED_ORIGINS="https://chat.midominio.com"
```

## Widget

Pega el script generado por `setup.js` en la web donde quieres mostrar el chat:

```html
<script src="https://chat.midominio.com/widget.js" data-server="https://chat.midominio.com"></script>
```

Si configuraste `WIDGET_API_KEY`:

```html
<script src="https://chat.midominio.com/widget.js" data-server="https://chat.midominio.com" data-api-key="TU_API_KEY"></script>
```

`WIDGET_API_KEY` sirve para que solo los sitios que tengan tu snippet completo puedan iniciar conexiones del chat. No reemplaza CORS ni convierte el widget en privado, porque cualquier clave puesta en HTML puede verse desde el navegador, pero ayuda a evitar integraciones accidentales o clientes sin la credencial esperada.

Ejemplo de `.env`:

```env
WIDGET_API_KEY="clave-larga-random-para-mi-web"
```

Ejemplo del script en tu sitio:

```html
<script
  src="https://chat.midominio.com/widget.js"
  data-server="https://chat.midominio.com"
  data-api-key="clave-larga-random-para-mi-web">
</script>
```

Si eliges `WIDGET_BUTTON_STYLE="hidden"` o la opción `Oculto, para abrirlo por código` en `setup.js`, el widget se carga pero no muestra el botón flotante. Puedes abrir el chat con tu propio botón:

```html
<script src="https://chat.midominio.com/widget.js" data-server="https://chat.midominio.com"></script>

<button type="button" onclick="document.getElementById('lcp-btn')?.click()">
  Abrir chat
</button>
```

Con `WIDGET_API_KEY` y botón oculto:

```html
<script
  src="https://chat.midominio.com/widget.js"
  data-server="https://chat.midominio.com"
  data-api-key="clave-larga-random-para-mi-web">
</script>

<button type="button" onclick="document.getElementById('lcp-btn')?.click()">
  Abrir chat
</button>
```

El widget guarda la sesión del visitante con `localStorage` y cookie `lchat_sid`.

### Comportamiento responsive del widget

El widget detecta automáticamente el modo móvil del sitio donde está instalado con `window.matchMedia`. Por defecto entra en modo móvil cuando el viewport mide `768px` o menos. Si el navegador no soporta `matchMedia`, usa `window.innerWidth` como fallback.

Cuando cambia el tamaño de pantalla o el usuario rota el dispositivo, el widget actualiza su clase interna `lcp-mobile` sin recargar la página. En escritorio se mantiene como ventana flotante; en móvil deja de ser flotante y se convierte en una barra inferior fija tipo menú.

Al abrirlo en móvil, el chat usa una vista controlada de pantalla completa: header fijo, mensajes con scroll interno e input fijo abajo. Esto evita que la ventana del chat mida más que la resolución visible del sitio.

Con `data-theme="auto"`, el widget toma la fuente, color de texto, fondo base y acento del sitio donde se inserta. Esto evita que el chat desplegado se vea como una pieza visual ajena en el modo celular.

Al abrir el chat en móvil, el panel se limita con `visualViewport` cuando el navegador lo soporta. Esto mantiene el área de mensajes e input dentro de la pantalla visible, incluso cuando aparece el teclado del celular. El CSS interno del widget se encapsula con Shadow DOM para reducir conflictos con estilos del sitio.

Puedes personalizar el comportamiento por sitio con atributos del script:

```html
<script
  src="https://chat.midominio.com/widget.js"
  data-server="https://chat.midominio.com"
  data-mobile-breakpoint="820"
  data-mobile-mode="dock"
  data-mobile-width="100"
  data-mobile-focused-width="94"
  data-mobile-focused-height="76"
  data-theme="auto"
  data-position="bottom-right">
</script>
```

Opciones disponibles:

- `data-mobile-breakpoint`: ancho máximo considerado móvil. Defecto: `768`.
- `data-mobile-mode`: `dock`, `compact`, `bottom-sheet` o `fullscreen`. Defecto: `dock`.
- `data-mobile-width`: ancho del panel abierto en móvil, en porcentaje del viewport. Defecto: `100`. Rango permitido: `70` a `100`.
- `data-mobile-focused-width`: ancho del panel móvil cuando el campo de texto tiene foco y aparece el teclado, en porcentaje del viewport. Defecto: `94`. Rango permitido: `70` a `100`.
- `data-mobile-focused-height`: alto máximo del panel móvil cuando el campo de texto tiene foco y aparece el teclado, en porcentaje del viewport visible. Defecto: `76`. Rango permitido: `50` a `95`.
- `data-theme`: `auto` hereda fuente, texto, fondo y tono visual del sitio; `classic` usa el diseño de marca del widget.
- `data-position`: `bottom-right` o `bottom-left`.

Para un sitio móvil donde el teclado tapa demasiado el historial, puedes reducir un poco el panel enfocado:

```html
<script
  src="https://chat.midominio.com/widget.js"
  data-server="https://chat.midominio.com"
  data-mobile-mode="dock"
  data-mobile-focused-width="92"
  data-mobile-focused-height="68">
</script>
```

También puedes definirlas antes del script con `window.LiveChatConfig`:

```html
<script>
  window.LiveChatConfig = {
    mobileBreakpoint: 820,
    mobileMode: 'dock',
    mobileWidth: 100,
    mobileFocusedWidth: 92,
    mobileFocusedHeight: 68,
    theme: 'auto',
    position: 'bottom-left'
  };
</script>
<script src="https://chat.midominio.com/widget.js" data-server="https://chat.midominio.com"></script>
```

## Panel Admin

Accede a:

```text
http://TU_IP:8080/admin
https://chat.midominio.com/admin
```

El panel está diseñado para uso de un único admin del sistema, sin flujos de personal externo.

Funciones:

- Ver todos los chats por usuario.
- Buscar por nombre, ID, IP, país o página.
- Ver geolocalización, IP, ISP, idioma, página actual y user-agent.
- Ver métricas generales de usuarios, conectados, desconectados, mensajes y bloqueos.
- Responder al usuario.
- Limpiar chat individual.
- Bloquear o banear usuario.
- Eliminar sesión y mensajes.

### API Admin Actual

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/admin/me` | Estado de autenticación |
| `POST` | `/api/admin/login` | Iniciar sesión |
| `POST` | `/api/admin/logout` | Cerrar sesión |
| `GET` | `/api/admin/sessions` | Listar sesiones |
| `GET` | `/api/admin/sessions/:id` | Detalle de sesión y mensajes |
| `POST` | `/api/admin/sessions/:id/message` | Responder al usuario |
| `POST` | `/api/admin/sessions/:id/typing` | Indicador de escritura admin |
| `POST` | `/api/admin/sessions/:id/read` | Marcar lectura |
| `GET` | `/api/admin/metrics/general` | Métricas generales |
| `POST` | `/api/admin/sessions/:id/clear` | Limpiar chat |
| `POST` | `/api/admin/sessions/:id/block` | Bloquear usuario |
| `POST` | `/api/admin/sessions/:id/ban` | Banear usuario |
| `DELETE` | `/api/admin/sessions/:id` | Eliminar sesión |

Las acciones mutantes usan protección CSRF con cookie `lcp_csrf` y header `x-csrf-token`.

El rate limit está separado por zona:

- Login admin: protegido por `RATE_LIMIT_LOGIN_MAX`.
- Rutas públicas del widget: protegidas por `RATE_LIMIT_PUBLIC_MAX`.
- API admin no autenticada: protegida por `RATE_LIMIT_ADMIN_MAX`.
- Admin autenticado: no consume el cupo del limitador admin.

## Telegram

| Comando | Descripción |
|---|---|
| `/usuarios` | Lista usuarios activos |
| `/ban [id]` | Banea por prefijo de `sessionId` |
| `/info [id]` | Muestra IP, ubicación, user-agent y página |
| `/clean` | Elimina sesiones inactivas sin mensajes |

Para responder desde Telegram, responde directamente al mensaje que llegó para esa sesión.

## Traducción e Idiomas

El widget detecta el idioma del navegador del visitante y lo guarda en la sesión.

Saludos automáticos soportados:

| Idioma | Código |
|---|---|
| Español | `es` |
| Inglés | `en` |
| Portugués | `pt` |

El admin puede trabajar en:

```text
es, en, pt, fr, de, it
```

Flujo:

1. Visitante escribe en su idioma.
2. El admin ve el mensaje traducido a `ADMIN_LANGUAGE`.
3. El admin responde.
4. La respuesta se traduce al idioma de la sesión.
5. El visitante recibe la respuesta en su idioma.

La traducción depende de `FEATURE_TRANSLATION="true"`.

## Arquitectura

```text
Visitante web
  │
  │ Socket.IO
  ▼
server.js
  ├─ Express REST
  ├─ Socket.IO widget
  ├─ Socket.IO /admin
  ├─ Telegraf Telegram
  └─ db.js SQLite
        ▼
   /app/data/livechat.db
   ▲ dentro de Docker: volumen livechat_data montado en /app/data
```

En ejecución local sin Docker, la ruta por defecto sí es `data/livechat.db` dentro del directorio del proyecto.

Flujo de mensaje:

1. El widget conecta por Socket.IO.
2. El servidor crea o restaura la sesión.
3. El mensaje se guarda en SQLite.
4. El mensaje se envía a Telegram y al panel admin.
5. El admin responde desde Telegram o `/admin`.
6. El servidor traduce si hace falta.
7. El visitante recibe la respuesta por Socket.IO.

## Redis Opcional

Docker Compose incluye Redis y configura:

```env
REDIS_URL="redis://redis:6379"
REDIS_KEY_PREFIX="lcp"
```

Redis se usa para presencia, estado compartido y adaptador Socket.IO cuando hay varios nodos.

Para instalación local sin Docker:

```env
REDIS_URL="redis://127.0.0.1:6379"
```

Si `/health` devuelve `stateMode: "redis"`, Redis está activo.

## Nginx y HTTPS

Para dominio real con HTTPS puedes usar el archivo incluido:

```bash
sudo cp nginx/livechat.conf /etc/nginx/sites-available/livechat
sudo ln -s /etc/nginx/sites-available/livechat /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Certificado con Certbot:

```bash
sudo certbot --nginx -d chat.midominio.com
```

Luego ajusta:

```env
ALLOWED_ORIGINS="https://chat.midominio.com"
```

Las cookies admin se marcan como `Secure` cuando la petición llega por HTTPS o por proxy con `X-Forwarded-Proto: https`. En desarrollo por IP HTTP funcionan sin `Secure`.

La geolocalización del admin depende de que Node reciba la IP pública real del visitante. La plantilla `nginx/livechat.conf` ya envía `X-Real-IP` y `X-Forwarded-For`; si el panel muestra IPs `127.x`, `10.x`, `172.16-31.x` o `192.168.x`, el servidor está viendo una IP privada de Docker/proxy y la ubicación aparecerá como desconocida. En ese caso usa Nginx/HTTPS delante del contenedor o verifica que el proxy conserve esas cabeceras.

## Archivos Principales

```text
server.js           Servidor Express, Socket.IO y Telegram
widget.js           Widget embebible
setup.js            Instalador interactivo
db.js               Persistencia SQLite
cluster-state.js    Estado compartido opcional con Redis
public/index.html   Demo del widget
public/admin.html   Panel admin único
docker-compose.yml  App + Redis + volúmenes
Dockerfile          Imagen de producción
nginx/livechat.conf Proxy inverso HTTPS
tests/              Pruebas automáticas
data/livechat.db    Base SQLite en ejecución local sin Docker
```

## Pruebas

```bash
npm test
npm run test:db
npm run test:api
```

Las pruebas usan `node:test` y SQLite en memoria para no tocar datos reales.

## Estado del Sistema

```text
/health
/health?format=json
```

Muestra estado general, sesiones en memoria, modo de estado (`memory` o `redis`), Telegram, uptime, configuración pública del widget y funciones activas.

## Seguridad

- Usa contraseña fuerte para `ADMIN_PANEL_PASSWORD`.
- En producción con dominio, usa HTTPS.
- Restringe `ALLOWED_ORIGINS` al dominio real.
- Abre solo los puertos necesarios en el VPS.
- Si usas `WIDGET_API_KEY`, el widget debe incluir `data-api-key`.

## Funcionalidades Implementadas

- Chat en tiempo real con Socket.IO.
- Widget embebible.
- Panel admin único.
- Integración Telegram.
- Persistencia SQLite.
- Métricas generales.
- Limpieza, bloqueo, baneo y eliminación por chat.
- Traducción automática.
- Geolocalización por IP.
- Read receipts.
- Ghost typing hacia Telegram.
- Rate limiting HTTP y por socket.
- Helmet y CSRF en acciones admin.
- Docker Compose con Redis.
- Setup interactivo para VPS público o desarrollo local.
- Suite de tests automatizada.

## Documentación del Proyecto

- [README en inglés](README.md)
- [README en portugués](README_BR.md)
- [Índice de documentación](docs/README.md)
- [Guía de contribución](CONTRIBUTING.md)
- [Política de seguridad](SECURITY.md)
- [Licencia GPL](LICENSE)
