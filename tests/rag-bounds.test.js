'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRagService } = require('../src/services/rag');

test('stageText rejects content above the 3 MiB UTF-8 service limit', async () => {
  const service = createRagService({ db: { runInTransaction: async () => assert.fail('oversized text reached persistence') } });
  await assert.rejects(
    service.stageText({ sourceType: 'text', source: 'manual', text: 'é'.repeat((3 * 1024 * 1024 / 2) + 1) }),
    /3 MiB/i,
  );
});

test('promotePending processes only ten oldest documents per call', async () => {
  const documents = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, source_type: 'text', pending_text: `Document ${index + 1}` }));
  const touched = [];
  const queries = [];
  const connection = {
    all: async () => [],
    run: async (sql, ...args) => { if (sql.startsWith('UPDATE rag_documents')) touched.push(args[1]); },
  };
  const service = createRagService({ db: {
    all: async sql => { queries.push(sql); return documents.slice(0, 10); },
    get: async () => ({ count: 2 }),
    runInTransaction: fn => fn(connection),
  } });

  assert.deepEqual(await service.promotePending(), { indexed: 10, pending: 2 });
  assert.match(queries[0], /ORDER BY created_at ASC\s+LIMIT 10/i);
  assert.deepEqual(touched, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('promotePending gives each document its own transaction and stops before later work on failure', async () => {
  const documents = [{ id: 1, source_type: 'text', pending_text: 'First' }, { id: 2, source_type: 'text', pending_text: 'Second' }, { id: 3, source_type: 'text', pending_text: 'Third' }];
  const attempted = [];
  const db = {
    all: async () => documents,
    get: async () => ({ count: 2 }),
    run: async () => {},
    runInTransaction: async fn => fn({
      get: async (_sql, id) => documents.find(document => document.id === id),
      all: async () => [],
      run: async (sql, ...args) => {
        if (sql.startsWith('UPDATE rag_documents')) attempted.push(args[1]);
        if (sql.startsWith('INSERT INTO rag_chunks') && args[0] === 2) throw new Error('chunk persistence failed');
      },
    }),
  };

  await assert.rejects(createRagService({ db }).promotePending(), /chunk persistence failed/);
  assert.deepEqual(attempted, [1]);
});
