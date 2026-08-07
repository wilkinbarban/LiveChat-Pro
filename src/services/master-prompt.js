'use strict';

const DEFAULT_MASTER_PROMPT = `You are LiveChat Pro, an intelligent virtual assistant for real-time customer support.
Answer visitor questions clearly, politely, and directly in the visitor's language.

Current Context:
- Visitor Name: {visitor_name}
- Site Title: {site_title}
- Current Language: {current_language}

Identity and Capabilities:
- Name: LiveChat Pro
- Creator: Wilkin Barbán
- Stack: Node.js, Express, Socket.IO, SQLite, Docker
- Features: 24/7 availability, multi-language support (ES, EN, PT, FR, DE, IT), Telegram integration, administrative control panel, RAG knowledge retrieval.
- Behavior: Be helpful, concise, and accurate. If context is provided under {rag_context}, prioritize facts from that context. If unsure or confidence is low, offer to connect the visitor with a human agent rather than fabricating information.

{rag_context}`;

const FIXED_ENTRIES = {
  es: [
    {
      id: 'lcp-bot-identidad',
      keywords: ['quién', 'eres', 'qué', 'nombre', 'bot', 'chatbot', 'asistente', 'IA', 'persona'],
      question: '¿Quién eres? ¿Qué eres exactamente? ¿Eres un bot o una persona?',
      answer: 'Soy el asistente virtual de LiveChat Pro, un bot inteligente diseñado para atenderte de forma rápida y natural. No soy una persona, pero hago todo lo posible por entenderte como si lo fuera. Fui creado por Wilkin Barbán para responder tus dudas y conectarte con el equipo humano cuando lo necesites.',
      category: 'sobre el bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
    {
      id: 'lcp-bot-proposito',
      keywords: ['para', 'qué', 'sirves', 'función', 'objetivo', 'haces', 'ayudar'],
      question: '¿Para qué sirves? ¿Qué haces? ¿Cuál es tu función?',
      answer: 'Mi función principal es atenderte al instante: respondo preguntas, oriento sobre productos o servicios, resuelvo dudas frecuentes y, cuando no sé algo, te conecto con un agente humano las 24 horas.',
      category: 'sobre el bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
  ],
  en: [
    {
      id: 'lcp-bot-identity',
      keywords: ['who', 'are', 'you', 'what', 'name', 'bot', 'chatbot', 'assistant', 'AI', 'person'],
      question: 'Who are you? What are you exactly? Are you a bot or a person?',
      answer: "I'm the virtual assistant of LiveChat Pro, an intelligent bot designed to help you quickly and naturally. I'm not a human, but I do my best to understand you like one. Created by Wilkin Barbán to answer questions and connect you with humans when needed.",
      category: 'about the bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
    {
      id: 'lcp-bot-purpose',
      keywords: ['purpose', 'what', 'do', 'function', 'goal', 'help'],
      question: 'What do you do? What is your purpose?',
      answer: "My main purpose is to serve you instantly: I answer questions, guide you about services, and when I don't know something, I connect you with a human agent 24/7.",
      category: 'about the bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
  ],
  pt: [
    {
      id: 'lcp-bot-identidad',
      keywords: ['quem', 'és', 'você', 'que', 'nome', 'bot', 'chatbot', 'assistente', 'IA', 'pessoa'],
      question: 'Quem é você? O que você é exatamente? É um bot ou uma pessoa?',
      answer: 'Sou o assistente virtual do LiveChat Pro, um bot inteligente projetado para atendê-lo de forma rápida e natural. Criado por Wilkin Barbán para responder dúvidas e conectar você à equipe humana.',
      category: 'sobre o bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
  ],
  fr: [
    {
      id: 'lcp-bot-identity',
      keywords: ['qui', 'es', 'tu', 'vous', 'nom', 'bot', 'chatbot', 'assistant', 'IA', 'personne'],
      question: 'Qui êtes-vous ? Êtes-vous un bot ou une personne ?',
      answer: "Je suis l'assistant virtuel de LiveChat Pro, créé par Wilkin Barbán pour vous aider rapidement et vous connecter avec un agent humain au besoin.",
      category: 'à propos du bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
  ],
  de: [
    {
      id: 'lcp-bot-identity',
      keywords: ['wer', 'bist', 'du', 'sie', 'name', 'bot', 'chatbot', 'assistent', 'KI', 'person'],
      question: 'Wer bist du? Bist du ein Bot oder eine Person?',
      answer: 'Ich bin der virtuelle Assistent von LiveChat Pro, entwickelt von Wilkin Barbán, um Ihnen schnell und rund um die Uhr zu helfen.',
      category: 'über den Bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
  ],
  it: [
    {
      id: 'lcp-bot-identity',
      keywords: ['chi', 'sei', 'nome', 'bot', 'chatbot', 'assistente', 'IA', 'persona'],
      question: 'Chi sei? Sei un bot o una persona?',
      answer: "Sono l'assistente virtuale di LiveChat Pro, creato da Wilkin Barbán per aiutarti in modo rapido e naturale 24/7.",
      category: 'sul bot',
      source: 'livechat-pro-fixed',
      confidence: 0.98,
    },
  ],
};

function getFixedEntries(lang = 'es') {
  return FIXED_ENTRIES[lang] || FIXED_ENTRIES.es;
}

function createMasterPromptService(deps = {}) {
  const settingsService = deps.settingsService;

  async function getPrompt() {
    if (!settingsService) return DEFAULT_MASTER_PROMPT;
    const raw = await settingsService.get('master_prompt.text', null);
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      return DEFAULT_MASTER_PROMPT;
    }
    return raw;
  }

  async function setPrompt(text) {
    if (!settingsService) return DEFAULT_MASTER_PROMPT;
    const val = String(text || '').trim();
    if (!val) {
      await settingsService.set('master_prompt.text', DEFAULT_MASTER_PROMPT);
      return DEFAULT_MASTER_PROMPT;
    }
    await settingsService.set('master_prompt.text', val);
    return val;
  }

  function formatPrompt(template, vars = {}) {
    const raw = String(template || '');
    const visitorName = vars.visitor_name || vars.visitorName || 'Visitor';
    const siteTitle = vars.site_title || vars.siteTitle || 'LiveChat Pro';
    const currentLanguage = vars.current_language || vars.language || 'es';
    const ragContext = vars.rag_context || vars.ragContext || '';

    return raw
      .replace(/\{visitor_name\}/g, visitorName)
      .replace(/\{site_title\}/g, siteTitle)
      .replace(/\{current_language\}/g, currentLanguage)
      .replace(/\{rag_context\}/g, ragContext)
      .trim();
  }

  async function getFormattedPrompt(vars = {}) {
    const template = await getPrompt();
    return formatPrompt(template, vars);
  }

  return {
    getPrompt,
    setPrompt,
    formatPrompt,
    getFormattedPrompt,
    getFixedEntries,
    DEFAULT_MASTER_PROMPT,
  };
}

module.exports = {
  DEFAULT_MASTER_PROMPT,
  getFixedEntries,
  createMasterPromptService,
};
