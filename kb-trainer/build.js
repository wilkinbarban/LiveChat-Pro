#!/usr/bin/env node
'use strict';

/**
 * Builds the production KB from protected fixed entries + trainable project entries.
 * Important: fixed-entries.js is read-only canonical data. Training must never
 * overwrite it; regenerated production data always starts from fixed + trainable KB.
 */
const fs = require('fs');
const path = require('path');
const { getFixedEntries } = require('./fixed-entries');
const { validateEntries } = require('./validator');

const LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const root = path.resolve(__dirname, '..');
const trainablePath = path.join(__dirname, 'knowledge-base.json');
const outputPath = path.join(root, 'data', 'knowledge-base.json');

function localized(entries, lang) {
  return validateEntries(entries, { warn: msg => console.warn(`${lang}: ${msg}`) })
    .map(entry => ({ ...entry, language: lang }));
}

function loadTrainable() {
  const raw = JSON.parse(fs.readFileSync(trainablePath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Array.isArray(raw.entries)) {
    throw new Error('Trainable KB must be an object keyed by language. Run kb-trainer/index.js with the default output or restore kb-trainer/knowledge-base.json.');
  }
  const counts = LANGS.map(lang => [lang, Array.isArray(raw[lang]) ? raw[lang].length : 0]);
  const expected = counts[0][1];
  for (const [lang, count] of counts) {
    if (!count) throw new Error(`Missing trainable entries for language: ${lang}`);
    if (count !== expected) throw new Error(`Language ${lang} has ${count} entries, expected ${expected}`);
  }
  return raw;
}

const trainable = loadTrainable();
const fixed = [];
for (const lang of LANGS) fixed.push(...localized(getFixedEntries(lang), lang));

const fixedKeys = new Set(fixed.map(e => `${e.language}:${e.id}`));
const project = [];
for (const lang of LANGS) {
  for (const entry of localized(trainable[lang], lang)) {
    const key = `${entry.language}:${entry.id}`;
    if (!fixedKeys.has(key)) project.push(entry);
  }
}

const kb = {
  version: '3.0',
  language: 'multi',
  fallback: 'No tengo una respuesta específica para eso. He notificado al administrador y te responderá pronto.',
  entries: [...fixed, ...project],
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(kb, null, 2)}\n`);
console.log(`Wrote ${kb.entries.length} entries to ${path.relative(root, outputPath)} (${fixed.length} fixed, ${project.length} trainable).`);
