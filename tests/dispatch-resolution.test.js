#!/usr/bin/env node
/**
 * Where an event is dispatched, for names built from the class that runs the code.
 *
 * Fixture: tests/fixtures/dispatch-resolution — a model base class dispatching
 * `$this->_eventPrefix . '_save_after'` with the prefix set four levels below, in an abstract middle
 * layer, in a (nested) trait, through a constructor argument from di.xml (area, virtual type), by
 * `self::` / `static::`, interface constants, constant chains, a constant map, local variables in
 * branches, interpolation, sprintf, a request value. Expected names: truth.json — what PHP dispatches
 * when the fixture's code runs (scripts/verify-magento/dispatch-fixture-truth.php), not what the
 * test's author thinks. Before this change, find_event_dispatchers found only literal names.
 *
 * F1–F11 (review of #34): a class no autoloader loads is not searched for in the tree; a site in a
 * copy composer does not load is skipped (tests/fixtures/dispatch-composer); two sites on one line;
 * a trait method overriding the dispatching one; a value assigned in an ordinary method is possible,
 * not exact; `.=`; a constructor parameter's default; wildcard mode, `*` queries, an empty name, the
 * tool description; find_implementors' order; no background read with MAGECTOR_AUTO_INDEX=0; a
 * required constructor argument replaces the declared default.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractPhpFacts, createDispatchResolver, nameMatches, shownName, WILD } from '../src/php-dispatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'src', 'mcp-server.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'dispatch-resolution');
// composer's PSR-4 map, the live package, a stale copy of it and a package composer does not map
const COMPOSER_FIXTURE = path.join(__dirname, 'fixtures', 'dispatch-composer');
const truth = JSON.parse(readFileSync(path.join(FIXTURE, 'truth.json'), 'utf-8')).cases;
const cases = JSON.parse(readFileSync(path.join(FIXTURE, 'cases.json'), 'utf-8'));

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); } else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`); }
};
const check = (name, text, { has = [], hasNot = [] }) => {
  const missing = has.filter(s => !text.includes(s));
  const unexpected = hasNot.filter(s => text.includes(s));
  ok(name, !missing.length && !unexpected.length, [missing.length ? `missing: ${missing.map(s => JSON.stringify(s)).join(', ')}` : '', unexpected.length ? `unexpected: ${unexpected.map(s => JSON.stringify(s)).join(', ')}` : ''].filter(Boolean).join('; '));
  if ((missing.length || unexpected.length) && process.env.DISPATCH_DEBUG) console.log(text);
};
/** `file:line` of the first line of a fixture file containing `needle`. */
const at = (rel, needle) => {
  const lines = readFileSync(path.join(FIXTURE, rel), 'utf-8').split('\n');
  return `${rel}:${lines.findIndex(l => l.includes(needle)) + 1}`;
};
/** The line number of the first line containing `needle`, in a file of another fixture. */
const at2 = (root, rel, needle) => readFileSync(path.join(root, rel), 'utf-8').split('\n').findIndex(l => l.includes(needle)) + 1;

