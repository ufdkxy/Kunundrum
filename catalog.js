/* Parse editable levels.js catalog. */
'use strict';
const Collection = (() => {
  // Load the editable catalog from levels.js (ordinary script, works on file://).
  const text = window.KUNUNDRUM_LEVEL_CODES;
  if (typeof text !== 'string') {
    throw new Error('Missing levels.js: keep levels.js beside index.html and app.js.');
  }
  const entries = [];
  const used = new Set();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(\d{1,2}\.(?:10|[1-9]))\s*=\s*(K3\.[A-Za-z0-9_-]+|K4\.[A-Za-z0-9]+(?:\s+\S+)?)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid levels.js line ${index + 1}. Use: 10.2 = K4.your_code solution`);
    }
    const id = match[1];
    const [chapter, level] = id.split('.').map(Number);
    if (chapter < 1 || chapter > 30 || level < 1 || level > 10) {
      throw new Error(`Invalid level ${id} in levels.js (expected 1.1 through 30.10).`);
    }
    if (used.has(id)) throw new Error(`Duplicate level ${id} in levels.js.`);
    used.add(id);
    const [code, solution] = match[2].split(/\s+/);
    entries.push({id, code, solution});
  }
  if (!entries.length) throw new Error('levels.js has no levels; add a line such as 10.2 = K4.your_code solution.');
  return {entries};
})();
