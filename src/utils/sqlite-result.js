'use strict';

// sqlite3 returns lastID while node:sqlite returns lastInsertRowid. Normalize both
// shapes so the application can use either driver transparently.
function getLastInsertId(result) {
  const raw = result?.lastID ?? result?.lastInsertRowid;
  if (typeof raw === 'bigint') return Number(raw);
  return Number.isFinite(Number(raw)) ? Number(raw) : null;
}

module.exports = {
  getLastInsertId,
};
