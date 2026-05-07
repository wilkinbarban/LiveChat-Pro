# LiveChat Pro

> Projeto educativo: este repositório foi pensado para aprendizado, experimentação e referência técnica. Revise, reforce e adapte a configuração antes de usá-lo em produção.

[Español](README_ES.md) | [English](README.md) | [Português](README_BR.md)

Chat ao vivo auto-hospedado com widget incorporável, integração com Telegram, painel web único de administração, persistência SQLite e implantação recomendada com Docker.

## O Que Faz

- Insere um chat em qualquer site com um único `<script>`.
- Mantém uma sessão por visitante com histórico persistente.
- Envia mensagens do visitante ao Telegram e ao painel web `/admin`.
- Permite responder pelo Telegram ou pelo painel admin.
- Mostra IP, geolocalização, página atual, idioma, user-agent e métricas gerais.
- Permite limpar, bloquear, banir ou excluir chats individuais.
- Traduz mensagens entre o idioma do visitante e o idioma configurado para o admin.

## Requisitos

Para desenvolvimento local:

- Node.js do sistema `>=24`
- npm
- Acesso à internet para instalar dependências e usar tradução automática

Para VPS público:

- Linux com usuário que tenha `sudo`
- Node.js do sistema `>=24`
- Docker Engine + plugin Docker Compose
- Porta `8080/tcp` aberta para o LiveChat Pro
- Bot do Telegram criado com [@BotFather](https://t.me/BotFather)
- Seu ID numérico do Telegram

`setup.js` valida o Node.js do sistema antes de continuar. O comando `node` precisa existir primeiro para que o instalador possa rodar; se essa versão inicial for menor que v24 ou não incluir `npm`, o instalador tenta atualizar para Node.js 24 nas distribuições suportadas. No Ubuntu/Debian ele remove pacotes antigos `nodejs`/`npm`, adiciona o repositório NodeSource 24.x, instala `nodejs` e depois verifica `node --version` e `npm --version`. Também valida Docker/Compose e pode instalar Docker em distribuições suportadas.

O projeto utiliza apenas o Node.js do sistema.

## Instalação com um Comando

Primeiro garanta que o comando `node` existe. Se o servidor estiver limpo e não tiver Node.js instalado, instale o pacote inicial para sua distro:

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y nodejs
```

Fedora:

```bash
sudo dnf install -y nodejs
```

CentOS/RHEL/Rocky Linux/AlmaLinux:

```bash
sudo dnf install -y nodejs
```

Se o seu sistema usa `yum`:

```bash
sudo yum install -y nodejs
```

Arch Linux:

```bash
sudo pacman -Sy --noconfirm nodejs
```

Alpine Linux:

```bash
sudo apk add --no-cache nodejs
```

Depois execute a instalação com um comando:

```bash
git clone https://github.com/wilkinbarban/LiveChat-Pro.git && cd LiveChat-Pro && node setup.js
```

Se esse primeiro pacote instalar uma versão antiga do Node.js, como `v12.22.9` no Ubuntu, o instalador tentará atualizá-la primeiro para Node.js 24 e depois continuará com o assistente guiado.

## Início Rápido Local

```bash
sudo npm install
node setup.js
sudo node server.js
```

Depois abra:

- Demo do widget: `http://localhost:3000/`
- Painel admin: `http://localhost:3000/admin`
- Status: `http://localhost:3000/health`

## Instalação Recomendada em VPS

```bash
git clone https://github.com/wilkinbarban/LiveChat-Pro.git && cd LiveChat-Pro && node setup.js
```

Durante o assistente, escolha:

```text
Perfil de implantação: VPS público com Docker
Modo de inicialização: Docker com docker compose up -d
```

Esse perfil configura:

```env
PORT="3000"
HOST_PORT="8080"
```

O Node escuta dentro do contêiner em `3000`, mas o Docker publica o projeto para a internet em `8080`. Essa porta é a opção recomendada para deixar `80` e `443` livres para seu site público ou para um proxy HTTPS.

Se você ainda não tem domínio, `setup.js` detecta o IP público do VPS e gera um script como:

```html
<script src="http://IP-PUBLICO:8080/widget.js" data-server="http://IP-PUBLICO:8080"></script>
```

Se você tem domínio, informe-o quando o assistente perguntar por domínio/origens permitidas:

```text
meudominio.com
https://chat.meudominio.com
```

Ao finalizar, o instalador mostra a URL do demo, painel admin, healthcheck e o `<script>` final para colar no site externo.

Para omitir verificações de sistema em CI ou testes:

```bash
LIVECHAT_SKIP_SYSTEM_CHECKS=1 node setup.js
```

Se `setup.js` falhar ao validar permissões elevadas, execute o instalador em um terminal interativo para que `sudo` possa pedir a senha. Em execuções automatizadas, você pode validar antes com:

```bash
sudo -v
node setup.js
```

Se seu usuário não tem permissões sudo, entre como root ou adicione o usuário ao grupo sudo/wheel antes de instalar Node.js, Docker ou abrir o firewall.

## Docker

Se você já tem `.env` configurado:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f livechat
```

Com `HOST_PORT=8080`, verifique:

```bash
curl http://localhost:8080/health
```

No Docker, o diretório interno `/app/data` é montado no volume `livechat_data`. Por isso, o banco SQLite real do contêiner fica dentro desse volume como `/app/data/livechat.db` e sobrevive a reinicializações e reconstruções.

Importante: o arquivo `data/livechat.db` que você pode ver no diretório do projeto pertence a execuções locais sem Docker ou a dados antigos do host. Não é necessariamente o banco que o contêiner está usando. Para inspecionar o banco ativo no Docker, entre no contêiner ou copie o arquivo a partir do volume/contêiner.

Atualizar:

```bash
git pull
docker compose up -d --build
```

Parar:

```bash
docker compose down
```

Apagar contêineres e dados persistentes:

```bash
docker compose down -v
```

## Sem Docker

```bash
sudo npm install
node setup.js
sudo node server.js
```

Com PM2:

```bash
npm install -g pm2
pm2 start server.js --name livechat-pro
pm2 startup
pm2 save
```

## Variáveis de Ambiente

O arquivo `.env` é gerado por `node setup.js`. Você também pode criá-lo manualmente.

| Variável | Obrigatória | Descrição |
|---|---:|---|
| `TELEGRAM_TOKEN` | Sim | Token do bot do Telegram |
| `TELEGRAM_ADMIN_ID` | Sim | ID numérico do admin no Telegram |
| `ADMIN_PANEL_PASSWORD` | Sim | Senha para `/admin` |
| `ADMIN_LANGUAGE` | Não | Idioma do admin: `es`, `en`, `pt`, `fr`, `de`, `it` |
| `PORT` | Não | Porta interna do Node. Padrão: `3000` |
| `HOST_PORT` | Não | Porta publicada pelo Docker. Em VPS público use `8080` para deixar `80`/`443` livres |
| `ALLOWED_ORIGINS` | Não | Origens CORS permitidas, separadas por vírgula |
| `ADMIN_SESSION_TTL_HOURS` | Não | Duração da sessão admin. Padrão: `12` |
| `COOKIE_SAME_SITE` | Não | Política SameSite dos cookies admin: `lax`, `strict` ou `none`. Padrão: `lax`; `none` requer HTTPS |
| `LOG_LEVEL` | Não | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `DB_PATH` | Não | Caminho SQLite. Padrão: `data/livechat.db` |
| `WIDGET_PRIMARY_COLOR` | Não | Cor principal do widget |
| `WIDGET_BUTTON_STYLE` | Não | `floating`, `persistent` ou `hidden` |
| `WIDGET_WELCOME_MESSAGE` | Não | Mensagem fixa. Vazio ativa saudação automática por idioma |
| `WIDGET_API_KEY` | Não | Credencial opcional do widget. Se definida, o cliente deve enviá-la em `data-api-key` ou o servidor rejeitará a conexão do chat |
| `FEATURE_TRANSLATION` | Não | `true`/`false` |
| `TRANSLATION_PROVIDER` | Não | Provedor de tradução: `google_free`, `google_cloud` ou `deepl`. Padrão: `google_free` |
| `TRANSLATION_API_KEY` | Não | API key para `google_cloud` ou `deepl`; se faltar, o fallback gratuito é usado |
| `FEATURE_GEOLOCATION` | Não | `true`/`false` |
| `FEATURE_SENTIMENT` | Não | `true`/`false` |
| `FEATURE_GHOST_TYPING` | Não | `true`/`false` |
| `REDIS_URL` | Não | Redis para estado compartilhado/Socket.IO multi-nó |
| `REDIS_KEY_PREFIX` | Não | Prefixo das chaves Redis. Padrão: `lcp` |
| `RATE_LIMIT_WINDOW_MINUTES` | Não | Janela de rate limit. Padrão: `15` |
| `RATE_LIMIT_PUBLIC_MAX` | Não | Máximo para rotas públicas como `widget.js` e `/config-public`. Padrão: `300` |
| `RATE_LIMIT_ADMIN_MAX` | Não | Máximo para admin não autenticado. Admin autenticado fica excluído. Padrão: `2000` |
| `RATE_LIMIT_LOGIN_MAX` | Não | Máximo de tentativas em `/api/admin/login`. Padrão: `20` |
| `TRUST_PROXY_HOPS` | Não | Saltos de proxy confiáveis para IP real. Padrão: `1` |

Exemplo VPS por IP:

```env
PORT="3000"
HOST_PORT="8080"
ALLOWED_ORIGINS="http://185.194.221.162:8080"
```

Exemplo com domínio HTTPS:

```env
PORT="3000"
HOST_PORT="8080"
ALLOWED_ORIGINS="https://chat.meudominio.com"
```

## Widget

Cole o script gerado por `setup.js` no site onde você quer mostrar o chat:

```html
<script src="https://chat.meudominio.com/widget.js" data-server="https://chat.meudominio.com"></script>
```

Se você configurou `WIDGET_API_KEY`:

```html
<script src="https://chat.meudominio.com/widget.js" data-server="https://chat.meudominio.com" data-api-key="SUA_API_KEY"></script>
```

`WIDGET_API_KEY` serve para que apenas os sites que tenham seu snippet completo possam iniciar conexões do chat. Não substitui CORS nem transforma o widget em privado, porque qualquer chave colocada no HTML pode ser vista pelo navegador, mas ajuda a evitar integrações acidentais ou clientes sem a credencial esperada.

Exemplo de `.env`:

```env
WIDGET_API_KEY="chave-longa-random-para-meu-site"
```

Exemplo do script no seu site:

```html
<script
  src="https://chat.meudominio.com/widget.js"
  data-server="https://chat.meudominio.com"
  data-api-key="chave-longa-random-para-meu-site">
</script>
```

Se você escolher `WIDGET_BUTTON_STYLE="hidden"` ou a opção `Oculto, para abrir por código` em `setup.js`, o widget carrega, mas não mostra o botão flutuante. Você pode abrir o chat com seu próprio botão:

```html
<script src="https://chat.meudominio.com/widget.js" data-server="https://chat.meudominio.com"></script>

<button type="button" onclick="document.getElementById('lcp-btn')?.click()">
  Abrir chat
</button>
```

Com `WIDGET_API_KEY` e botão oculto:

```html
<script
  src="https://chat.meudominio.com/widget.js"
  data-server="https://chat.meudominio.com"
  data-api-key="chave-longa-random-para-meu-site">
</script>

<button type="button" onclick="document.getElementById('lcp-btn')?.click()">
  Abrir chat
</button>
```

O widget salva a sessão do visitante com `localStorage` e cookie `lchat_sid`.

### Comportamento Responsivo do Widget

O widget detecta automaticamente o modo móvel do site onde está instalado com `window.matchMedia`. Por padrão entra em modo móvel quando o viewport mede `768px` ou menos. Se o navegador não suportar `matchMedia`, usa `window.innerWidth` como fallback.

Quando o tamanho da tela muda ou o usuário gira o dispositivo, o widget atualiza sua classe interna `lcp-mobile` sem recarregar a página. No desktop permanece como janela flutuante; no móvel deixa de ser flutuante e vira uma barra inferior fixa tipo menu.

Ao abri-lo no móvel, o chat usa uma visualização controlada em tela cheia: header fixo, mensagens com rolagem interna e input fixo embaixo. Isso evita que a janela do chat fique maior que a resolução visível do site.

Com `data-theme="auto"`, o widget usa a fonte, cor do texto, fundo base e acento do site onde é inserido. Isso evita que o chat aberto pareça uma peça visual desconectada no modo celular.

Ao abrir o chat no móvel, o painel é limitado com `visualViewport` quando o navegador suporta. Isso mantém a área de mensagens e input dentro da tela visível, mesmo quando aparece o teclado do celular. O CSS interno do widget é encapsulado com Shadow DOM para reduzir conflitos com estilos do site.

Você pode personalizar o comportamento por site com atributos do script:

```html
<script
  src="https://chat.meudominio.com/widget.js"
  data-server="https://chat.meudominio.com"
  data-mobile-breakpoint="820"
  data-mobile-mode="dock"
  data-mobile-width="100"
  data-mobile-focused-width="94"
  data-mobile-focused-height="76"
  data-theme="auto"
  data-position="bottom-right">
</script>
```

Opções disponíveis:

- `data-mobile-breakpoint`: largura máxima considerada móvel. Padrão: `768`.
- `data-mobile-mode`: `dock`, `compact`, `bottom-sheet` ou `fullscreen`. Padrão: `dock`.
- `data-mobile-width`: largura do painel aberto no móvel, em porcentagem do viewport. Padrão: `100`. Faixa permitida: `70` a `100`.
- `data-mobile-focused-width`: largura do painel móvel quando o campo de texto tem foco e o teclado aparece, em porcentagem do viewport. Padrão: `94`. Faixa permitida: `70` a `100`.
- `data-mobile-focused-height`: altura máxima do painel móvel quando o campo de texto tem foco e o teclado aparece, em porcentagem do viewport visível. Padrão: `76`. Faixa permitida: `50` a `95`.
- `data-theme`: `auto` herda fonte, texto, fundo e tom visual do site; `classic` usa o design de marca do widget.
- `data-position`: `bottom-right` ou `bottom-left`.

Para um site móvel onde o teclado cobre demais o histórico, você pode reduzir um pouco o painel focado:

```html
<script
  src="https://chat.meudominio.com/widget.js"
  data-server="https://chat.meudominio.com"
  data-mobile-mode="dock"
  data-mobile-focused-width="92"
  data-mobile-focused-height="68">
</script>
```

Também é possível defini-las antes do script com `window.LiveChatConfig`:

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
<script src="https://chat.meudominio.com/widget.js" data-server="https://chat.meudominio.com"></script>
```

## Painel Admin

Acesse:

```text
http://SEU_IP:8080/admin
https://chat.meudominio.com/admin
```

O painel foi desenhado para uso de um único admin do sistema, sem fluxos de equipe externa.

Funções:

- Ver todos os chats por usuário.
- Buscar por nome, ID, IP, país ou página.
- Ver geolocalização, IP, ISP, idioma, página atual e user-agent.
- Ver métricas gerais de usuários, conectados, desconectados, mensagens e bloqueios.
- Responder ao usuário.
- Limpar chat individual.
- Bloquear ou banir usuário.
- Excluir sessão e mensagens.

### API Admin Atual

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/admin/me` | Estado de autenticação |
| `POST` | `/api/admin/login` | Iniciar sessão |
| `POST` | `/api/admin/logout` | Encerrar sessão |
| `GET` | `/api/admin/sessions` | Listar sessões |
| `GET` | `/api/admin/sessions/:id` | Detalhe da sessão e mensagens |
| `POST` | `/api/admin/sessions/:id/message` | Responder ao usuário |
| `POST` | `/api/admin/sessions/:id/typing` | Indicador de escrita do admin |
| `POST` | `/api/admin/sessions/:id/read` | Marcar leitura |
| `GET` | `/api/admin/metrics/general` | Métricas gerais |
| `POST` | `/api/admin/sessions/:id/clear` | Limpar chat |
| `POST` | `/api/admin/sessions/:id/block` | Bloquear usuário |
| `POST` | `/api/admin/sessions/:id/ban` | Banir usuário |
| `DELETE` | `/api/admin/sessions/:id` | Excluir sessão |

As ações mutantes usam proteção CSRF com cookie `lcp_csrf` e header `x-csrf-token`.

O rate limit é separado por zona:

- Login admin: protegido por `RATE_LIMIT_LOGIN_MAX`.
- Rotas públicas do widget: protegidas por `RATE_LIMIT_PUBLIC_MAX`.
- API admin não autenticada: protegida por `RATE_LIMIT_ADMIN_MAX`.
- Admin autenticado: não consome a cota do limitador admin.

## Telegram

| Comando | Descrição |
|---|---|
| `/usuarios` | Lista usuários ativos |
| `/ban [id]` | Bane por prefixo de `sessionId` |
| `/info [id]` | Mostra IP, localização, user-agent e página |
| `/clean` | Exclui sessões inativas sem mensagens |

Para responder pelo Telegram, responda diretamente à mensagem que chegou para essa sessão.

## Tradução e Idiomas

O widget detecta o idioma do navegador do visitante e o salva na sessão.

Saudações automáticas suportadas:

| Idioma | Código |
|---|---|
| Espanhol | `es` |
| Inglês | `en` |
| Português | `pt` |

O admin pode trabalhar em:

```text
es, en, pt, fr, de, it
```

Fluxo:

1. Visitante escreve no seu idioma.
2. O admin vê a mensagem traduzida para `ADMIN_LANGUAGE`.
3. O admin responde.
4. A resposta é traduzida para o idioma da sessão.
5. O visitante recebe a resposta no seu idioma.

A tradução depende de `FEATURE_TRANSLATION="true"`.

## Arquitetura

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
   ▲ dentro do Docker: volume livechat_data montado em /app/data
```

Em execução local sem Docker, o caminho padrão é `data/livechat.db` dentro do diretório do projeto.

Fluxo de mensagem:

1. O widget conecta por Socket.IO.
2. O servidor cria ou restaura a sessão.
3. A mensagem é salva no SQLite.
4. A mensagem é enviada ao Telegram e ao painel admin.
5. O admin responde pelo Telegram ou `/admin`.
6. O servidor traduz se necessário.
7. O visitante recebe a resposta por Socket.IO.

## Redis Opcional

Docker Compose inclui Redis e configura:

```env
REDIS_URL="redis://redis:6379"
REDIS_KEY_PREFIX="lcp"
```

Redis é usado para presença, estado compartilhado e adaptador Socket.IO quando há vários nós.

Para instalação local sem Docker:

```env
REDIS_URL="redis://127.0.0.1:6379"
```

Se `/health` devolver `stateMode: "redis"`, Redis está ativo.

## Nginx e HTTPS

Para domínio real com HTTPS, você pode usar o arquivo incluído:

```bash
sudo cp nginx/livechat.conf /etc/nginx/sites-available/livechat
sudo ln -s /etc/nginx/sites-available/livechat /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Certificado com Certbot:

```bash
sudo certbot --nginx -d chat.meudominio.com
```

Depois ajuste:

```env
ALLOWED_ORIGINS="https://chat.meudominio.com"
```

Os cookies admin são marcados como `Secure` quando a requisição chega por HTTPS ou por proxy com `X-Forwarded-Proto: https`. Em desenvolvimento por IP HTTP funcionam sem `Secure`.

A geolocalização do admin depende de o Node receber o IP público real do visitante. O template `nginx/livechat.conf` já envia `X-Real-IP` e `X-Forwarded-For`; se o painel mostrar IPs `127.x`, `10.x`, `172.16-31.x` ou `192.168.x`, o servidor está vendo um IP privado de Docker/proxy e a localização aparecerá como desconhecida. Nesse caso, use Nginx/HTTPS na frente do contêiner ou verifique que o proxy preserva esses cabeçalhos.

## Arquivos Principais

```text
server.js           Servidor Express, Socket.IO e Telegram
widget.js           Widget incorporável
setup.js            Instalador interativo
db.js               Persistência SQLite
cluster-state.js    Estado compartilhado opcional com Redis
public/index.html   Demo do widget
public/admin.html   Painel admin único
docker-compose.yml  App + Redis + volumes
Dockerfile          Imagem de produção
nginx/livechat.conf Proxy reverso HTTPS
tests/              Testes automáticos
data/livechat.db    Banco SQLite em execução local sem Docker
```

## Testes

```bash
npm test
npm run test:db
npm run test:api
```

Os testes usam `node:test` e SQLite em memória para não tocar dados reais.

## Estado do Sistema

```text
/health
/health?format=json
```

Mostra estado geral, sessões em memória, modo de estado (`memory` ou `redis`), Telegram, uptime, configuração pública do widget e funções ativas.

## Segurança

- Use uma senha forte para `ADMIN_PANEL_PASSWORD`.
- Em produção com domínio, use HTTPS.
- Restrinja `ALLOWED_ORIGINS` ao domínio real.
- Abra apenas as portas necessárias no VPS.
- Se usar `WIDGET_API_KEY`, o widget deve incluir `data-api-key`.

## Funcionalidades Implementadas

- Chat em tempo real com Socket.IO.
- Widget incorporável.
- Painel admin único.
- Integração Telegram.
- Persistência SQLite.
- Métricas gerais.
- Limpeza, bloqueio, banimento e exclusão por chat.
- Tradução automática.
- Geolocalização por IP.
- Confirmações de leitura.
- Ghost typing para Telegram.
- Rate limiting HTTP e por socket.
- Helmet e CSRF em ações admin.
- Docker Compose com Redis.
- Setup interativo para VPS público ou desenvolvimento local.
- Suíte de testes automatizada.

## Documentação do Projeto

- [README em espanhol](README_ES.md)
- [README em inglês](README.md)
- [Índice de documentação](docs/README.md)
- [Guia de contribuição](CONTRIBUTING.md)
- [Política de segurança](SECURITY.md)
- [Licença GPL](LICENSE)

## Novidades na v1.0.2

- Adicionado `kb-trainer/`, uma CLI independente para criar `data/knowledge-base.json` a partir de URLs e arquivos locais.
- O trainer agora suporta 10 provedores de IA mais `none`: OpenRouter, Groq, Gemini, OpenAI, xAI, Anthropic, Mistral, Cohere, Ollama e endpoints custom compatíveis com OpenAI.
- Smart Bot melhorado com coeficiente Dice, stemmer em espanhol, desambiguação e proteção de nomes próprios em traduções.
- `setup.js` pode executar o kb-trainer ao configurar o modo `knowledge-base`.
- `.env.example` foi refeito em inglês com todas as variáveis documentadas.

## 🤖 Smart Bot / AI

O LiveChat Pro inclui um bot inteligente opcional que responde visitantes automaticamente antes de escalar para um humano.

| `BOT_MODE` | Comportamento |
|---|---|
| `disabled` | Sem bot: todas as mensagens vão para Telegram/admin (padrão). |
| `knowledge-base` | Responde de `data/knowledge-base.json` usando busca difusa e limite de confiança. |
| `ai` | Usa respostas de IA compatíveis com OpenAI com contexto recente da conversa. |

**Variáveis:** `BOT_MODE`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_TOKENS`, `BOT_SYSTEM_PROMPT`, `BOT_CONFIDENCE_THRESHOLD`, `BOT_CONTEXT_MESSAGES`, `BOT_NOTIFY_ADMIN`.

`BOT_CONFIDENCE_THRESHOLD` controla quanta confiança o bot de knowledge-base precisa ter antes de responder. Valores altos escalam mais; valores baixos respondem com mais frequência. Se não souber, envia para Telegram/admin. Quando o admin responde, o bot é silenciado na sessão. Comandos: `/bot on [sessionId]` e `/bot off [sessionId]`.

## 🤖 Treinamento da Knowledge Base (`kb-trainer/`)

`kb-trainer` cria ou atualiza `data/knowledge-base.json` a partir de URLs e arquivos locais. Pode rodar sem IA ou enriquecer entradas com provedores de IA.

| Provedor | Modelo padrão | Free tier |
|---|---|---|
| `none` | — | ✅ Sem API key |
| `openrouter` | `meta-llama/llama-3.1-8b-instruct:free` | ✅ Modelos grátis |
| `groq` | `llama-3.1-8b-instant` | ✅ Free tier |
| `gemini` | `gemini-1.5-flash` | ✅ Cota grátis |
| `openai` | `gpt-4o-mini` | — |
| `xai` | `grok-beta` | — |
| `anthropic` | `claude-3-haiku-20240307` | — |
| `mistral` | `mistral-small-latest` | — |
| `cohere` | `command-r` | — |
| `ollama` | `llama3` | ✅ Local, sem key |
| `custom` | configurable | ✅ Qualquer endpoint compatível com OpenAI |

**Free tier highlights:** `none` funciona sem chave, OpenRouter oferece modelos grátis, Groq tem tier gratuito rápido, Gemini inclui cota grátis e Ollama roda localmente.

**Exemplos de uso:**

```bash
node kb-trainer/index.js --provider none --urls "https://your-site.com/faq,docs/manual.md"
node kb-trainer/index.js --provider openrouter --key sk-or-xxx --urls "https://your-site.com"
node kb-trainer/index.js --provider groq --key gsk_xxx --model llama-3.1-8b-instant --urls "https://site.com"
node kb-trainer/index.js --provider gemini --key AIza_xxx --model gemini-1.5-flash --urls "docs/faq.md"
node kb-trainer/index.js --provider openai --key sk-xxx --model gpt-4o-mini --urls "docs/faq.md" --mode replace
node kb-trainer/index.js --provider xai --key xai-xxx --model grok-beta --urls "docs/faq.md"
node kb-trainer/index.js --provider anthropic --key sk-ant-xxx --model claude-3-haiku-20240307 --urls "docs/faq.md"
node kb-trainer/index.js --provider mistral --key xxx --model mistral-small-latest --urls "docs/faq.md"
node kb-trainer/index.js --provider cohere --key xxx --model command-r --urls "docs/faq.md"
node kb-trainer/index.js --provider ollama --base-url http://localhost:11434/v1 --model llama3 --urls "docs/manual.md"
node kb-trainer/index.js --provider custom --base-url http://localhost:1234/v1 --model local-model --urls "README.md"
```

**Opções CLI:** `--provider`, `--key`, `--model`, `--base-url`, `--urls`, `--mode append|replace`, `--output`, `--lang`, `--dry-run`, `--help`.

O JSON mantém a estrutura: `version`, `language`, `fallback` e `entries` com `id`, `keywords`, `question`, `answer`, `source` e `category`. O LiveChat Pro usa isso com `BOT_MODE=knowledge-base` para responder antes de encaminhar ao administrador.
