/**
 * magento_validate_config and the configuration notice of the DI / event tools.
 *
 * Fixture: tests/fixtures/validate-config — a valid module, a not well-formed frontend di.xml, a
 * di.xml / events.xml with values Magento rejects or reads differently, a broken file in a module
 * disabled in config.php, and a broken file under Test/ (Magento never loads it). Expected messages
 * are the ones Magento 2.4.9 / PHP 8.3 / libxml 2.9.14 produced for these files
 * (src/php/validate-config.php in the Magento container). The native path runs against
 * fake-php.mjs, which answers like src/php/validate-config.php.
 *
 * Usage:
 *   node tests/validate-config.test.js
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { mkdtempSync, rmSync, cpSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'src', 'mcp-server.js');
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'validate-config');

let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); } else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`); }
}

function check(name, text, { has = [], hasNot = [] }) {
  const missing = has.filter(s => !text.includes(s));
  const unexpected = hasNot.filter(s => text.includes(s));
  if (!missing.length && !unexpected.length) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    return;
  }
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${name} — ${[
    missing.length ? `missing: ${missing.map(s => JSON.stringify(s)).join(', ')}` : '',
    unexpected.length ? `unexpected: ${unexpected.map(s => JSON.stringify(s)).join(', ')}` : '',
  ].filter(Boolean).join('; ')}`);
  if (process.env.VALIDATE_CONFIG_DEBUG) console.log(text);
}

class McpClient {
  constructor(env, root = FIXTURE_ROOT) {
    this.env = env;
    this.root = root;
    this.nextId = 1;
    this.pending = new Map();
  }

  async start() {
    this.dbDir = mkdtempSync(path.join(os.tmpdir(), 'magector-vc-'));
    this.child = spawn(process.execPath, [SERVER_PATH], {
      cwd: this.root,
      env: {
        ...process.env,
        MAGENTO_ROOT: this.root,
        MAGECTOR_DB: path.join(this.dbDir, 'index.db'),
        MAGECTOR_AUTO_INDEX: '0',
        MAGECTOR_PHP: '',
        ...this.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', () => {});
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    });
    await this.request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'validate-config-test', version: '1.0' },
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
      this.pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async call(name, args) {
    const res = await this.request('tools/call', { name, arguments: args });
    return (res.result?.content || []).map(c => c.text || '').join('\n');
  }

  /** Waits for the server to exit: it logs its shutdown to <root>/.magector, which a caller removing the root races. */
  async stop() {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise(resolve => { this.child.once('exit', resolve); this.child.kill(); });
    }
    rmSync(this.dbDir, { recursive: true, force: true });
  }
}

const BROKEN = 'app/code/Acme/Broken/etc/frontend/di.xml';
const VALUES_DI = 'app/code/Acme/Values/etc/di.xml';
const VALUES_EVENTS = 'app/code/Acme/Values/etc/events.xml';
const OFF = 'app/code/Acme/Off/etc/di.xml';
// Files that load or fail only merged with the area's other files. Verdicts from Magento's readers
// (merge-truth.php sets, Magento 2.4.5-p14): adminhtml loads, graphql fails ("Numeric value is
// expected."), crontab fails ("More than one node matching the query") though both files load alone
const MERGE_ADMIN = 'app/code/Acme/Merge/etc/adminhtml/di.xml';
// Completed by Acme_Good in the global area, which fails for another file (Acme_Values) — review of #33
const MERGE_GLOBAL = 'app/code/Acme/Merge/etc/di.xml';
const MERGE_GRAPHQL = 'app/code/Acme/Merge/etc/graphql/di.xml';
const VALUES_CRONTAB = 'app/code/Acme/Values/etc/crontab/di.xml';
const MERGE_CRONTAB = 'app/code/Acme/Merge/etc/crontab/di.xml';
const section = (t, title) => { const i = t.indexOf(`### ${title}`); return i < 0 ? '' : t.slice(i, (t.indexOf('\n### ', i + 4) + 1 || t.length + 1) - 1); };

