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

## Instalação com um Comando

Para configurar rapidamente o ambiente, verificar dependências, clonar o repositório do projeto e iniciar o assistente interativo de configuração, execute o comando correspondente ao seu sistema operacional:

### Linux
```bash
curl -fsSL https://raw.githubusercontent.com/wilkinbarban/LiveChat-Pro/main/install.sh | bash
```

### Windows (PowerShell Administrador)
Abra o PowerShell como Administrador e execute:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/wilkinbarban/LiveChat-Pro/main/install.ps1 | iex"
```

---

### Processo Detalhado de Instalação: O Que Esses Scripts Fazem

#### Instalador do Linux (`install.sh`)
Quando você executa o instalador automático no Linux, ele realiza a seguinte sequência detalhada:
1. **Verificação de Privilégios**: Confirma se o script está sendo executado como root ou via `sudo`. Os gerenciadores de pacotes do sistema exigem privilégios administrativos.
2. **Identificação da Distribuição**: Detecta a distribuição Linux para invocar o gerenciador de pacotes correto (ex: `apt` para Debian/Ubuntu, `yum`/`dnf` para RHEL/CentOS ou `pacman` para Arch).
3. **Verificação e Instalação de Pré-requisitos**:
   - **Git**: Verifica se o `git` está disponível. Se faltar, instala-o automaticamente.
   - **Node.js e npm**: Procura pelo Node.js (versão 24 ou superior). Se faltar ou estiver desatualizado, configura os repositórios oficiais da NodeSource ou do sistema para instalar a versão estável mais recente do runtime junto com o `npm`.
   - **Docker e Docker Compose**: Verifica se o Docker Engine e o plugin do Docker Compose estão instalados. Se faltarem, realiza a instalação completa, inicia o serviço do Docker e o configura para inicializar com o sistema.
4. **Verificação do Diretório do Projeto**: Confirma se o arquivo `setup.js` existe no diretório atual de trabalho. Se não for encontrado, o script clona automaticamente o repositório a partir de `https://github.com/wilkinbarban/LiveChat-Pro.git` em uma pasta chamada `LiveChat-Pro` e entra nela.
5. **Assistente de Configuração Interativo**: Executa `node setup.js` para solicitar as variáveis de ambiente e gerar um arquivo `.env` personalizado.
6. **Compiliação e Inicialização dos Contêineres**: Oferece compilar e iniciar os serviços imediatamente por meio do comando `docker compose up -d --build`.
7. **Registro de Execução**: Redireciona a saída de todas as verificações e instalações para o arquivo `install.log` em segundo plano, exibindo um indicador de progresso animado no terminal.

#### Instalador do Windows (`install.ps1`)
Quando você executa o instalador automático do Windows no PowerShell, ele executa os seguintes passos:
1. **Verificação de Privilégios Elevados**: Confirma se a sessão atual do PowerShell possui direitos de Administrador, necessários para ajustes de sistema.
2. **Verificação e Instalação de Dependências**:
   - **Git**: Inspeciona se o Git está instalado. Caso falte, utiliza o `winget` (Windows Package Manager) para instalá-lo ou faz o download direto caso o `winget` não esteja disponível.
   - **Node.js e npm**: Procura pelo Node.js (versão 24 ou superior). Se faltar, baixa e executa o instalador oficial do MSI silenciosamente, atualizando as variáveis de ambiente.
3. **Verificação do Diretório do Projeto**: Procura por `setup.js`. Se ausente, chama o Git para clonar o projeto a partir de `https://github.com/wilkinbarban/LiveChat-Pro.git` e entra na pasta do projeto.
4. **Resolução Direta de Dependências (npm install)**: Executa `npm install` diretamente no sistema operacional hospedeiro para instalar as bibliotecas de Node.js necessárias.
5. **Lançamento do Assistente**: Inicializa o assistente interativo de configuração (`node setup.js`) para definir o token do bot do Telegram, credenciais do administrador e preferências.
6. **Inicialização Opcional do Servidor**: Ao término da configuração, o script pergunta se você deseja iniciar o servidor de chat diretamente utilizando o Node (`node server.js`).
7. **Arquitetura Sem Docker**:
   > [!IMPORTANT]
   > O LiveChat Pro no Windows foi projetado para rodar nativamente. **Ele não requer, utiliza ou instala o Docker, Docker Desktop ou qualquer outro serviço de contêineres no Windows**. Todo o servidor, o banco de dados e as tarefas em segundo plano rodam diretamente no sistema Windows local como processos padrão do Node.js.
