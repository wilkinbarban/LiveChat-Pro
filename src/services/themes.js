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
  'light-sunrise': Object.freeze({
    name: 'light-sunrise',
    label: 'Light Sunrise',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#f97316',
      panelBg: '#ffffff',
      surfaceBg: '#fff7ed',
      inputBg: '#fffaf0',
      inputTextColor: '#431407',
      inputPlaceholderColor: '#b45309',
      textColor: '#431407',
      mutedColor: '#b45309',
      borderColor: 'rgba(249,115,22,0.15)',
      headerBg: '#f97316',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(249,115,22,0.18)',
    }),
  }),
  'light-sky': Object.freeze({
    name: 'light-sky',
    label: 'Light Sky',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#0284c7',
      panelBg: '#ffffff',
      surfaceBg: '#f0f9ff',
      inputBg: '#fafcfe',
      inputTextColor: '#0c4a6e',
      inputPlaceholderColor: '#94a3b8',
      textColor: '#0c4a6e',
      mutedColor: '#64748b',
      borderColor: 'rgba(2,132,199,0.15)',
      headerBg: '#0284c7',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(2,132,199,0.18)',
    }),
  }),
  'dark-ocean': Object.freeze({
    name: 'dark-ocean',
    label: 'Dark Ocean',
    type: 'dark',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#38bdf8',
      panelBg: '#0d1b2a',
      surfaceBg: '#16283c',
      inputBg: '#0d1b2a',
      inputTextColor: '#e0f2fe',
      inputPlaceholderColor: '#64748b',
      textColor: '#e0f2fe',
      mutedColor: '#94a3b8',
      borderColor: 'rgba(56,189,248,0.18)',
      headerBg: '#16283c',
      headerColor: '#e0f2fe',
      shadow: '0 24px 80px rgba(0,0,0,0.5)',
    }),
  }),
  'dark-forest': Object.freeze({
    name: 'dark-forest',
    label: 'Dark Forest',
    type: 'dark',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#4ade80',
      panelBg: '#0d1a12',
      surfaceBg: '#16251b',
      inputBg: '#0d1a12',
      inputTextColor: '#ecfdf5',
      inputPlaceholderColor: '#64748b',
      textColor: '#ecfdf5',
      mutedColor: '#94a3b8',
      borderColor: 'rgba(74,222,128,0.18)',
      headerBg: '#16251b',
      headerColor: '#ecfdf5',
      shadow: '0 24px 80px rgba(0,0,0,0.5)',
    }),
  }),
  'mono-light': Object.freeze({
    name: 'mono-light',
    label: 'Mono Light',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#18181b',
      panelBg: '#ffffff',
      surfaceBg: '#f4f4f5',
      inputBg: '#ffffff',
      inputTextColor: '#18181b',
      inputPlaceholderColor: '#a1a1aa',
      textColor: '#18181b',
      mutedColor: '#71717a',
      borderColor: 'rgba(24,24,27,0.1)',
      headerBg: '#18181b',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(0,0,0,0.16)',
    }),
  }),
  'mono-dark': Object.freeze({
    name: 'mono-dark',
    label: 'Mono Dark',
    type: 'dark',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#6b7280',
      panelBg: '#18181b',
      surfaceBg: '#27272a',
      inputBg: '#18181b',
      inputTextColor: '#fafafa',
      inputPlaceholderColor: '#71717a',
      textColor: '#fafafa',
      mutedColor: '#a1a1aa',
      borderColor: 'rgba(255,255,255,0.1)',
      headerBg: '#27272a',
      headerColor: '#fafafa',
      shadow: '0 24px 80px rgba(0,0,0,0.5)',
    }),
  }),
  'green-chat': Object.freeze({
    name: 'green-chat',
    label: 'Green Chat',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#25D366',
      panelBg: '#ffffff',
      surfaceBg: '#e6f9ef',
      inputBg: '#f4fbf7',
      inputTextColor: '#111b21',
      inputPlaceholderColor: '#8696a0',
      textColor: '#111b21',
      mutedColor: '#667781',
      borderColor: 'rgba(37,211,102,0.18)',
      headerBg: '#075E54',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(7,94,84,0.22)',
    }),
  }),
  'sky-chat': Object.freeze({
    name: 'sky-chat',
    label: 'Sky Chat',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#2AABEE',
      panelBg: '#ffffff',
      surfaceBg: '#e5f3fb',
      inputBg: '#f2f9fd',
      inputTextColor: '#0a1b26',
      inputPlaceholderColor: '#94a3b8',
      textColor: '#0a1b26',
      mutedColor: '#64748b',
      borderColor: 'rgba(42,171,238,0.18)',
      headerBg: '#2AABEE',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(42,171,238,0.18)',
    }),
  }),
  'gradient-vibrant': Object.freeze({
    name: 'gradient-vibrant',
    label: 'Gradient Vibrant',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#d62976',
      panelBg: '#ffffff',
      surfaceBg: '#fdf2f8',
      inputBg: '#fef9fb',
      inputTextColor: '#3b0764',
      inputPlaceholderColor: '#a855f7',
      textColor: '#3b0764',
      mutedColor: '#a855f7',
      borderColor: 'rgba(214,41,118,0.18)',
      headerBg: 'linear-gradient(135deg,#fa7e1e,#d62976 50%,#962fbf)',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(150,47,191,0.25)',
    }),
  }),
  ink: Object.freeze({
    name: 'ink',
    label: 'Ink',
    type: 'light',
    vars: Object.freeze({
      font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#000000',
      panelBg: '#ffffff',
      surfaceBg: '#f7f7f7',
      inputBg: '#ffffff',
      inputTextColor: '#000000',
      inputPlaceholderColor: '#71717a',
      textColor: '#000000',
      mutedColor: '#6b7280',
      borderColor: 'rgba(0,0,0,0.12)',
      headerBg: '#000000',
      headerColor: '#ffffff',
      shadow: '0 24px 80px rgba(0,0,0,0.2)',
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
