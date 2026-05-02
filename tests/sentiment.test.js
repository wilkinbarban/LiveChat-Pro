'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSentiment, detectLanguage } = require('../src/services/sentiment');

test('detectLanguage identifica textos por pistas no ofensivas', () => {
  assert.equal(detectLanguage('hello thanks, I need help with this problem'), 'en');
  assert.equal(detectLanguage('bonjour merci, besoin aide pour ce probleme'), 'fr');
  assert.equal(detectLanguage('hallo danke, ich brauche hilfe mit das problem'), 'de');
  assert.equal(detectLanguage('ciao grazie, ho bisogno di aiuto con questo problema'), 'it');
  assert.equal(detectLanguage('olá obrigado, preciso de ajuda com este problema'), 'pt');
});

test('analyzeSentiment usa diccionario ofensivo del idioma indicado', () => {
  assert.equal(analyzeSentiment('you are an idiot', 'en').isOffensive, true);
  assert.equal(analyzeSentiment('tu es un connard', 'fr').isOffensive, true);
  assert.equal(analyzeSentiment('eres un idiota', 'es').isOffensive, true);
});

test('analyzeSentiment marca prioridad alta para quejas negativas no ofensivas', () => {
  const result = analyzeSentiment('hello I have a terrible problem and I am very angry', '');

  assert.equal(result.lang, 'en');
  assert.equal(result.isOffensive, false);
  assert.equal(result.isHighPriority, true);
  assert.ok(result.score < -3);
});
