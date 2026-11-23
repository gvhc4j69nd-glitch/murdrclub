'use strict';

/**
 * Storage for the MVP: everything lives in memory and is written to a single
 * JSON file shortly after each change (write to a temp file, then rename, so
 * a crash never leaves a half-written file). One server process only — see
 * the README for the move to Postgres.
 */

const fs = require('fs');
const path = require('path');

function createStore(dataDir) {
  const file = dataDir ? path.join(dataDir, 'murdrclub.json') : null;
  let data = { users: {}, sessions: {}, clubs: {} };

  if (file && fs.existsSync(file)) {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  let timer = null;
  function flush() {
    timer = null;
    if (!file) return;
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  return {
    data,
    save() {
      if (!timer) timer = setTimeout(flush, 250);
    },
    flushNow() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

module.exports = { createStore };
