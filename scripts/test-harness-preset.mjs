#!/usr/bin/env node
// Which Agent preset a FRESH session started from the canvas runs as. DSH
// takes a preset at session creation and locks it once the session has begun
// (agent-preset/locked), so the canvas's picker can only reach the fresh
// path: the plugin (dsh/lib/index.js) reads `harness.agentPreset` and passes
// it to session.create; a fork keeps its source session's preset by DSH's
// own design. The plugin is mounted on a stand-in host with a preset roster,
// and each question records the request it sent to session.create:
//   - no choice → nothing sent, the host default applies
//   - a chosen preset → sent as agentPreset, beside the folder/workspace rule
//   - an id the roster no longer offers (or a broken preset) → dropped, the
//     turn still runs on the default
//   - GET /agent-presets serves the roster the picker renders: healthy
//     presets only, in the host's order, with the current default
//
// Run: node scripts/test-harness-preset.mjs
import { createServer } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'td-preset-')));
const folder = join(tmp, 'project');

// the stand-in host: a preset roster and a session controller that records
// each create request and stops the turn there
const creates = [];
let apiHandler = null;
let presets = null;
const noop = () => {};
const roster = () => ({
  defaultId: 'standard',
  // shipped presets publish no name (the canvas localizes ids it knows);
  // a user-authored preset owns its own copy; one that cannot compose is out
  list: async () => [
    { id: 'standard', order: 1 },
    { id: 'ptc', order: 2 },
    { id: 'house-style', name: 'House style', description: 'Our own tools', order: 3 },
    { id: 'broken', order: 4, broken: 'cannot compose' },
  ],
});
const ctx = {
  effect: (fn) => fn(),
  on: noop,
  get: (name) => (name === 'agentPresets' ? presets : undefined),
  inject: noop,
  logger: { info: noop, warn: noop, error: noop, debug: noop },
  webServer: { register: ({ path, handler }) => { if (path.endsWith('/api')) apiHandler = handler; return noop; } },
  sessionController: { create: async (req) => { creates.push(req); throw new Error('stand-in host: stop after create'); } },
};
const plugin = await import(pathToFileURL(join(ROOT, 'dsh', 'lib', 'index.js')).href);
presets = roster();
await plugin.apply(ctx, { whyTools: false, whyPrompt: false });
const host = createServer((req, res) => apiHandler(req, res));
await new Promise((r) => host.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${host.address().port}/thoughtdag/api`;

/** The create request one question sends. */
async function createFor(harness) {
  creates.length = 0;
  await fetch(base + '/claude', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'harness/agent', messages: [{ role: 'user', content: 'hello' }], ...(harness ? { harness } : {}) }),
  }).then((r) => r.text());
  return creates.length === 1 ? creates[0] : { calls: creates.length };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  console.log('The canvas\'s Agent preset, at a fresh session');
  let r = await createFor(undefined);
  ok('no choice: nothing sent, the host default applies', same(r, {}), JSON.stringify(r));
  r = await createFor({ agentPreset: 'ptc' });
  ok('a chosen preset: sent as agentPreset', same(r, { agentPreset: 'ptc' }), JSON.stringify(r));
  r = await createFor({ cwd: folder, agentPreset: 'ptc' });
  ok('a folder and a preset travel together', same(r, { cwd: folder, agentPreset: 'ptc' }), JSON.stringify(r));
  r = await createFor({ agentPreset: 'gone' });
  ok('an id the roster no longer offers: dropped, the default applies', same(r, {}), JSON.stringify(r));
  r = await createFor({ agentPreset: 'broken' });
  ok('a preset that cannot compose: dropped', same(r, {}), JSON.stringify(r));

  console.log('\nThe roster the picker renders');
  let res = await fetch(base + '/agent-presets');
  let body = await res.json();
  ok('GET /agent-presets answers 200', res.status === 200, String(res.status));
  ok('healthy presets only, in roster order', same(body.presets.map((p) => p.id), ['standard', 'ptc', 'house-style']), JSON.stringify(body.presets.map((p) => p.id)));
  ok('the default is named', body.default === 'standard', JSON.stringify(body.default));
  ok('the default row is marked', body.presets[0]?.isDefault === true && body.presets[1]?.isDefault === false, JSON.stringify(body.presets));
  ok('a shipped preset carries no invented name', !('name' in body.presets[0]) && !('name' in body.presets[1]), JSON.stringify(body.presets));
  ok('a user preset keeps its own name and description', body.presets[2]?.name === 'House style' && body.presets[2]?.description === 'Our own tools', JSON.stringify(body.presets[2]));

  console.log('\nA host without the preset service');
  presets = null;
  r = await createFor({ agentPreset: 'ptc' });
  ok('a requested preset is dropped (the turn still runs)', same(r, {}), JSON.stringify(r));
  res = await fetch(base + '/agent-presets');
  body = await res.json();
  ok('the roster is empty', res.status === 200 && same(body, { presets: [], default: null }), JSON.stringify(body));
} finally {
  host.close();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
