// Proves the existing hospital app files are unchanged: hashes every file outside this folder
// and compares with baseline/file-manifest.json, captured before the platform was added.
//   npm run verify:baseline
// Exit code 0 = identical, 1 = something changed, was added or went missing.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PLATFORM_DIR = path.join(__dirname, '..', '..');
const PROJECT_ROOT = path.join(PLATFORM_DIR, '..');
// The same exclusions used when the baseline was captured
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'healthcare-analytics-platform', 'test-results']);
const SKIP_FILES = new Set(['.env']);

function hashTree(root) {
  const out = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  };
  walk(root);
  return out;
}

function compare(baseline, current) {
  const changed = [];
  const missing = [];
  const added = [];
  for (const [file, hash] of Object.entries(baseline)) {
    if (!(file in current)) missing.push(file);
    else if (current[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(current)) if (!(file in baseline)) added.push(file);
  return { changed, missing, added, same: !changed.length && !missing.length && !added.length };
}

if (require.main === module) {
  const baseline = JSON.parse(fs.readFileSync(path.join(PLATFORM_DIR, 'baseline', 'file-manifest.json'), 'utf8'));
  const result = compare(baseline, hashTree(PROJECT_ROOT));
  const count = Object.keys(baseline).length;
  if (result.same) {
    console.log(`Unchanged: all ${count} existing files match the baseline byte for byte.`);
  } else {
    for (const f of result.changed) console.log(`CHANGED  ${f}`);
    for (const f of result.missing) console.log(`MISSING  ${f}`);
    for (const f of result.added) console.log(`ADDED    ${f}`);
    console.log(`${result.changed.length} changed, ${result.missing.length} missing, ${result.added.length} added (of ${count} baseline files).`);
    process.exitCode = 1;
  }
}

module.exports = { hashTree, compare };
