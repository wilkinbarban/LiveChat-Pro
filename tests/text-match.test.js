'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stem,
  normalizeStr,
  expandProjectAliases,
  tokenize,
  tokenizeStem,
  diceCoefficient,
} = require('../src/services/text-match.js');

test('Text Match Service — Spanish stemmer', async (t) => {
  await t.test('stems common verb inflections to same root', () => {
    assert.equal(stem('instalo'), 'instal');
    assert.equal(stem('instala'), 'instal');
    assert.equal(stem('instalar'), 'instal');
    assert.equal(stem('instalando'), 'instal');
    assert.equal(stem('instalacion'), 'instalacion'); // accent stripped before stem in normal flow
  });

  await t.test('preserves short words under 4 characters', () => {
    assert.equal(stem('sol'), 'sol');
    assert.equal(stem('que'), 'que');
    assert.equal(stem('ir'), 'ir');
  });
});

test('Text Match Service — Normalization and tokenization', async (t) => {
  await t.test('normalizeStr lowercases, strips accents, removes punctuation', () => {
    assert.equal(normalizeStr('¡Hola, cómo estás!'), 'hola como estas');
    assert.equal(normalizeStr('  REQUISITOS del   sistema  '), 'requisitos del sistema');
  });

  await t.test('expandProjectAliases normalizes multi-word project names', () => {
    assert.equal(expandProjectAliases('instalar Photo Dedup'), 'instalar photodup');
    assert.equal(expandProjectAliases('livechat-pro ayuda'), 'livechat ayuda');
    assert.equal(expandProjectAliases('youtube-downloader config'), 'youtubedownloader config');
  });

  await t.test('tokenize returns clean array of normalized tokens', () => {
    assert.deepEqual(tokenize('¿Cómo instalar LiveChat Pro?'), ['como', 'instalar', 'livechat']);
  });

  await t.test('tokenizeStem returns array of stemmed tokens', () => {
    assert.deepEqual(tokenizeStem('instalando requisitos'), ['instal', 'requisit']);
  });
});

test('Text Match Service — Dice coefficient calculation', async (t) => {
  await t.test('calculates 1.0 for identical token lists or strings', () => {
    assert.equal(diceCoefficient('requisitos sistema', 'requisitos sistema'), 1.0);
    assert.equal(diceCoefficient(['instalacion'], ['instalacion']), 1.0);
  });

  await t.test('calculates stem-aware dice similarity for inflected words', () => {
    // "instalar" and "instalacion" / "instalo" share stem "instal"
    const score = diceCoefficient('como instalar', 'instalo app');
    assert.ok(score > 0, 'Score should be positive due to stem match');
    assert.equal(score, 0.5); // 1 match (hits=1), total tokens = 2 + 2 = 4 -> (1*2)/4 = 0.5
  });

  await t.test('returns 0 for completely disjoint tokens', () => {
    assert.equal(diceCoefficient('hola mundo', 'adios tierra'), 0);
  });

  await t.test('returns 0 for empty inputs', () => {
    assert.equal(diceCoefficient('', 'hola'), 0);
    assert.equal(diceCoefficient([], []), 0);
  });
});