8. **Registro de Execução**: Toda a saída de console do instalador é salva no arquivo `install.log` em segundo plano para fins de diagnóstico.

---

## Instalação Recomendada em VPS

Execute o script nativo de acordo com o seu sistema operacional:
```bash
chmod +x install.sh
./install.sh
```
Ao final da preparação das dependências, o assistente interativo `setup.js` será iniciado automaticamente. Nele:
1. Escolha **Configuração Básica** (para configuração rápida) ou **Configuração Completa** (para personalizar todos os 43 parâmetros).
2. Siga as instruções na tela para configurar o bot do Telegram, a senha do painel de administração, as origens, etc.
3. Quando perguntado, selecione **Sim** para compilar e iniciar o servidor utilizando o Docker Compose.

O perfil de implantação configura:
```env
PORT="3000"
HOST_PORT="8080"
```
O Node escuta dentro do contêiner em `3000`, mas o Docker publica o projeto para a internet em `8080`. Essa porta é a opção recomendada para deixar `80` e `443` livres para seu site público ou para um proxy HTTPS.

Se você ainda não tem domínio, o `setup.js` detecta o IP público do VPS e gera um script como:
```html
<script src="http://IP-PUBLICO:8080/widget.js" data-server="http://IP-PUBLICO:8080"></script>
```

Se você tem domínio, informe-o quando o assistente perguntar por domínio/origens permitidas. Ao finalizar, o instalador mostra a URL de demonstração, painel de administração, healthcheck e o `<script>` final para colar no site externo.

Se seu usuário não possui permissões sudo, entre como root ou adicione o usuário ao grupo sudo/wheel antes de executar o instalador.

---

## Instalação Manual (Alternativa)

Se você preferir não utilizar os scripts automáticos, pode configurar o projeto manualmente passo a passo:

### Linux (Baseado em Docker / Produção)
1. **Instalar Pré-requisitos**: Certifique-se de que seu sistema possui Git, Node.js (>=24), npm, Docker e Docker Compose instalados.
   - Por exemplo, no Ubuntu/Debian:
     ```bash
     sudo apt update
     sudo apt install -y git nodejs npm docker.io docker-compose-v2
     ```
2. **Clonar o Repositório**:
   ```bash
   git clone https://github.com/wilkinbarban/LiveChat-Pro.git
   cd LiveChat-Pro
   ```
3. **Instalar Dependências Locais do Projeto**:
   ```bash
   npm install
   ```
4. **Configurar as Variáveis de Ambiente**:
   Execute o utilitário de configuração interativo no terminal para gerar o arquivo `.env`:
   ```bash
   node setup.js
   ```
5. **Iniciar os Serviços da Aplicação**:
   Compile e inicie os contêineres do Docker em segundo plano:
   ```bash
   docker compose up -d --build
   ```
6. **Verificar o Status do Servidor**:
   ```bash
   curl http://localhost:8080/health
   ```

