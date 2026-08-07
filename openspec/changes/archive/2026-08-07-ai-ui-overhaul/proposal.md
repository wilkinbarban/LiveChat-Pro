# Proposal: AI UI Overhaul

## Intent

Overhaul the Admin Panel AI tab UI in `public/admin.html` into a modern AI Management Dashboard featuring visual provider cards, quick status header, provider editor modal/panel, model selector updates, and 5-language i18n support.

## Scope

### In Scope
- **AI Summary Header**: Global AI status badge (`Bot AI Activado / Desactivado`), Active Default Provider & Model badge (e.g. `OpenAI - gpt-4o-mini`), and quick toggle switch.
- **Provider Cards Grid**: Visual cards for 6 providers (`openai`, `anthropic`, `openrouter`, `deepseek`, `kimi`, `qwen`) with status badge (`Configurado` / `Sin configurar`), `Proveedor Principal` badge, selected model display, 1-click "Establecer como Principal" button, and "Configurar / Editar" modal trigger button.
- **Provider Editor Modal / Panel**: API key input with masked key display (`...1234`), dynamic model dropdown (`<select id="llm-model">`), "Verificar y Guardar API Key" button (1-token test & save), and "Guardar Modelo" button (model update without key re-verification).
- **5-Language i18n**: Dictionary updates in `public/admin.html` for `es`, `en`, `pt`, `fr`, `de`.

### Out of Scope
- Backend API route changes (reuses existing `GET /api/admin/llm`, `PUT /api/admin/llm/default`, `POST /api/admin/settings/llm/verify-key`, `PUT /api/admin/llm/providers/:name`, `PUT /api/admin/settings/llm`).
- Changes to RAG, Telegram, Master Prompt, or Theme tabs.

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `admin-settings`: Expands `public/admin.html` AI tab HTML layout, CSS card/modal styling, client JS dashboard logic, and 5-language i18n dictionary keys (`es`, `en`, `pt`, `fr`, `de`).
- `llm-providers`: Enhances client provider interactions to support provider card grid, instant default setting, provider modal editor, dynamic model catalog selector, and separate model update vs key verification.

## Approach

- Re-structure `#tab-llm` in `public/admin.html` with an AI Summary Header and 6 Provider Cards layout.
- Add a Provider Editor Modal/Panel component triggered by "Configurar / Editar".
- Update client JS in `public/admin.html` to handle card grid rendering, modal state management, API key masking, dynamic model dropdown population, and REST calls to existing backend routes.
- Populate `i18n` dictionaries for `es`, `en`, `pt`, `fr`, `de` with keys for header status, grid cards, badges, modal actions, and notice messages.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `public/admin.html` | Modified | AI tab markup, card grid, editor modal, 5-language dictionaries, client JS logic |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| UI state out of sync after provider edit | Low | Re-fetch full LLM settings state via `GET /api/admin/llm` after every successful update |
| Missing i18n keys in non-Spanish locales | Low | Add complete translation key sets for all 5 languages (`es`, `en`, `pt`, `fr`, `de`) |

## Rollback Plan

Revert `public/admin.html` changes via git (`git checkout HEAD -- public/admin.html`).

## Dependencies

- Existing LLM admin REST endpoints (`GET /api/admin/llm`, `PUT /api/admin/llm/default`, `PUT /api/admin/llm/providers/:name`, `POST /api/admin/settings/llm/verify-key`).

## Success Criteria

- [ ] AI Summary Header displays global status, active provider/model badge, and quick toggle switch.
- [ ] 6 provider visual cards render with status badge, principal badge, selected model, and action buttons.
- [ ] 1-click "Establecer como Principal" updates default provider and refreshes UI dashboard.
- [ ] Editor modal opens with masked key, enables model dropdown, and supports both "Verificar y Guardar API Key" and "Guardar Modelo".
- [ ] All AI tab UI text translates across `es`, `en`, `pt`, `fr`, `de`.