class McpClient {
  constructor(root, env = {}) { this.root = root; this.env = env; this.nextId = 1; this.pending = new Map(); }
  async start() {
    this.dbDir = mkdtempSync(path.join(os.tmpdir(), 'magector-dr-'));
    this.child = spawn(process.execPath, [SERVER_PATH], {
      cwd: this.root,
      env: { ...process.env, MAGENTO_ROOT: this.root, MAGECTOR_DB: path.join(this.dbDir, 'index.db'), MAGECTOR_AUTO_INDEX: '0', MAGECTOR_PREWARM_PHP: '0', ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', () => {});
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
    });
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dispatch-test', version: '1.0' } });
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
  async stop() {
    if (this.child.exitCode === null && this.child.signalCode === null) await new Promise(r => { this.child.once('exit', r); this.child.kill(); });
    rmSync(this.dbDir, { recursive: true, force: true });
  }
}

const MODEL = 'app/code/Acme/Disp/Model/AbstractModel.php';
const SAVE_AFTER = at(MODEL, "_eventPrefix . '_save_after'");
const LOAD_AFTER = at('app/code/Acme/Disp/Model/AbstractCollection.php', 'dispatch(');
const EMIT = at('app/code/Acme/Disp/Emitter/Emitter.php', 'dispatch(');
const NOTIFIER = 'app/code/Acme/Disp/Service/BaseNotifier.php';

// Every name PHP dispatched → the site the answer must list, and the class it must name (null: the
// name does not depend on the class that runs the code). A name of truth.json without an entry fails.
const expected = {
  acme_model_save_after: [at(MODEL, "'acme_model_save_after'"), null],
  acme_order_save_after: [SAVE_AFTER, 'Acme\\Disp\\Model\\Order'],
  acme_product_save_after: [SAVE_AFTER, 'Acme\\Disp\\Model\\Product'],
  acme_middle_save_after: [SAVE_AFTER, 'Acme\\Disp\\Model\\Leaf'],
  acme_trait_emitted: [EMIT, 'Acme\\Disp\\Emitter\\Traited'],
  acme_nested_emitted: [EMIT, 'Acme\\Disp\\Emitter\\NestedTraited'],
  acme_switch_a_save_after: [SAVE_AFTER, 'Acme\\Disp\\Model\\Switching'],
  acme_other_save_after: [SAVE_AFTER, 'Acme\\Disp\\Other\\AbstractModel'],
  acme_grid_load_after: [LOAD_AFTER, 'Acme\\Disp\\Model\\ResourceModel\\Grid\\Collection'],
  acme_other_grid_load_after: [LOAD_AFTER, 'AcmeOtherGridCollection'],
  acme_trait_user_fired: [at('app/code/Acme/Disp/Service/DispatchTrait.php', 'dispatch('), 'Acme\\Disp\\Service\\TraitUser'],
  acme_base_static: [at(NOTIFIER, 'static::KIND'), 'Acme\\Disp\\Service\\BaseNotifier'],
  acme_child_static: [at(NOTIFIER, 'static::KIND'), 'Acme\\Disp\\Service\\ChildNotifier'],
  acme_base_self: [at(NOTIFIER, 'self::KIND'), null],
  acme_alert_event: [at('app/code/Acme/Disp/Service/Alert.php', 'dispatch($generic)'), null],
  acme_root_reached: [at('app/code/Acme/Disp/Service/Alert.php', 'self::ROOT'), null],
  acme_chain_end: [at('app/code/Acme/Disp/Service/ConstChain.php', 'dispatch('), null],
  acme_status_approved: [at('app/code/Acme/Disp/Service/StatusMap.php', 'dispatch('), null],
  acme_status_rejected: [at('app/code/Acme/Disp/Service/StatusMap.php', 'dispatch('), null],
  acme_branch_a: [at('app/code/Acme/Disp/Service/Branchy.php', 'dispatch('), null],
  acme_branch_b: [at('app/code/Acme/Disp/Service/Branchy.php', 'dispatch('), null],
  acme_interp_done: [at('app/code/Acme/Disp/Service/Interp.php', '_done'), 'Acme\\Disp\\Service\\Interp'],
  // F3: two sites on one line — the second was answered from the first one's cache entry (keyed file:line)
  acme_line_first: [at('app/code/Acme/Disp/Service/OneLine.php', 'acme_line_first'), null],
  acme_line_second: [at('app/code/Acme/Disp/Service/OneLine.php', 'acme_line_second'), null],
  acme_traitloud_save_after: [SAVE_AFTER, 'Acme\\Disp\\Model\\TraitLoud'],
  acme_ctorassigned_save_after: [SAVE_AFTER, 'Acme\\Disp\\Model\\CtorAssigned'],
  // F6: `$name .= '_flagged'` in a branch — both names (was: only the one without the suffix)
  acme_appended: [at('app/code/Acme/Disp/Service/Appended.php', 'dispatch('), null],
  acme_appended_flagged: [at('app/code/Acme/Disp/Service/Appended.php', 'dispatch('), null],
  // F7: a constructor parameter di.xml does not set takes its default (was: `*`)
  acme_ctordefault_ran: [at('app/code/Acme/Disp/Service/CtorDefault.php', 'dispatch('), 'Acme\\Disp\\Service\\CtorDefault'],
  acme_ctoradmin_ran: [at('app/code/Acme/Disp/Service/CtorDefault.php', 'dispatch('), 'Acme\\Disp\\Service\\CtorDefaultAdmin'],
};
// A value assigned in an ordinary method (not the constructor): PHP dispatches it only when that method
// ran first — the site is listed under "Possible" for the class, naming the method (was: exact)
const expectedConditional = {
  acme_switch_b_save_after: [SAVE_AFTER, 'Acme\\Disp\\Model\\Switching', 'Acme\\Disp\\Model\\Switching::useB()'],
};
// Names with a part known only at runtime: the site is listed under "Possible", with the pattern
const expectedPossible = {
  acme_predispatch_checkout_cart_add: [at('app/code/Acme/Disp/Service/FrontLike.php', 'dispatch('), 'acme_predispatch_*'],
  acme_alert_event_checkout: [at('app/code/Acme/Disp/Service/Alert.php', 'dispatch($moduleEvent)'), 'acme_alert_event_*'],
  acme_copy_fieldset_convert: [at('app/code/Acme/Disp/Service/Interp.php', 'sprintf('), 'acme_copy_fieldset_*'],
  // F11: a required constructor argument without di.xml — runtime; the default it replaces never dispatches
  acme_dyn_wired_ran: [at('app/code/Acme/Disp/Service/Wired.php', 'dispatch('), '*_wired_ran'],
};

async function main() {
  console.log('\nDispatch sites resolved per class (fixture: tests/fixtures/dispatch-resolution, truth: PHP)\n');

  // ── 1. Pure helpers ─────────────────────────────────────────────
  ok('name match: a runtime part (WILD) matches any text', nameMatches('acme_predispatch_checkout_cart_add', `acme_predispatch_${WILD}`));
  ok('name match: Magento lower-cases the dispatched name', nameMatches('ACME_X', 'acme_x'));
  ok('name match: `*` in the query', nameMatches('*_save_after', 'acme_product_save_after') && !nameMatches('*_save_after', 'acme_product_load_after'));
  const cycle = extractPhpFacts("<?php\nnamespace A;\nclass C { const X = self::Y; const Y = self::X; public $m; function f() { $this->m->eventManager->dispatch(self::X . '_cycle'); } }\n");
  const cyc = createDispatchResolver({ typeOf: f => cycle.types.find(t => t.fqcn === f) || null });
  const cycleValues = cyc.resolveSite(cycle.dispatches[0], { concrete: () => [] })[0].values;
  ok('constants referring to each other (PHP: fatal) end as a wildcard, not a hang', cycleValues.length === 1 && shownName(cycleValues[0]) === '*_cycle', JSON.stringify(cycleValues.map(shownName)));

  // ── 2. Every name PHP dispatched is found — at the site PHP ran, for the class that ran it ──
  const c = new McpClient(FIXTURE);
  await c.start();
  try {
    const dispatched = [...new Set(Object.values(truth).flat())];
    const unlisted = dispatched.filter(n => !expected[n] && !expectedPossible[n] && !expectedConditional[n]);
    ok(`every name PHP dispatched has an expectation (${dispatched.length} names from ${cases.length} cases)`, !unlisted.length, unlisted.join(', '));
    for (const name of dispatched.filter(n => expected[n])) {
      const [where, cls] = expected[name];
      const t = await c.call('magento_find_event_dispatchers', { eventName: name });
      const exactPart = t.split('\nPossible')[0];
      check(`\`${name}\` — dispatched at ${where}${cls ? ` for \`${cls}\`` : ''}${cls ? ' (was: not found — only literal names were)' : ''}`, exactPart, {
        has: [where, ...(cls ? [`for \`${cls}\``] : [])],
      });
    }
    for (const [name, [where, cls, method]] of Object.entries(expectedConditional)) {
      const t = await c.call('magento_find_event_dispatchers', { eventName: name });
      const [exactPart, possiblePart = ''] = t.split('\nPossible');
      check(`F5: \`${name}\` — assigned in ${method}: not exact for \`${cls}\` (was: exact)`, exactPart, { hasNot: [`for \`${cls}\``] });
      check(`F5: \`${name}\` — listed as possible at ${where}, for \`${cls}\`, naming ${method}`, possiblePart, { has: [where, `for \`${cls}\``, method] });
    }
    check('F5: the explanation of an exact value names where that value comes from (the default, not the assignment)', await c.call('magento_find_event_dispatchers', { eventName: 'acme_switch_a_save_after' }), {
      has: ["for `Acme\\Disp\\Model\\Switching` — $_eventPrefix = 'acme_switch_a' (app/code/Acme/Disp/Model/Switching.php:"],
    });
    check('F5: … and the constructor\'s value when the constructor assigned it (was: the declared default it replaced)', await c.call('magento_find_event_dispatchers', { eventName: 'acme_ctorassigned_save_after' }), {
      has: ["for `Acme\\Disp\\Model\\CtorAssigned` — $_eventPrefix = 'acme_ctorassigned' assigned in Acme\\Disp\\Model\\CtorAssigned::__construct() (app/code/Acme/Disp/Model/CtorAssigned.php:"],
    });
    let f7 = await c.call('magento_find_event_dispatchers', { eventName: 'acme_ctordefault_ran' });
    check('F7: the default of a constructor parameter di.xml does not set — named as such', f7, {
      has: ["for `Acme\\Disp\\Service\\CtorDefault` — $eventPrefix = 'acme_ctordefault' — the default of constructor parameter $eventPrefix (no di.xml argument; app/code/Acme/Disp/Service/CtorDefault.php:11)"],
    });
    check('F7: … also for a class whose di.xml argument exists only in adminhtml: the other areas take the default', f7, {
      has: ['for `Acme\\Disp\\Service\\CtorDefaultAdmin`', 'the default of constructor parameter $eventPrefix (di.xml sets it only in [adminhtml];'],
    });
    f7 = await c.call('magento_find_event_dispatchers', { eventName: 'acme_ctoradmin_ran' });
    check('F7: … and the adminhtml argument names its di.xml', f7, { has: ['for `Acme\\Disp\\Service\\CtorDefaultAdmin` — $eventPrefix from di.xml argument `eventPrefix` — [adminhtml] app/code/Acme/Disp/etc/adminhtml/di.xml'] });
    for (const [name, [where, pattern]] of Object.entries(expectedPossible)) {
      const t = await c.call('magento_find_event_dispatchers', { eventName: name });
      check(`runtime part: \`${name}\` — the site is listed as possible with \`${pattern}\``, t.split('\nPossible')[1] || '', { has: [where, `\`${pattern}\``] });
    }
    check('F11: the declared default a required constructor argument replaces is not an exact name (was: `acme_wired_ran` exact)',
      (await c.call('magento_find_event_dispatchers', { eventName: 'acme_wired_ran' })).split('\nPossible')[0], { hasNot: ['for `Acme\\Disp\\Service\\Wired`'] });

    // ── 3. Layers and areas ───────────────────────────────────────
    let t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_product_save_after' });
    check('E2: the chain between the dispatching class and the class that runs it is named, every layer', t, {
      has: ['via `Acme\\Disp\\Model\\AbstractExtensible` → `Acme\\Disp\\Model\\Catalog\\AbstractCatalog`', "$_eventPrefix = 'acme_product' (app/code/Acme/Disp/Model/Product.php:"],
    });
    check('E3: a class below an abstract middle layer takes the middle prefix, not the root one', await c.call('magento_find_event_dispatchers', { eventName: 'core_abstract_save_after' }), {
      hasNot: ['for `Acme\\Disp\\Model\\Leaf`', 'for `Acme\\Disp\\Model\\Middle`'],
    });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_grid_load_after' });
    check('E13: a prefix from a constructor argument names the di.xml and its area', t, { has: ['from di.xml argument `eventPrefix`', '[adminhtml] app/code/Acme/Disp/etc/adminhtml/di.xml'] });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_other_grid_load_after' });
    check('E13: a virtual type with its own argument is its own event', t, { has: ['for `AcmeOtherGridCollection`', 'virtual type of `Acme\\Disp\\Model\\ResourceModel\\Grid\\Collection`'] });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_silent_save_after' });
    check('E15: PHP never dispatches it (afterSave() overridden without parent::) — listed, marked', t, {
      has: ['for `Acme\\Disp\\Model\\Silent`', '`Acme\\Disp\\Model\\Silent::afterSave()` overrides it without parent:: — may not dispatch'],
    });
    ok('E15: … and PHP indeed dispatched nothing', (truth['E15 override without parent'] || []).length === 0);
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_traitsilenced_save_after' });
    check('F4: a trait method overriding afterSave() without parent:: — listed, marked (was: exact, unmarked)', t, {
      has: ['for `Acme\\Disp\\Model\\TraitSilenced`', '`Acme\\Disp\\Model\\TraitSilenced::afterSave()` from trait `Acme\\Disp\\Model\\SilentTrait` overrides it without parent:: — may not dispatch'],
    });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_nestedsilenced_save_after' });
    check('F4: … through a nested trait', t, {
      has: ['`Acme\\Disp\\Model\\NestedSilenced::afterSave()` from trait `Acme\\Disp\\Model\\SilentTrait` overrides it without parent::'],
    });
    ok('F4: … and PHP indeed dispatched nothing for either', truth['F4 trait override without parent']?.length === 0 && truth['F4 nested trait override without parent']?.length === 0);
    check('F4: a trait override that calls parent:: is not marked', await c.call('magento_find_event_dispatchers', { eventName: 'acme_traitloud_save_after' }), {
      has: ['for `Acme\\Disp\\Model\\TraitLoud`'], hasNot: ['may not dispatch'],
    });
    check('F4: the trait that holds the dispatch does not override itself', await c.call('magento_find_event_dispatchers', { eventName: 'acme_trait_user_fired' }), {
      has: ['for `Acme\\Disp\\Service\\TraitUser`'], hasNot: ['may not dispatch'],
    });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_base_self' });
    check('E7: self:: names the class that wrote the code — the same name for the base and the child', t, { has: [at('app/code/Acme/Disp/Service/BaseNotifier.php', 'self::KIND')] });
    check('E7: static:: gives the base its own name', await c.call('magento_find_event_dispatchers', { eventName: 'acme_base_static' }), { has: ['for `Acme\\Disp\\Service\\BaseNotifier`'], hasNot: ['for `Acme\\Disp\\Service\\ChildNotifier`'] });

    // ── 4. Not events, unknown parents ────────────────────────────
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_symfony_x', match: 'wildcard' });
    check('E18: a runtime name on another dispatcher (not Magento\'s event manager) is not an event', t, { hasNot: ['SymfonyLike'] });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_whatever_orphan' });
    check('E17: a parent whose file is missing is named — the part it would declare stays a wildcard', t, {
      has: [at('app/code/Acme/Disp/Model/Orphan.php', 'dispatch('), 'inheritance broken at Acme\\Missing\\Base'],
    });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_ghost_save_after' });
    check('F1: a class no autoloader can load never runs — it is not searched for in the tree (was: found by a glob of the whole tree, ~1.4 s per class on a large project)', t, {
      hasNot: ['for `Acme\\Hidden\\Ghost`'],
    });

    // ── 5. Modes and wildcards ────────────────────────────────────
    // narrow enough that a line's cap (8 names, 8 classes) does not decide it as the fixture grows
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_prod*_save_after' });
    check('`*` in the query: the resolved names of the site, with the classes', t, { has: [SAVE_AFTER, '`acme_product_save_after`', 'for `Acme\\Disp\\Model\\Product`'] });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_predispatch_checkout_cart_add', match: 'strict' });
    check('match=strict: no possible (runtime) sites', t, { hasNot: ['Possible'] });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_product_save_after', match: 'wildcard' });
    check('match=wildcard: only sites with a runtime part', t, { hasNot: [`for \`Acme\\Disp\\Model\\Product\``] });
    check('F8: … and it does not speak of an "exact name" (was: "No dispatch site with this exact name")', t, { hasNot: ['exact name'] });
    t = await c.call('magento_find_event_dispatchers', { eventName: '*_load_after', match: 'wildcard' });
    check('F8: match=wildcard keeps the known-parts filter — a runtime name that shares nothing with the query is no lead (was: every runtime site listed)', t, {
      hasNot: ['acme_predispatch_', 'acme_alert_event_', 'acme_copy_fieldset_'],
    });
    t = await c.call('magento_find_event_dispatchers', { eventName: 'acme_nothing_*' });
    check('F8: a `*` query without a match does not speak of an "exact name"', t, { has: ['No dispatch site with a known name matches `acme_nothing_*`'], hasNot: ['exact name'] });
    const tools = (await c.request('tools/list', {})).result?.tools || [];
    const description = tools.find(x => x.name === 'magento_find_event_dispatchers')?.description || '';
    ok('F8: the description agents read says what the tool does now (was: "exact grep matching, method context, and surrounding code")',
      !description.includes('grep') && description.includes('`*`') && description.includes('resolved for every concrete subclass'), description.slice(0, 120));
    // F9: find_implementors shares the class hierarchy; its order must not be the order files were read in
    const impl = await c.call('magento_find_implementors', { interfaceName: 'Acme\\Disp\\Impl\\Marker' });
    const listed = [...impl.matchAll(/^- `(Acme\\[^`]+)`/gm)].map(x => x[1]);
    const sorted = [...listed].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    ok('F9: find_implementors lists the implementors sorted, not in the order the files were read (walk or glob)',
      listed.length === 3 && listed.join() === sorted.join(), listed.join(', '));
    const empty = await c.request('tools/call', { name: 'magento_find_event_dispatchers', arguments: { eventName: '  ' } });
    ok('F8: an empty eventName is an error saying what to pass (was: an answer for the name ``)',
      empty.result?.isError === true && /eventName is required/.test(empty.result?.content?.[0]?.text || ''), JSON.stringify(empty.result).slice(0, 160));
  } finally {
    await c.stop();
  }

  // ── 6. The verification JSON is uncapped for this tool only ─────
  const jc = new McpClient(FIXTURE, { MAGECTOR_DISPATCH_JSON: '1', MAGECTOR_MAX_OUTPUT_CHARS: '200' });
  await jc.start();
  try {
    const other = await jc.call('magento_module_structure', { moduleName: 'Acme_Disp' });
    ok('F8: MAGECTOR_DISPATCH_JSON lifts the output cap only for find_event_dispatchers (was: for every tool)', other.includes('Output truncated'), other.slice(0, 120));
    let claims = null;
    try { claims = JSON.parse(await jc.call('magento_find_event_dispatchers', { eventName: '*' })); } catch { /* cut */ }
    ok('F8: … whose verification JSON stays whole', Boolean(claims?.exact?.length));
  } finally {
    await jc.stop();
  }

  // ── 7. The file composer loads ──────────────────────────────────
  const cc = new McpClient(COMPOSER_FIXTURE);
  await cc.start();
  try {
    let t = await cc.call('magento_find_event_dispatchers', { eventName: 'acme_live_ping' });
    check('F2: a stale copy of a class — a file composer does not load for it — is not a dispatch site (was: listed beside the live one)', t, {
      has: [`vendor/acme/live/src/Model.php:${at2(COMPOSER_FIXTURE, 'vendor/acme/live/src/Model.php', "'acme_live_ping'")}`], hasNot: ['vendor/acme/live-copy/'],
    });
    t = await cc.call('magento_find_event_dispatchers', { eventName: 'acme_child_saved' });
    check('F2: … nor for a subclass resolved through it', t, { has: ['for `Acme\\Live\\Child`', 'vendor/acme/live/src/Model.php:'], hasNot: ['vendor/acme/live-copy/'] });
    t = await cc.call('magento_find_event_dispatchers', { eventName: 'acme_unmapped_ping' });
    check('F2: a class no autoloader resolves keeps its site — nothing says another file is the live one', t, { has: ['vendor/acme/unmapped/Thing.php:'] });
  } finally {
    await cc.stop();
  }

  // ── 8. The background read and MAGECTOR_AUTO_INDEX=0 ───────────
  // A CI or agent job sets MAGECTOR_AUTO_INDEX=0 to keep background CPU off: no background PHP read
  // either, unless MAGECTOR_PREWARM_PHP=1 asks for it.
  const pw = mkdtempSync(path.join(os.tmpdir(), 'magector-dr-prewarm-'));
  cpSync(FIXTURE, pw, { recursive: true });
  rmSync(path.join(pw, '.magector'), { recursive: true, force: true });
  const logOf = () => { try { return readFileSync(path.join(pw, '.magector', 'magector.log'), 'utf-8'); } catch { return ''; } };
  const waitFor = async (pred, ms) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 200)); return pred(); };
  try {
    const off = new McpClient(pw, { MAGECTOR_PREWARM_PHP: '' });         // unset; MAGECTOR_AUTO_INDEX=0
    await off.start();
    await new Promise(r => setTimeout(r, 3500));                          // the read would start after 1.5 s
    await off.stop();
    ok('F10: MAGECTOR_AUTO_INDEX=0 and MAGECTOR_PREWARM_PHP unset — no background PHP read (was: read anyway)', !/PHP scan:/.test(logOf()) && /PHP prewarm skipped/.test(logOf()));
    rmSync(path.join(pw, '.magector'), { recursive: true, force: true });
    const on = new McpClient(pw, { MAGECTOR_PREWARM_PHP: '1' });
    await on.start();
    const warmed = await waitFor(() => /PHP scan and dispatch sites prewarmed/.test(logOf()), 15000);
    await on.stop();
    ok('F10: … MAGECTOR_PREWARM_PHP=1 turns it on', warmed);
  } finally {
    rmSync(pw, { recursive: true, force: true });
  }

  // ── 9. Mid-session changes ──────────────────────────────────────
  const live = mkdtempSync(path.join(os.tmpdir(), 'magector-dr-live-'));
  cpSync(FIXTURE, live, { recursive: true });
  const lc = new McpClient(live, { MAGECTOR_PHP_LIST_TTL_MS: '0', MAGECTOR_FILE_LIST_TTL_MS: '0' });
  await lc.start();
  try {
    let t = await lc.call('magento_find_event_dispatchers', { eventName: 'acme_late_save_after' });
    ok('fresh: before — no class has the prefix acme_late', !t.includes('for `Acme\\Disp\\Model\\Late`'));
    const w = (rel, body) => { mkdirSync(path.dirname(path.join(live, rel)), { recursive: true }); writeFileSync(path.join(live, rel), body); };
    w('app/code/Acme/Disp/Model/Late.php', "<?php\nnamespace Acme\\Disp\\Model;\n\nclass Late extends Middle\n{\n    protected $_eventPrefix = 'acme_late';\n}\n");
    t = await lc.call('magento_find_event_dispatchers', { eventName: 'acme_late_save_after' });
    check('fresh: a subclass added mid-session is resolved — two layers below the dispatch (was: invisible until restart)', t, { has: ['for `Acme\\Disp\\Model\\Late`', 'via `Acme\\Disp\\Model\\Middle`'] });
    const model = readFileSync(path.join(live, MODEL), 'utf-8').replace("'_save_after'", "'_saved'");
    w(MODEL, model);
    t = await lc.call('magento_find_event_dispatchers', { eventName: 'acme_product_saved' });
    check('fresh: an edited dispatch site is read again', t, { has: ['for `Acme\\Disp\\Model\\Product`'] });
    t = await lc.call('magento_find_event_dispatchers', { eventName: 'acme_found_orphan' });
    ok('fresh: before — the parent of Orphan is missing, its prefix unknown', !t.split('\nPossible')[0].includes('for `Acme\\Disp\\Model\\Orphan`'));
    w('app/code/Acme/Missing/Base.php', "<?php\nnamespace Acme\\Missing;\n\nclass Base\n{\n    protected $prefix = 'acme_found';\n}\n");
    t = await lc.call('magento_find_event_dispatchers', { eventName: 'acme_found_orphan' });
    check('fresh: a class missing before is found once its file is added (a remembered miss is forgotten)', t.split('\nPossible')[0], {
      has: ['for `Acme\\Disp\\Model\\Orphan`', "$prefix = 'acme_found' (app/code/Acme/Missing/Base.php:6)"],
    });
  } finally {
    await lc.stop();
    rmSync(live, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
