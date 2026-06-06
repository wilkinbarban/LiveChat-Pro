# Exploration: Document Config Scenarios

This exploration details the current state of documentation regarding configuration and deployment options in `README.md`, `README_ES.md`, and `README_BR.md`, and formulates the exact changes needed to document the subpath (Nginx/reverse proxy) and direct-execution (localhost/public IP) deployment scenarios.

## 1. Current State & Analysis

Currently, the configuration and deployment options are discussed briefly under the **Nginx and HTTPS** / **Nginx y HTTPS** / **Nginx e HTTPS** sections in each of the three README files:
- **README.md** (Lines 629–654): Focuses on setting up Nginx with HTTPS on a domain (e.g. `chat.mydomain.com`), basic Certbot installation, and `ALLOWED_ORIGINS`.
- **README_ES.md** (Lines 533–558): Explains the same setup in Spanish using `chat.midominio.com`.
- **README_BR.md** (Lines 532–557): Explains the same setup in Portuguese using `chat.meudominio.com`.

**Identified Gap:**
None of these files present concrete, comparative examples showing:
1. Environment variables (`.env`).
2. HTML snippets to paste into websites for embedding the widget.
3. Specific Nginx configuration blocks for hosting under a subpath (e.g., `/chat`).

## 2. Integration Strategy

We will insert a new section called **Configuration Scenarios** (and its translations) immediately after the Nginx/HTTPS section in each file:
- In `README.md`: Insert `## Configuration Scenarios` after `## Nginx and HTTPS` (before `## Main Files`).
- In `README_ES.md`: Insert `## Escenarios de Configuración` after `## Nginx y HTTPS` (before `## Archivos Principales`).
- In `README_BR.md`: Insert `## Cenários de Configuração` after `## Nginx e HTTPS` (before `## Arquivos Principais`).

---

## 3. Subpath Compatibility Verification

We analyzed the recent subpath implementation to ensure it does not break localhost/public IP direct execution:
1. **Dynamic Base Path Resolver (`getBasePath()`)**:
   - `public/admin.html` and `public/index.html` evaluate the base path dynamically from `window.location.pathname`.
   - When hosted on `http://localhost:3000/admin.html` or `http://192.168.1.100:3000/`, `window.location.pathname` resolves to `/admin.html` or `/`, causing `getBasePath()` to evaluate to `""` (empty string).
   - `resolvePath(path)` checks if `base` is falsy and returns the route as-is (e.g., `/api/admin/me` is not modified/prefixed).
2. **Widget Socket.io Connection (`widget.js`)**:
   - `SERVER_URL` is parsed via `new URL(serverUrlClean)`.
   - For direct localhost deployment, `baseSubpath` is parsed as `""`.
   - The Socket.io client option `path` resolves to `(baseSubpath ? baseSubpath : '') + '/socket.io'`, which evaluates to `/socket.io`. This perfectly targets the default server namespace path.
3. **Tests**:
   - Running `npm test` completes successfully. All 98 tests pass, validating that code logic remains fully compatible.

---

## 4. Proposed Content Blocks

### README.md (English)

```markdown
## Configuration Scenarios

To help you configure and deploy LiveChat Pro, two common setup scenarios are detailed below.

### Scenario A: Production Deployment Under a Subpath (e.g. `/chat`) with HTTPS/Nginx

This setup serves the chat application under a subpath `/chat` (e.g., `https://mywebsite.com/chat/`) behind Nginx, which acts as a reverse proxy and handles SSL (HTTPS).

#### 1. Environment Configuration (`.env`)
Configure the server environment variables as follows:
```env
PORT="3000"
HOST_PORT="8080"
NODE_ENV="production"
ALLOWED_ORIGINS="https://mywebsite.com,https://www.mywebsite.com"
COOKIE_SAME_SITE="none"
```

