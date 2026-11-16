#!/usr/bin/env node
// The atlas search box answers to a title word OR a session id — the id a
// person copies from a `why` trace, an app's log, or a file name. The rules
// that matter are identity rules, not substring rules: a middle fragment of
// an id names nothing anyone would have copied, so it must not match, while
// the short form printed on a card and a pasted file name both must.
//
// Bundled for node the same way scripts/test-layout.mjs bundles product code.
//
// Run: node scripts/test-atlas-search.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tdag-atlas-search-'));
const bundle = join(tmp, 'card-search.mjs');
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
  join(ROOT, 'src/lib/atlas/card-search.ts'), '--bundle', '--format=esm', '--platform=node',
  `--outfile=${bundle}`, '--define:import.meta.env={}', '--log-level=warning',
], { stdio: ['ignore', 'ignore', 'inherit'] });
const { atlasQuery, shortSessionId, sessionIdMatches, cardMatchesQuery, looksLikeSessionId } = await import(pathToFileURL(bundle).href);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const claude = { sessionId: 'f586954c-d2cd-4db2-ae6c-54370fce3ac9' };
const harness = { sessionId: 'session-f586954c-d2cd-4db2-ae6c-54370fce3ac9' };
const codexTitle = 'Fix the atlas filter';

console.log('atlas query normalization');
test('trims and folds case', () => {
  assert(atlasQuery('  F586954C ') === 'f586954c', atlasQuery('  F586954C '));
});
test('drops the extension a copied file name drags along', () => {
  assert(atlasQuery('f586954c.jsonl') === 'f586954c', atlasQuery('f586954c.jsonl'));
  assert(atlasQuery('session-x.zstd') === 'session-x', atlasQuery('session-x.zstd'));
});
test('a file named with .json in the middle keeps its tail', () => {
  assert(atlasQuery('a.json.b') === 'a.json.b', atlasQuery('a.json.b'));
});

console.log('session ids');
test('the full id matches', () => {
  assert(sessionIdMatches(claude.sessionId, claude.sessionId), 'full id');
  assert(sessionIdMatches(harness.sessionId, harness.sessionId), 'full dsh id');
});
test('the short form on the card matches', () => {
  assert(sessionIdMatches(claude.sessionId, 'f586954c'), 'claude short form');
  assert(sessionIdMatches(harness.sessionId, 'f586954c'), 'dsh short form, prefix stripped');
  assert(sessionIdMatches(harness.sessionId, 'session-f586'), 'dsh full-form prefix');
});
test('the short form is what the card prints', () => {
  assert(shortSessionId(harness.sessionId) === claude.sessionId, shortSessionId(harness.sessionId));
  assert(shortSessionId(claude.sessionId) === claude.sessionId, 'bare id unchanged');
});
test('a pasted file name matches', () => {
  assert(sessionIdMatches(claude.sessionId, 'f586954c-d2cd-4db2-ae6c-54370fce3ac9.jsonl'), 'file name');
});
test('a middle fragment names nothing and must not match', () => {
  assert(!sessionIdMatches(claude.sessionId, '4db2'), 'middle fragment');
  assert(!sessionIdMatches(claude.sessionId, '54370fce'), 'tail fragment');
});
test('a different id does not match', () => {
  assert(!sessionIdMatches(claude.sessionId, 'deadbeef'), 'other id');
});
test('an empty query matches everything (the box is idle)', () => {
  assert(sessionIdMatches(claude.sessionId, ''), 'empty');
  assert(sessionIdMatches(claude.sessionId, '   '), 'blank');
});

console.log('cards');
test('the title still matches, case-insensitively', () => {
  assert(cardMatchesQuery(claude, codexTitle, 'atlas'), 'title word');
  assert(cardMatchesQuery(claude, codexTitle, 'FIX THE'), 'title phrase');
});
test('a card matches by title or by id', () => {
  assert(cardMatchesQuery(claude, codexTitle, 'f586954c'), 'by id');
  assert(!cardMatchesQuery(claude, codexTitle, 'deadbeef'), 'neither');
});

console.log('id-shaped queries');
test('ids are recognized', () => {
  assert(looksLikeSessionId(claude.sessionId), 'uuid');
  assert(looksLikeSessionId('f586954c'), 'short form');
  assert(looksLikeSessionId(harness.sessionId), 'dsh id');
  assert(looksLikeSessionId('f586954c-d2cd'), 'uuid prefix');
});
test('words are not ids', () => {
  assert(!looksLikeSessionId('atlas'), 'word');
  assert(!looksLikeSessionId('feedback'), 'word that begins with hex letters');
  assert(!looksLikeSessionId('why layer'), 'phrase');
  assert(!looksLikeSessionId(''), 'empty');
});

rmSync(tmp, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall atlas-search checks passed');
