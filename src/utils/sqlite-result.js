'use strict';

function getLastInsertId(result) {
  const raw = result?.lastID ?? result?.lastInsertRowid;
  if (typeof raw === 'bigint') return Number(raw);
  return Number.isFinite(Number(raw)) ? Number(raw) : null;
}

module.exports = {
  getLastInsertId,
};