async function main() {
  console.log('\nConfiguration validation (fixture: tests/fixtures/validate-config)\n');

  // ── Built-in check ─────────────────────────────────────────────
  const builtin = new McpClient({});   // MAGECTOR_PHP unset → built-in
  await builtin.start();
  try {
    let t = await builtin.call('magento_validate_config', {});
    check('built-in: engine and fallback reason are stated', t, {
      has: ['**Engine:** built-in', 'Native check not available (MAGECTOR_PHP is not set'],
    });
    check('built-in: not well-formed file — Magento\'s message, libxml first error with its line', t, {
      has: [
        `- \`${BROKEN}:5\``,
        `The XML in file "${path.join(FIXTURE_ROOT, BROKEN)}" is invalid:\nOpening and ending tag mismatch: type line 3 and typ\nLine: 5\n\nVerify the XML and try again.`,
      ],
    });
    check('built-in: plugin disabled="yes" — BooleanUtils exception', t, {
      has: [`- \`${VALUES_DI}:4\``, '<plugin name="values_disabled_yes"> disabled="yes": InvalidArgumentException \'Boolean value is expected, supported values: array (\n  0 => true,'],
    });
    check('built-in: number argument "12px" — Number interpreter exception', t, {
      has: [`- \`${VALUES_DI}:7\``, 'argument "limit": InvalidArgumentException \'Numeric value is expected.\''],
    });
    check('built-in: observer disabled="1" does not disable (read differently than written)', t, {
      has: ['### Loads, but not as written', `- \`${VALUES_EVENTS}:4\``, 'disabled="1" does not disable the observer'],
    });
    check('built-in: sortOrder="10abc" is read as (int) 10', t, { has: ['sortOrder="10abc" is read as (int) 10'] });
    check('built-in: broken file of a disabled module is marked', t, {
      has: [`- \`${OFF}:4\` _(module Acme_Off is disabled — not loaded now, fails once enabled)_`],
    });
    check('built-in: files under Test/ are not checked (Magento does not load them)', t, { hasNot: ['Test/Unit/etc/di.xml'] });
    check('built-in: valid files are not reported', t, { hasNot: ['Acme/Good/etc/di.xml`', 'Acme/Good/etc/events.xml`', 'module.xml`'] });
    check('built-in: an argument without xsi:type that another file of the area declares loads — Magento converts the merged area (was: fails in every mode)', section(t, 'Loads, but not as written'), {
      has: [`- \`${MERGE_ADMIN}:6\``, 'Value for key "xsi:type" is missing in the argument data.', 'another file of it sets what this file leaves out'],
    });
    check('built-in: … and is not reported as failing', section(t, 'Fails in every mode'), { hasNot: [MERGE_ADMIN] });
    check('built-in: … also when the area fails for another file — only the files the merged configuration fails for fail (was: every file of a failing area)', section(t, 'Loads, but not as written'), {
      has: [`- \`${MERGE_GLOBAL}:7\``, 'Value for key "xsi:type" is missing in the argument data.', 'another file of it sets what this file leaves out'],
    });
    check('built-in: … the other file still fails, this one does not', section(t, 'Fails in every mode'), { has: [`- \`${VALUES_DI}:4\``], hasNot: [MERGE_GLOBAL] });
    check('built-in: merged, the other file\'s xsi:type="number" meets "five" — the area fails with Magento\'s message', section(t, 'Fails in every mode'), {
      has: [`- \`${MERGE_GRAPHQL}:6\``, '**DI configuration, area graphql**', "argument \"limit\": InvalidArgumentException 'Numeric value is expected.'"],
    });
    check('built-in: two files that load alone fail merged — the type matches two nodes (Config\\Dom)', section(t, 'Fails in every mode'), {
      has: ['**DI configuration, area crontab**', "LocalizedException 'More than one node matching the query: /config/type[@name='Acme\\Good\\Model\\Thing']'"],
      hasNot: [`- \`${VALUES_CRONTAB}`, `- \`${MERGE_CRONTAB}`],
    });

    t = await builtin.call('magento_validate_config', { path: 'app/code/Acme/Good' });
    check('built-in: scope to a module — no problems', t, {
      has: ['under `app/code/Acme/Good`', '_No problems found by the built-in check (schema not checked)._'],
    });
    t = await builtin.call('magento_validate_config', { path: VALUES_EVENTS });
    check('built-in: scope to a single file', t, { has: ['**Files:** 1 under', `${VALUES_EVENTS}:4`], hasNot: [VALUES_DI] });
    t = await builtin.call('magento_validate_config', { engine: 'native' });
    check('engine native without PHP: says so instead of falling back', t, { has: ['Native check not available: MAGECTOR_PHP is not set'] });

    // ── Notice in the DI / event tools ─────────────────────────────
    t = await builtin.call('magento_find_plugin', { targetClass: 'Acme\\Good\\Model\\Thing' });
    check('find_plugin: notice lists the rejected file of an enabled module', t, {
      has: ['**Magento rejects 3 configuration file(s)**', `\`${BROKEN}:5\` — Opening and ending tag mismatch: type line 3 and typ`, `\`${VALUES_DI}:4\``, `\`${MERGE_GRAPHQL}:6\``],
      hasNot: [`\`${MERGE_ADMIN}`, `\`${MERGE_GLOBAL}`],
    });
    check('find_plugin: notice names areas whose merged configuration fails although each file loads alone', t, {
      has: ['**Magento fails to load the merged configuration of 2 area(s)**', "DI configuration, area crontab — LocalizedException 'More than one node matching the query"],
    });
    check('find_plugin: … not the one of a disabled module nor under Test/', t, { hasNot: [`${OFF}:`, 'Test/Unit/etc/di.xml'] });
    t = await builtin.call('magento_find_observer', { eventName: 'acme_good_saved' });
    check('find_observer: warns about the misread value in a file of this answer', t, {
      has: ['**Read differently than written**', `\`${VALUES_EVENTS}:4\` — <observer name="values_observer"> disabled="1" does not disable the observer`],
    });
  } finally {
    await builtin.stop();
  }

  // ── Native check (fake PHP) ────────────────────────────────────
  const native = new McpClient({ MAGECTOR_PHP: `"${process.execPath}" "${path.join(FIXTURE_ROOT, 'fake-php.mjs')}"`, MAGECTOR_PHP_ROOT: '/srv/magento' });
  await native.start();
  try {
    const t = await native.call('magento_validate_config', {});
    check('native: engine, PHP and libxml versions are stated', t, {
      has: ['**Engine:** native — Magento\'s classes and readers via `"', 'fake-php.mjs"` (PHP 8.3.0-fake, libxml 2.9.14)'],
    });
    check('native: output after the marker is used, noise before it ignored', t, {
      has: [`FAKE-NATIVE production error for /srv/magento/${BROKEN}`], hasNot: ['Deprecated: noise'],
    });
    check('native: an area Magento\'s reader cannot load fails in every mode', t, {
      has: ['- **DI configuration, area frontend**', 'FAKE-NATIVE frontend reader error\n(Magento\'s reader, production and default mode)'],
    });
    check('native: developer mode comes from the reader (merged schema), not a per-file guess', t, {
      has: ['### Fails in developer mode (schema) (1)', '- **DI configuration, area global**', 'FAKE-NATIVE merged schema error'],
    });
    check('native: converter exception of a file whose area loads → masked by a later file', t, {
      has: ['FAKE-NATIVE converter error\n(Magento converts the merged configuration of the area: another file of it sets what this file leaves out or overrides it'],
    });
    check('native: declared-schema violations are their own section, with the caveat', t, {
      has: ['### Violates the schema it declares (1)', 'FAKE-NATIVE declared schema error', 'module.xml is read without one'],
    });
    check('native: built-in warnings are added (Magento does not report them)', t, {
      has: ['### Loads, but not as written', 'disabled="1" does not disable the observer'],
    });
  } finally {
    await native.stop();
  }

  const failing = new McpClient({ MAGECTOR_PHP: 'exit 3' });
  await failing.start();
  try {
    const t = await failing.call('magento_validate_config', {});
    check('native command failing: falls back to built-in with the reason', t, {
      has: ['Native check not available (exit 3 failed (exit 3)', '**Engine:** built-in'],
    });
  } finally {
    await failing.stop();
  }

  // ── Review of #31 ──────────────────────────────────────────────
  const live = mkdtempSync(path.join(os.tmpdir(), 'magector-vc-live-'));
  cpSync(FIXTURE_ROOT, live, { recursive: true });
  const w = (rel, text) => { mkdirSync(path.dirname(path.join(live, rel)), { recursive: true }); writeFileSync(path.join(live, rel), text); };
  // A PHP on PATH that would answer as the native check; app/autoload.php present
  w('app/autoload.php', '<?php\n');
  const bin = path.join(live, '.bin');
  w('.bin/php', `#!/bin/sh\nif [ "$1" = "-r" ]; then exit 0; fi\nexec "${process.execPath}" "${path.join(live, 'fake-php.mjs')}"\n`);
  chmodSync(path.join(bin, 'php'), 0o755);
  // A module registered (module.xml) but not in config.php yet — right after `composer require`
  w('app/code/Acme/Fresh/etc/module.xml', '<?xml version="1.0"?>\n<config><module name="Acme_Fresh"/></config>\n');
  w('app/code/Acme/Fresh/etc/di.xml', '<?xml version="1.0"?>\n<config>\n  <type name="Acme\\Fresh\\X">\n</config>\n');
  // A pathologically deep argument (RangeError in a recursive reader)
  const depth = 30000;
  w('app/code/Acme/Good/etc/di.xml', readFileSync(path.join(live, 'app/code/Acme/Good/etc/di.xml'), 'utf-8').replace('</config>',
    `    <type name="Acme\\Good\\Model\\Deep"><arguments><argument name="a" xsi:type="array">${'<item name="i" xsi:type="array">'.repeat(depth)}${'</item>'.repeat(depth)}</argument></arguments></type>\n</config>`));
  const onPath = new McpClient({ PATH: `${bin}:${process.env.PATH}` }, live);
  await onPath.start();
  try {
    let t = await onPath.call('magento_validate_config', {});
    check('native check: never picked up from a php on PATH — only an explicit MAGECTOR_PHP (it bootstraps the project)', t, {
      has: ['**Engine:** built-in'], hasNot: ['FAKE-NATIVE'],
    });
    t = await onPath.call('magento_validate_config', { path: '/' });
    check('validate_config: a path outside the Magento root is refused (was: "/" walked the disk)', t, { has: ['is outside the Magento root'] });
    t = await onPath.call('magento_validate_config', { path: '../..' });
    check('validate_config: ".." cannot leave the root', t, { has: ['is outside the Magento root'] });
    t = await onPath.call('magento_find_plugin', { targetClass: 'Acme\\Good\\Model\\Thing' });
    check('notice: a module not in config.php yet is not counted as loaded (was: every DI answer said "Magento rejects")', t, {
      has: ['**Magento rejects', 'app/code/Acme/Broken/etc/frontend/di.xml'], hasNot: ['app/code/Acme/Fresh/etc/di.xml'],
    });
    check('notice: a file the check cannot read (deep nesting) does not replace the answer with an error', t, {
      has: ['### DI Plugin Registrations for Acme\\Good\\Model\\Thing'],
    });
  } finally {
    await onPath.stop();
  }
  // The native check does not block the server: another call is answered while it runs
  const slow = new McpClient({ MAGECTOR_PHP: `sleep 3; "${process.execPath}" "${path.join(live, 'fake-php.mjs')}"` }, live);
  await slow.start();
  try {
    const order = [];
    const validating = slow.call('magento_validate_config', {}).then(() => order.push('validate'));
    await new Promise(r => setTimeout(r, 300));
    await slow.call('magento_module_structure', { moduleName: 'Acme_Good' }).then(() => order.push('module_structure'));
    await validating;
    ok('native check: the server answers other calls while it runs (was: spawnSync blocked it)', order.join() === 'module_structure,validate', order.join());
  } finally {
    await slow.stop();
    rmSync(live, { recursive: true, force: true });
  }

  // ── Native check timeout ends the command and what it started (review of #33; POSIX only) ──
  // The timeout killed only the `sh -c`: the command it started kept running and kept the call open
  // until it exited (dash does not exec even a single command)
  if (process.platform !== 'win32') {
    const pidDir = mkdtempSync(path.join(os.tmpdir(), 'magector-vc-timeout-'));
    const pidFile = path.join(pidDir, 'pid');
    const hang = new McpClient({
      MAGECTOR_PHP: `cd . && "${process.execPath}" -e "require('fs').writeFileSync('${pidFile}', String(process.pid)); setTimeout(() => {}, 20000)"`,
      MAGECTOR_PHP_TIMEOUT_MS: '1000',
    });
    await hang.start();
    try {
      const t0 = Date.now();
      const t = await hang.call('magento_validate_config', { path: VALUES_EVENTS, engine: 'native' });
      const ms = Date.now() - t0;
      ok(`native check timeout: the call ends at the timeout (${ms} ms for a 1 s limit; was 20 s)`, ms < 5000, t);
      check('native check timeout: says so', t, { has: ['Native check not available', '(killed after 1 s)'] });
      const pid = Number(readFileSync(pidFile, 'utf-8'));
      let alive = true;
      for (let i = 0; i < 20 && alive; i++) {
        try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 100)); } catch { alive = false; }
      }
      ok('native check timeout: the command the shell started is killed too', !alive, `pid ${pid} still runs`);
      if (alive) try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ }
    } finally {
      await hang.stop();
      rmSync(pidDir, { recursive: true, force: true });
    }
  }

  // ── Config prewarm: off with MAGECTOR_AUTO_INDEX=0 unless asked for (review of #33) ──
  // CI and agent jobs set MAGECTOR_AUTO_INDEX=0 to keep background CPU off; the prewarm ran anyway,
  // and on a root that is no Magento install it walked the whole tree (31 CPU-s on 516k files)
  const prewarmLog = async (env, { withConfigPhp = true } = {}) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'magector-vc-prewarm-'));
    cpSync(FIXTURE_ROOT, root, { recursive: true });
    rmSync(path.join(root, '.magector'), { recursive: true, force: true });   // the fixture's own runs log there
    if (!withConfigPhp) rmSync(path.join(root, 'app/etc/config.php'));
    const c = new McpClient(env, root);
    await c.start();
    const log = () => { try { return readFileSync(path.join(root, '.magector', 'magector.log'), 'utf-8'); } catch { return ''; } };
    // the prewarm runs 1.5 s after the start without a tool call; wait for it, or 3 s
    for (let i = 0; i < 30 && !/Configuration check prewarmed/.test(log()); i++) await new Promise(r => setTimeout(r, 100));
    const text = log();
    await c.stop();
    rmSync(root, { recursive: true, force: true });
    return text;
  };
  let pl = await prewarmLog({});
  check('prewarm: off with MAGECTOR_AUTO_INDEX=0 — logged, not run', pl, {
    has: ['Configuration check prewarm skipped (MAGECTOR_AUTO_INDEX=0; MAGECTOR_PREWARM_CONFIG=1 turns it on)'], hasNot: ['Configuration check prewarmed'],
  });
  pl = await prewarmLog({ MAGECTOR_PREWARM_CONFIG: '1' });
  check('prewarm: MAGECTOR_PREWARM_CONFIG=1 runs it with MAGECTOR_AUTO_INDEX=0', pl, { has: ['Configuration check prewarmed ('], hasNot: ['Configuration check prewarm skipped'] });
  pl = await prewarmLog({ MAGECTOR_PREWARM_CONFIG: '0' });
  check('prewarm: MAGECTOR_PREWARM_CONFIG=0 never runs it', pl, { has: ['Configuration check prewarm skipped (MAGECTOR_PREWARM_CONFIG=0)'], hasNot: ['Configuration check prewarmed'] });
  pl = await prewarmLog({ MAGECTOR_PREWARM_CONFIG: '1' }, { withConfigPhp: false });
  check('prewarm: never outside a Magento install (no app/etc/config.php)', pl, {
    has: ['Configuration check prewarm skipped (no app/etc/config.php under MAGENTO_ROOT)'], hasNot: ['Configuration check prewarmed'],
  });

  // ── Entity amplification (review of #33) ───────────────────────
  // A 1 KB di.xml with 8 levels of nested entities: libxml rejects it ("Detected an entity reference
  // loop"); the expanding parser took 170 s and 2.4 GB for a find_plugin, 29 s for validate_config
  const lolRoot = mkdtempSync(path.join(os.tmpdir(), 'magector-vc-lol-'));
  cpSync(FIXTURE_ROOT, lolRoot, { recursive: true });
  let dtd = '<!ENTITY lol0 "lol">\n';
  for (let i = 1; i <= 8; i++) dtd += `<!ENTITY lol${i} "${`&lol${i - 1};`.repeat(10)}">\n`;
  writeFileSync(path.join(lolRoot, 'app/code/Acme/Good/etc/di.xml'), `<?xml version="1.0"?>\n<!DOCTYPE config [\n${dtd}]>\n` +
    '<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n    <type name="Acme\\Good\\Model\\Thing">\n' +
    '        <plugin name="good_thing" type="Acme\\Good\\Plugin\\ThingPlugin" sortOrder="10"/>\n' +
    '        <arguments><argument name="lol" xsi:type="string">&lol8;</argument></arguments>\n    </type>\n</config>\n');
  const lol = new McpClient({}, lolRoot);
  await lol.start();
  try {
    let t0 = Date.now();
    const plugins = await lol.call('magento_find_plugin', { targetClass: 'Acme\\Good\\Model\\Thing' });
    const pluginMs = Date.now() - t0;
    t0 = Date.now();
    const v = await lol.call('magento_validate_config', { path: 'app/code/Acme/Good/etc/di.xml' });
    const validateMs = Date.now() - t0;
    ok(`entity amplification: find_plugin and validate_config answer at once (${pluginMs} ms, ${validateMs} ms; were 170 s and 29 s)`, pluginMs < 5000 && validateMs < 5000);
    check('entity amplification: the file is rejected with libxml\'s message', v, {
      has: ['### Fails in every mode', 'app/code/Acme/Good/etc/di.xml:1', 'Detected an entity reference loop'],
    });
    check('entity amplification: the DI answer names it in the notice', plugins, {
      has: ['`app/code/Acme/Good/etc/di.xml:1` — Detected an entity reference loop', '### DI Plugin Registrations for Acme\\Good\\Model\\Thing'],
    });
  } finally {
    await lol.stop();
    rmSync(lolRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
