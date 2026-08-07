'use strict';

const THEME_PRESETS = Object.freeze({
  auto: Object.freeze({
    name: 'auto',
    label: 'Auto (Site Sampling)',
    type: 'auto',
    vars: null,
  }),
  classic: Object.freeze({
    name: 'classic',
    label: 'Classic Indigo',
    type: 'light',
    vars: Object.freeze({
      font: 'Sora, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#4F46E5',
      panelBg: '#ffffff',
      surfaceBg: '#f8f7ff',
      inputBg: '#fafafa',
      inputTextColor: '#1a1a2e',
      inputPlaceholderColor: '#64748b',
      textColor: '#1a1a2e',
      mutedColor: '#64748b',
      borderColor: 'rgba(79, 70, 229, 0.12)',
      headerBg: '#4F46E5',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(0, 0, 0, 0.18)',
    }),
  }),
  'light-aurora': Object.freeze({
    name: 'light-aurora',
    label: 'Light Aurora',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#0d9488',
      panelBg: '#ffffff',
      surfaceBg: '#f0fdf4',
      inputBg: '#f8fafc',
      inputTextColor: '#0f172a',
      inputPlaceholderColor: '#94a3b8',
      textColor: '#0f172a',
      mutedColor: '#64748b',
      borderColor: 'rgba(13, 148, 136, 0.15)',
      headerBg: '#0d9488',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(13, 148, 136, 0.15)',
    }),
  }),
  'light-mint': Object.freeze({
    name: 'light-mint',
    label: 'Light Mint',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#059669',
      panelBg: '#ffffff',
      surfaceBg: '#ecfdf5',
      inputBg: '#f0fdf4',
      inputTextColor: '#064e3b',
      inputPlaceholderColor: '#6ee7b7',
      textColor: '#064e3b',
      mutedColor: '#047857',
      borderColor: 'rgba(5, 150, 105, 0.15)',
      headerBg: '#059669',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(5, 150, 105, 0.15)',
    }),
  }),
  'dark-midnight': Object.freeze({
    name: 'dark-midnight',
    label: 'Dark Midnight',
    type: 'dark',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#6366f1',
      panelBg: '#0f172a',
      surfaceBg: '#1e293b',
      inputBg: '#0f172a',
      inputTextColor: '#f8fafc',
      inputPlaceholderColor: '#64748b',
      textColor: '#f8fafc',
      mutedColor: '#94a3b8',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      headerBg: '#1e293b',
      headerColor: '#f8fafc',
      shadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
    }),
  }),
  'dark-ember': Object.freeze({
    name: 'dark-ember',
    label: 'Dark Ember',
    type: 'dark',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#e11d48',
      panelBg: '#18181b',
      surfaceBg: '#27272a',
      inputBg: '#18181b',
      inputTextColor: '#fafafa',
      inputPlaceholderColor: '#71717a',
      textColor: '#fafafa',
      mutedColor: '#a1a1aa',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      headerBg: '#27272a',
      headerColor: '#fafafa',
      shadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
    }),
  }),
});

function createThemesService(deps = {}) {
  const settingsService = deps.settingsService;

  function getCatalog() {
    return { presets: THEME_PRESETS };
  }

  function isValidTheme(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(THEME_PRESETS, name);
  }

  async function getActiveTheme() {
    if (!settingsService) return { name: 'auto', vars: null };
    const name = (await settingsService.get('theme.active')) || 'auto';
    const preset = THEME_PRESETS[name] || THEME_PRESETS.auto;
    return {
      name: preset.name,
      vars: preset.vars ? { ...preset.vars } : null,
    };
  }

  async function setActiveTheme(name) {
    if (!isValidTheme(name)) {
      throw new Error(`Invalid theme: ${name}`);
    }
    if (settingsService) {
      await settingsService.set('theme.active', name);
    }
    const preset = THEME_PRESETS[name];
    return {
      name: preset.name,
      vars: preset.vars ? { ...preset.vars } : null,
    };
  }

  return {
    getCatalog,
    isValidTheme,
    getActiveTheme,
    setActiveTheme,
  };
}

module.exports = {
  THEME_PRESETS,
  createThemesService,
};