#### 2. Nginx Reverse Proxy Block
Place the following inside your Nginx server block (usually `/etc/nginx/sites-available/livechat`). Make sure you have configured SSL certificates (e.g., via Let's Encrypt).
```nginx
upstream livechat_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 443 ssl;
    server_name mywebsite.com;

    ssl_certificate     /etc/letsencrypt/live/mywebsite.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mywebsite.com/privkey.pem;

    # Support upgrading to WebSocket connections
    location /chat/ {
        proxy_pass http://livechat_backend/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Explicit routing for WebSocket socket.io path
    location /chat/socket.io/ {
        proxy_pass http://livechat_backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

#### 3. HTML Snippet for Embedding the Widget
Embed the widget on your pages using the `/chat` subpath URL:
```html
<!-- Without API Key -->
<script src="https://mywebsite.com/chat/widget.js" data-server="https://mywebsite.com/chat"></script>

<!-- With API Key -->
<script src="https://mywebsite.com/chat/widget.js" data-server="https://mywebsite.com/chat" data-api-key="lcp_public_example_key_123"></script>
```

---

### Scenario B: Development / Localhost / Public IP Direct Deployment

This setup is used for running the application directly on a specific port without a domain or reverse proxy subpath.

#### 1. Environment Configuration (`.env`)
```env
PORT="3000"
HOST_PORT="3000"
NODE_ENV="development"
ALLOWED_ORIGINS="*"
COOKIE_SAME_SITE="lax"
```

#### 2. HTML Snippets for Embedding the Widget

**Localhost Development (port 3000):**
```html
<script src="http://localhost:3000/widget.js" data-server="http://localhost:3000"></script>
```

**Direct Host / Public IP Execution (e.g., 192.168.1.100:3000):**
```html
<script src="http://192.168.1.100:3000/widget.js" data-server="http://192.168.1.100:3000"></script>
```
```

### README_ES.md (Spanish)

```markdown
## Escenarios de Configuración

Para ayudarte a configurar y desplegar LiveChat Pro, a continuación se detallan los dos escenarios de instalación más comunes.

### Escenario A: Despliegue en Producción bajo un Subpath (ej. `/chat`) con HTTPS/Nginx

Esta configuración expone la aplicación de chat bajo la subruta `/chat` (ej., `https://mywebsite.com/chat/`) detrás de Nginx, que actúa como proxy inverso y gestiona SSL (HTTPS).

#### 1. Configuración de Entorno (`.env`)
Configura las variables de entorno del servidor de la siguiente manera:
```env
PORT="3000"
HOST_PORT="8080"
NODE_ENV="production"
ALLOWED_ORIGINS="https://mywebsite.com,https://www.mywebsite.com"
COOKIE_SAME_SITE="none"
```

#### 2. Bloque de Proxy Inverso en Nginx
Añade el siguiente bloque a tu configuración de servidor en Nginx (normalmente en `/etc/nginx/sites-available/livechat`). Asegúrate de contar con certificados SSL configurados (ej., usando Let's Encrypt).
```nginx
upstream livechat_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 443 ssl;
    server_name mywebsite.com;

    ssl_certificate     /etc/letsencrypt/live/mywebsite.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mywebsite.com/privkey.pem;

    # Soporte para la actualización a conexiones WebSocket
    location /chat/ {
        proxy_pass http://livechat_backend/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Enrutamiento explícito para la ruta socket.io de WebSockets
    location /chat/socket.io/ {
        proxy_pass http://livechat_backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

#### 3. Fragmento HTML para Incrustar el Widget
Incrusta el widget en tus páginas utilizando la URL con el subpath `/chat`:
```html
<!-- Sin API Key -->
<script src="https://mywebsite.com/chat/widget.js" data-server="https://mywebsite.com/chat"></script>

<!-- Con API Key -->
<script src="https://mywebsite.com/chat/widget.js" data-server="https://mywebsite.com/chat" data-api-key="lcp_public_example_key_123"></script>
```

---

### Escenario B: Despliegue Directo en Desarrollo / Localhost / IP Pública

Esta configuración se utiliza para ejecutar la aplicación directamente en un puerto específico sin necesidad de un dominio o subpath en proxy inverso.

#### 1. Configuración de Entorno (`.env`)
```env
PORT="3000"
HOST_PORT="3000"
NODE_ENV="development"
ALLOWED_ORIGINS="*"
COOKIE_SAME_SITE="lax"
```

#### 2. Fragmentos HTML para Incrustar el Widget

**Desarrollo en Localhost (puerto 3000):**
```html
<script src="http://localhost:3000/widget.js" data-server="http://localhost:3000"></script>
```

**Ejecución con Host Directo o IP Pública (ej., 192.168.1.100:3000):**
```html
<script src="http://192.168.1.100:3000/widget.js" data-server="http://192.168.1.100:3000"></script>
```
```

### README_BR.md (Portuguese)

```markdown
## Cenários de Configuração

Para ajudá-lo a configurar e implantar o LiveChat Pro, abaixo são detalhados os dois cenários de instalação mais comuns.

### Cenário A: Implantação em Produção sob um Subpath (ex. `/chat`) com HTTPS/Nginx

Esta configuração expõe o aplicativo de chat sob o subcaminho `/chat` (ex., `https://mywebsite.com/chat/`) atrás do Nginx, que atua como proxy reverso e gerencia SSL (HTTPS).

#### 1. Configuração de Ambiente (`.env`)
Configure as variáveis de ambiente do servidor da seguinte forma:
```env
PORT="3000"
HOST_PORT="8080"
NODE_ENV="production"
ALLOWED_ORIGINS="https://mywebsite.com,https://www.mywebsite.com"
COOKIE_SAME_SITE="none"
```

#### 2. Bloco de Proxy Reverso no Nginx
Adicione o seguinte bloco à sua configuração de servidor no Nginx (normalmente em `/etc/nginx/sites-available/livechat`). Certifique-se de ter os certificados SSL configurados (ex., via Let's Encrypt).
```nginx
upstream livechat_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 443 ssl;
    server_name mywebsite.com;

    ssl_certificate     /etc/letsencrypt/live/mywebsite.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mywebsite.com/privkey.pem;

    # Suporte para upgrade de conexões WebSocket
    location /chat/ {
        proxy_pass http://livechat_backend/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Roteamento explícito para o caminho socket.io de WebSockets
    location /chat/socket.io/ {
        proxy_pass http://livechat_backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

#### 3. Fragmento HTML para Incorporar o Widget
Incorpore o widget em suas páginas usando a URL com o subcaminho `/chat`:
```html
<!-- Sem chave de API (API Key) -->
<script src="https://mywebsite.com/chat/widget.js" data-server="https://mywebsite.com/chat"></script>

<!-- Com chave de API (API Key) -->
<script src="https://mywebsite.com/chat/widget.js" data-server="https://mywebsite.com/chat" data-api-key="lcp_public_example_key_123"></script>
```

---

### Cenário B: Implantação Direta em Desenvolvimento / Localhost / IP Público

Esta configuração é usada para executar o aplicativo diretamente em uma porta específica, sem necessidade de um domínio ou subcaminho em proxy reverso.

#### 1. Configuração de Ambiente (`.env`)
```env
PORT="3000"
HOST_PORT="3000"
NODE_ENV="development"
ALLOWED_ORIGINS="*"
COOKIE_SAME_SITE="lax"
```

#### 2. Fragmentos HTML para Incorporar o Widget

**Desenvolvimento em Localhost (porta 3000):**
```html
<script src="http://localhost:3000/widget.js" data-server="http://localhost:3000"></script>
```

**Execução com Host Direto ou IP Público (ex., 192.168.1.100:3000):**
```html
<script src="http://192.168.1.100:3000/widget.js" data-server="http://192.168.1.100:3000"></script>
```
```