### Windows (Baseado em Node / Servidor Direto)
1. **Instalar Pré-requisitos**: Baixe e instale o Git pelo site [git-scm.com](https://git-scm.com/) e o Node.js (versão 24 ou superior) pelo site [nodejs.org](https://nodejs.org/).
   > [!NOTE]
   > O LiveChat Pro no Windows não requer, não utiliza e não instala o Docker. Todo o sistema roda nativamente no seu sistema operacional.
2. **Clonar o Repositório**:
   Abra o PowerShell ou Prompt de Comando e execute:
   ```powershell
   git clone https://github.com/wilkinbarban/LiveChat-Pro.git
   cd LiveChat-Pro
   ```
3. **Instalar Dependências**:
   ```powershell
   npm install
   ```
4. **Executar o Assistente de Configuração**:
   ```powershell
   node setup.js
   ```
   Responda às perguntas para gerar o seu arquivo `.env`.
5. **Iniciar o Servidor**:
   ```powershell
   node server.js
   ```
   O servidor começará a escutar na porta configurada no arquivo `.env` (o padrão é `3000`).

---

## Sem Docker (Desenvolvimento Local no Linux / PM2)
Se você estiver executando o projeto diretamente em um host Linux sem Docker:

```bash
npm install
node setup.js
node server.js
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

### Fases da Arquitetura em Detalhes

1. **Isolamento de Frontend e Design Responsivo**:
   - O navegador do visitante carrega a página contendo o script do chat. É feito o download do `/widget.js`, o qual inicializa e renderiza toda a interface de usuário dentro de un **Shadow DOM**. Essa abordagem garante isolamento completo: as regras de estilo CSS do widget nunca interferem nas folhas de estilo da página hospedeira (como Bootstrap ou Tailwind), nem vice-versa.
   - O widget monitora continuamente as mudanças de layout usando a API `window.matchMedia`. Caso o viewport caia para `768px` ou menos, ele transiciona automaticamente de um botão flutuante para um painel inferior fixo otimizado para navegação móvel.
   - Em dispositivos móveis, utiliza a API `visualViewport` para calcular a altura visível real da tela. Isso permite ajustar a altura da janela de chat quando o teclado virtual é exibido, impedindo que o campo de texto de entrada de mensagens seja sobreposto pelo teclado.

2. **Ciclo de Vida da Sessão, Conexão e SQLite**:
   - O widget mantém uma conexão persistente baseada em estado utilizando **Socket.IO** com o backend Express (`server.js`).
   - Ao se conectar, o widget transmite o identificador de sessão do cliente (`lchat_sid`) obtido dos cookies ou `localStorage`. O backend busca essa chave na base de dados SQLite (`livechat.db`). Se existir, a sessão é restaurada e o histórico completo é enviado de volta ao cliente. Caso contrário, o banco cria um novo registro de sessão com metadatos iniciais.
   - Se a conexão cair devido à oscilação da rede, o Socket.IO realiza reconexões automáticas em segundo plano e recupera as mensagens perdidas.

3. **Interceptação Inteligente e Filtro do Bot (Antes do Escalamento)**:
   - Ao receber uma mensagem, o servidor analisa o estado do bot para aquela sessão. Se o administrador não tiver intervindo no chat (o que silencia o bot) e o `BOT_MODE` estiver ativado:
     - **Modo Knowledge-Base**: O sistema aplica um stemmer linguístico e calcula o coeficiente de similidade de Dice em relação aos registros do arquivo `data/knowledge-base.json`. Caso o score supere o valor estipulado em `BOT_CONFIDENCE_THRESHOLD`, o bot responde diretamente.
     - **Modo Inteligência Artificial (IA)**: O backend monta um prompt combinando as instruções do sistema (`BOT_SYSTEM_PROMPT`), adiciona os últimos dados de histórico em `BOT_CONTEXT_MESSAGES` e faz uma requisição ao provedor de IA ativo (OpenRouter, Gemini, OpenAI, etc.).
     - Se o bot responder e a variável `BOT_NOTIFY_ADMIN` for `false`, o atendimento é considerado resolvido e não gera alertas. Caso contrário, é escalonado.

4. **Geolocalização, Stemming Linguístico e Sentimento**:
   - Simultaneamente, o servidor processa outras análises e enriquecimentos da mensagem:
     - **Geolocalização**: O servidor obtém o IP público real do visitante através do `geoip-lite` para determinar país, região e provedor (ISP).
     - **Sentimento**: Um mecanismo de análise local analisa o texto em busca de expressões emocionais. Caso detecte sentimentos negativos (como irritação do usuário), a conversa é destacada com prioridade máxima no painel do administrador.
     - **Tradução Automática**: Se o idioma do navegador do visitante for diferente de `ADMIN_LANGUAGE` (e `FEATURE_TRANSLATION` for `true`), o servidor traduz a mensagem usando o adaptador ativo (Google Translate gratuito, API oficial do Google Cloud ou DeepL) antes de exibi-la ao administrador.

5. **Notificações em Dois Canais e Sincronização de Status de Digitação**:
   - Para chats escalonados, o servidor transmite os dados do visitante para o painel `/admin` via Socket.IO em tempo real.
   - Ao mesmo tempo, utiliza o framework **Telegraf** para enviar uma mensagem ao Telegram do administrador. A mensagem contém botões de atalho (como banir, limpar histórico ou bloquear).
   - **Ghost Typing**: Se `FEATURE_GHOST_TYPING` estiver ativo, o status de digitação do administrador no painel `/admin` ou no Telegram é enviado ao widget do visitante em tempo real, informando que a resposta está sendo escrita.

6. **Roteamento de Respostas e Tradução Reversa**:
   - O administrador pode enviar respostas através do painel de administração web `/admin` ou respondendo à mensagem diretamente no aplicativo do Telegram.
   - O backend intercepta o texto, salva no banco de dados SQLite e realiza a tradução para o idioma detectado do visitante antes de enviar de volta ao widget por Socket.IO.



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

## Cenários de Configuração

Para ajudá-lo a configurar e implantar o LiveChat Pro, abaixo são detalhados os dois cenários de instalação mais comuns.

### Cenário 1: Implantação em Produção com Proxy Reverso e Subcaminho (HTTPS)

Use este cenário ao integrar o aplicativo de chat em um site existente com HTTPS (ex., `https://mywebsite.com`) e servir o chat sob um subcaminho como `/chat/` (ex., `https://mywebsite.com/chat/`).

#### 1. Configuração de Ambiente (`.env`)
Configure as variáveis de ambiente do servidor da seguinte forma:
```env
PORT="3010"
HOST_PORT="8080"
NODE_ENV="production"
ALLOWED_ORIGINS="https://mywebsite.com"
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
<script src="https://mywebsite.com/chat/widget.js" data-server="https://mywebsite.com/chat"></script>
```

#### 4. URLs de Administração e Estado (Health)
Após a implantação, o painel de administração e os endpoints de verificação de status estarão acessíveis em:
- **Painel de Administração**: `https://mywebsite.com/chat/admin`
- **Endpoint de Estado**: `https://mywebsite.com/chat/health`

---

### Cenário 2: Desenvolvimento / Localhost / IP Público Direto (Sem Domínio)

Use este cenário ao testar o aplicativo localmente, ou ao hospedá-lo em um VPS usando diretamente o endereço IP público, sem nome de domínio ou certificados SSL.

#### 1. Configuração de Ambiente (`.env`)
```env
PORT="3010"
HOST_PORT="8080"
NODE_ENV="development"
ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
COOKIE_SAME_SITE="lax"
```

#### 2. Fragmento HTML para Incorporar o Widget
Incorpore o widget em suas páginas usando a URL direta:
```html
<script src="http://localhost:8080/widget.js" data-server="http://localhost:8080"></script>
```

#### 3. URLs de Administração e Estado (Health)
O painel de administração e os endpoints de verificação de status estarão acessíveis em:
- **Painel de Administração**: `http://localhost:8080/admin`
- **Endpoint de Estado**: `http://localhost:8080/health`

## Arquivos Principais

```text
server.js           Servidor Express, Socket.IO e Telegram
widget.js           Widget incorporável
Install.sh          Instalador nativo de dependências para Linux
Install.ps1         Instalador nativo de dependências para Windows
setup.js            Assistente interativo de configuração de ambiente (.env)
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
node kb-trainer/index.js --interactive
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

Use `--interactive` para um fluxo guiado como o que o `setup.js` executa. Ele pergunta provedor, chave, modelo, idioma, modo de escrita, arquivo de saída, fontes e preferência de dry-run.

**Opções CLI:** `--interactive`, `--provider`, `--key`, `--model`, `--base-url`, `--urls`, `--mode append|replace`, `--output`, `--lang`, `--dry-run`, `--help`.

O JSON mantém a estrutura: `version`, `language`, `fallback` e `entries` com `id`, `keywords`, `question`, `answer`, `source` e `category`. O LiveChat Pro usa isso com `BOT_MODE=knowledge-base` para responder antes de encaminhar ao administrador.
