/**
 * Structural model of Magento DI and event configuration.
 *
 * Parses di.xml / events.xml with a small XML parser (comments, CDATA, self-closing elements and
 * entities handled) instead of regexes over raw text, and resolves what Magento resolves at runtime:
 * virtual types (transitively), preferences, plugins inherited from parent classes and interfaces,
 * and the DI area of each file. No I/O besides the file readers passed in, so it can be unit-tested.
 */

import { readFileSync } from 'fs';

// ─── XML ────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/**
 * Parse an XML document into { name, attrs, children, text } nodes. Tolerant: unknown or
 * unbalanced closing tags are ignored rather than thrown, so a broken file yields what it can.
 */
export function parseXml(content) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  if (!content) return root;
  const src = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const stack = [root];
  const tagRe = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {           // CDATA
      top.text += m[1];
    } else if (m[6] !== undefined) {    // text
      top.text += decodeEntities(m[6]);
    } else if (m[2] === '/') {          // closing tag
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[3]) { stack.length = i; break; }
      }
    } else {                            // opening or self-closing tag
      const attrs = {};
      const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = attrRe.exec(m[4])) !== null) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
      const node = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (m[5] !== '/') stack.push(node);
    }
  }
  return root;
}

function* walk(node) {
  for (const child of node.children) {
    yield child;
    yield* walk(child);
  }
}

/** xs:boolean as used by Magento's XSDs: true / 1 and false / 0; null when absent or invalid. */
export function xmlBoolean(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return null;
}

// ─── Names and areas ────────────────────────────────────────────

/** `\Foo\\Bar` → `Foo\Bar` */
export function normalizeClassName(name) {
  if (!name) return '';
  return String(name).trim().replace(/\\\\/g, '\\').replace(/^\\/, '');
}

/**
 * DI area of a config file: `etc/<area>/di.xml` → `<area>`, `etc/di.xml` → `global`.
 * Works for events.xml, routes.xml, … as well.
 */
export function areaFromPath(relPath) {
  const m = /(?:^|\/)etc\/([^/]+)\/[^/]+\.xml$/.exec(relPath || '');
  return m ? m[1] : 'global';
}

// ─── DI model ───────────────────────────────────────────────────

function collectObjectRefs(node, path, out) {
  for (const child of node.children) {
    if (child.name !== 'argument' && child.name !== 'item') continue;
    const childPath = path ? `${path}.${child.attrs.name ?? ''}` : (child.attrs.name ?? '');
    const xsiType = child.attrs['xsi:type'];
    if (xsiType === 'object') {
      const value = normalizeClassName(child.text);
      if (value) out.push({ path: childPath, value });
    }
    collectObjectRefs(child, childPath, out);
  }
}

function argumentsOf(node) {
  const argsNode = node.children.find(c => c.name === 'arguments');
  if (!argsNode) return { args: [], objectRefs: [] };
  const args = argsNode.children.filter(c => c.name === 'argument').map(a => ({
    name: a.attrs.name ?? '',
    xsiType: a.attrs['xsi:type'] ?? '',
    value: a.text.trim().slice(0, 200),
    items: a.children.filter(i => i.name === 'item').map(i => ({
      name: i.attrs.name ?? '', xsiType: i.attrs['xsi:type'] ?? '', value: i.text.trim().slice(0, 200),
    })),
  }));
  const objectRefs = [];
  collectObjectRefs(argsNode, '', objectRefs);
  return { args, objectRefs };
}

/**
 * Parse one di.xml. Returns flat lists; `file` and `area` are attached to every entry.
 */
export function parseDiXml(content, relPath) {
  const area = areaFromPath(relPath);
  const doc = parseXml(content);
  const out = { preferences: [], virtualTypes: [], types: [] };
  const configNode = doc.children.find(c => c.name === 'config') || doc;
  for (const node of configNode.children) {
    if (node.name === 'preference') {
      out.preferences.push({
        for: normalizeClassName(node.attrs.for), type: normalizeClassName(node.attrs.type), file: relPath, area,
      });
    } else if (node.name === 'virtualType' || node.name === 'type') {
      const { args, objectRefs } = argumentsOf(node);
      const plugins = node.children.filter(c => c.name === 'plugin').map(p => ({
        name: p.attrs.name ?? '',
        type: normalizeClassName(p.attrs.type),
        disabled: xmlBoolean(p.attrs.disabled) === true,
        // null when the attribute is absent: a later declaration of the same name keeps the earlier value
        disabledAttr: xmlBoolean(p.attrs.disabled),
        sortOrder: p.attrs.sortOrder ?? null,
      }));
      const entry = { name: normalizeClassName(node.attrs.name), args, objectRefs, plugins, file: relPath, area };
      if (node.name === 'virtualType') {
        out.virtualTypes.push({ ...entry, type: normalizeClassName(node.attrs.type) });
      } else {
        out.types.push(entry);
      }
    }
  }
  return out;
}

/**
 * Build a DI model from `[{ relPath, content }]`.
 */
export function buildDiModel(diFiles) {
  const model = { preferences: [], virtualTypes: [], types: [], virtualByName: new Map() };
  for (const { relPath, content } of diFiles) {
    let parsed;
    try { parsed = parseDiXml(content, relPath); } catch { continue; }
    model.preferences.push(...parsed.preferences);
    model.virtualTypes.push(...parsed.virtualTypes);
    model.types.push(...parsed.types);
  }
  for (const vt of model.virtualTypes) {
    if (!model.virtualByName.has(vt.name)) model.virtualByName.set(vt.name, []);
    model.virtualByName.get(vt.name).push(vt);
  }
  return model;
}

export function isVirtualType(model, name) {
  return model.virtualByName.has(normalizeClassName(name));
}

/**
 * Follow a virtual type to the PHP class it instantiates. Returns { real, chain } where chain
 * starts with `name`. Prefers the global declaration; cycles are cut.
 */
export function resolveVirtualType(model, name) {
  let cur = normalizeClassName(name);
  const chain = [cur];
  const seen = new Set([cur]);
  while (model.virtualByName.has(cur)) {
    const decls = model.virtualByName.get(cur);
    const decl = decls.find(d => d.area === 'global') || decls[0];
    if (!decl.type || seen.has(decl.type)) break;
    cur = decl.type;
    seen.add(cur);
    chain.push(cur);
  }
  return { real: cur, chain };
}

/** Preference declarations for a type, all areas. */
export function preferencesFor(model, name) {
  const n = normalizeClassName(name);
  return model.preferences.filter(p => p.for === n);
}

/**
 * The class that is instantiated for a requested type in the global area: preference (the last
 * global declaration seen; area-specific ones are reported separately) then virtual-type resolution.
 */
export function resolveInstance(model, name) {
  const n = normalizeClassName(name);
  const prefs = preferencesFor(model, n);
  const globalPrefs = prefs.filter(p => p.area === 'global');
  let target = n;
  const steps = [];
  if (globalPrefs.length) {
    target = globalPrefs[globalPrefs.length - 1].type;
    steps.push(`preference ${target}`);
  }
  const { real, chain } = resolveVirtualType(model, target);
  if (chain.length > 1) steps.push(...chain.slice(1).map(c => `virtualType → ${c}`));
  return { real, steps, preferences: prefs };
}

/** Every virtual type that resolves (transitively) to `className`, with its chain. */
export function virtualTypesResolvingTo(model, className) {
  const target = normalizeClassName(className);
  const out = [];
  for (const vt of model.virtualTypes) {
    const { real, chain } = resolveVirtualType(model, vt.name);
    if (real === target && vt.name !== target) out.push({ ...vt, chain });
  }
  return out;
}

/**
 * Every DI argument (`xsi:type="object"`, in arguments or nested array items) whose value resolves
 * to `className` — directly, through virtual types, preferences, or as `<Class>Factory` / `<Class>\Proxy`.
 */
export function argumentInjectionsOf(model, className) {
  const target = normalizeClassName(className);
  const out = [];
  const owners = [...model.types.map(t => ({ ...t, kind: 'type' })), ...model.virtualTypes.map(v => ({ ...v, kind: 'virtualType' }))];
  for (const owner of owners) {
    for (const ref of owner.objectRefs) {
      let value = ref.value;
      let via = null;
      if (value.endsWith('\\Proxy')) { value = value.slice(0, -'\\Proxy'.length); via = 'Proxy'; }
      else if (/Factory$/.test(value) && !isVirtualType(model, value) && normalizeClassName(value.slice(0, -'Factory'.length)) === target) {
        value = value.slice(0, -'Factory'.length); via = 'Factory';
      }
      const { real, chain } = resolveVirtualType(model, value);
      const pref = preferencesFor(model, real).filter(p => p.area === 'global').pop();
      const finalReal = pref ? resolveVirtualType(model, pref.type).real : real;
      if (real === target || finalReal === target || value === target) {
        out.push({
          owner: owner.name, ownerKind: owner.kind, argument: ref.path, value: ref.value,
          chain: chain.length > 1 ? chain : null, via, file: owner.file, area: owner.area,
        });
      }
    }
  }
  return out;
}

/** Plugin declarations on exactly `typeName` (all areas). */
export function pluginDeclarationsOn(model, typeName) {
  const n = normalizeClassName(typeName);
  const out = [];
  for (const t of [...model.types, ...model.virtualTypes]) {
    if (t.name !== n) continue;
    for (const p of t.plugins) out.push({ ...p, target: t.name, file: t.file, area: t.area });
  }
  return out;
}

/**
 * Plugins that apply to `className` the way Magento resolves them: declared on the class itself,
 * on its parent classes and interfaces (`ancestors`, nearest first), and — for a virtual type — on
 * its real class. Plugins declared only on a virtual type name never run (the interceptor looks
 * plugins up by the real class); they are returned with `onVirtualType: true`.
 */
export function effectivePluginDeclarations(model, className, ancestorsOf) {
  const requested = normalizeClassName(className);
  const virtual = isVirtualType(model, requested);
  const real = virtual ? resolveVirtualType(model, requested).real : requested;
  const lookup = [real, ...ancestorsOf(real)];
  const out = [];
  for (const [i, type] of lookup.entries()) {
    for (const d of pluginDeclarationsOn(model, type)) {
      out.push({ ...d, inheritedFrom: i === 0 ? null : type });
    }
  }
  if (virtual) {
    for (const d of pluginDeclarationsOn(model, requested)) out.push({ ...d, onVirtualType: true });
  }
  return { real, virtual, declarations: out };
}

/**
 * How a plugin's declared type is resolved: its before/after/around methods are read from the
 * declared type (a virtual type → its base class), the instance comes from the object manager
 * (preference applied).
 */
export function resolvePluginType(model, pluginType) {
  const declared = normalizeClassName(pluginType);
  const methodsFrom = resolveVirtualType(model, declared).real;
  const inst = resolveInstance(model, declared);
  return { declared, methodsFrom, runs: inst.real };
}

// ─── Events ─────────────────────────────────────────────────────

/** Observer declarations for one event in one events.xml — including ones without `instance`. */
export function parseEventsXml(content, relPath, eventName) {
  const area = areaFromPath(relPath);
  const doc = parseXml(content);
  const out = [];
  for (const node of walk(doc)) {
    if (node.name !== 'event' || node.attrs.name !== eventName) continue;
    for (const o of node.children.filter(c => c.name === 'observer')) {
      out.push({
        name: o.attrs.name ?? '',
        instance: o.attrs.instance ? normalizeClassName(o.attrs.instance) : null,
        method: o.attrs.method || 'execute',
        disabled: xmlBoolean(o.attrs.disabled) === true,
        disabledAttr: xmlBoolean(o.attrs.disabled),
        shared: o.attrs.shared ?? null,
        file: relPath,
        area,
      });
    }
  }
  return out;
}

// ─── PHP class hierarchy ────────────────────────────────────────

function resolvePhpName(name, namespace, uses) {
  const n = name.trim();
  if (!n) return '';
  if (n.startsWith('\\')) return n.slice(1);
  const [first, ...rest] = n.split('\\');
  if (uses.has(first)) return [uses.get(first), ...rest].join('\\');
  return namespace ? `${namespace}\\${n}` : n;
}

/** PHP source without comments; string contents kept (declarations never live in strings). */
function stripPhpComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\'"])\/\/[^\n]*/gm, '$1')
    .replace(/(^|\s)#(?!\[)[^\n]*/gm, '$1');
}

/**
 * Import map of a PHP file: `use A\B;`, `use A\B as C;`, group uses `use A\{B, C as D, E\F};`,
 * several imports per statement. `use function` / `use const` are ignored. Only the code before the
 * first class-like declaration is read, so `use SomeTrait;` inside a class body is not an import.
 */
function parsePhpUses(code) {
  const firstDecl = /(?:^|[\s;{}])(?:(?:final|abstract|readonly)\s+)*(?:class|interface|trait|enum)\s+\w+/i.exec(code);
  const head = firstDecl ? code.slice(0, firstDecl.index) : code;
  const uses = new Map();
  const add = (fq, alias) => {
    const clean = fq.trim().replace(/^\\/, '');
    if (clean) uses.set((alias || clean.split('\\').pop()).trim(), clean);
  };
  const stmtRe = /(?:^|[;{}\s])use\s+(?!function\b|const\b)([^;]+);/gi;
  let m;
  while ((m = stmtRe.exec(head)) !== null) {
    const body = m[1].replace(/\s+/g, ' ').trim();
    const group = /^([\w\\]+)\\\s*\{([^}]*)\}$/.exec(body);
    const items = group ? group[2].split(',').map(x => [group[1], x]) : body.split(',').map(x => ['', x]);
    for (const [prefix, item] of items) {
      const im = /^\s*([\w\\]+)(?:\s+as\s+(\w+))?\s*$/i.exec(item);
      if (im) add(prefix ? `${prefix}\\${im[1]}` : im[1], im[2]);
    }
  }
  return uses;
}

/** Direct parent class and interfaces declared in a PHP source file for `shortName`. */
export function parsePhpDeclaration(source, shortName) {
  const code = stripPhpComments(source);
  const ns = (/^\s*namespace\s+([\w\\]+)\s*[;{]/mi.exec(code) || [])[1] || '';
  const uses = parsePhpUses(code);
  const declRe = new RegExp(`\\b(class|interface|enum)\\s+${shortName}\\b([^{]*)\\{`, 'i');
  const d = declRe.exec(code);
  if (!d) return { namespace: ns, parents: [], interfaces: [] };
  const tail = d[2];
  const kind = d[1].toLowerCase();
  const ext = (/\bextends\s+([\w\\\s,]+?)(?=\bimplements\b|$)/i.exec(tail) || [])[1] || '';
  const impl = (/\bimplements\s+([\w\\\s,]+)$/i.exec(tail.trim()) || [])[1] || '';
  const list = s => s.split(',').map(x => resolvePhpName(x, ns, uses)).filter(Boolean);
  return kind === 'interface'
    ? { namespace: ns, parents: [], interfaces: list(ext) }
    : { namespace: ns, parents: list(ext).slice(0, 1), interfaces: list(impl) };
}

/**
 * Returns `ancestorsOf(fqcn)` → parent classes and interfaces, nearest first, transitive.
 * `findFile(fqcn)` returns the PHP file path or ''.
 */
export function createAncestorResolver(findFile, readFile = p => readFileSync(p, 'utf-8')) {
  const cache = new Map();
  function direct(fqcn) {
    if (cache.has(fqcn)) return cache.get(fqcn);
    cache.set(fqcn, []);
    let result = [];
    try {
      const file = findFile(fqcn);
      if (file) {
        const decl = parsePhpDeclaration(readFile(file), fqcn.split('\\').pop());
        const declaredNs = decl.namespace ? `${decl.namespace}\\${fqcn.split('\\').pop()}` : fqcn;
        if (declaredNs === fqcn) result = [...decl.parents, ...decl.interfaces];
      }
    } catch { /* unreadable file: no ancestors */ }
    cache.set(fqcn, result);
    return result;
  }
  return function ancestorsOf(fqcn) {
    const out = [];
    const seen = new Set([normalizeClassName(fqcn)]);
    const queue = [...direct(normalizeClassName(fqcn))];
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(...direct(next));
    }
    return out;
  };
}

// ─── Modules, load order and the configuration cascade ─────────

/** `<module name="…"><sequence><module name="…"/></sequence></module>` */
export function parseModuleXml(content) {
  const doc = parseXml(content);
  for (const node of walk(doc)) {
    if (node.name !== 'module' || !node.attrs.name) continue;
    const seq = node.children.find(c => c.name === 'sequence');
    return {
      name: node.attrs.name,
      sequence: seq ? seq.children.filter(c => c.name === 'module' && c.attrs.name).map(c => c.attrs.name) : [],
    };
  }
  return null;
}

/** Module list of app/etc/config.php, in file order (= the load order written by setup:upgrade). */
export function parseConfigPhpModules(content) {
  const out = [];
  const block = (/'modules'\s*=>\s*(?:array\s*\(|\[)([\s\S]*?)(?:\)|\])\s*,?\s*(?:'|\]|\)|$)/.exec(content || '') || [])[1] || '';
  const re = /'([A-Za-z0-9]+_[A-Za-z0-9]+)'\s*=>\s*(\d)/g;
  let m;
  while ((m = re.exec(block)) !== null) out.push({ name: m[1], enabled: m[2] === '1' });
  return out;
}

/**
 * Module index: which module a config file belongs to, whether it is enabled, its load order and its
 * declared dependencies (<sequence> — the soft, load-order dependency — and composer `require`).
 *
 * @param moduleXmls   [{ relPath: 'app/code/V/M/etc/module.xml', content }]
 * @param configPhp    content of app/etc/config.php or null
 * @param composerJson (moduleDir) => parsed composer.json or null
 */
export function buildModuleIndex(moduleXmls, configPhp, composerJson = () => null) {
  const modules = new Map();
  for (const { relPath, content } of moduleXmls) {
    let parsed;
    try { parsed = parseModuleXml(content); } catch { parsed = null; }
    if (!parsed || modules.has(parsed.name)) continue;
    const dir = relPath.replace(/\/etc\/module\.xml$/, '');
    let composer = null;
    try { composer = composerJson(dir); } catch { composer = null; }
    modules.set(parsed.name, {
      name: parsed.name, dir, sequence: parsed.sequence, enabled: null, order: null,
      package: composer?.name || null, requires: Object.keys(composer?.require || {}),
    });
  }
  const listed = parseConfigPhpModules(configPhp);
  let orderSource = 'sequence';
  if (listed.length) {
    orderSource = 'config.php';
    listed.forEach((m, i) => {
      const mod = modules.get(m.name);
      if (mod) { mod.enabled = m.enabled; mod.order = i; }
    });
  } else {
    // No config.php: topological order by <sequence>, alphabetical among unrelated modules.
    const names = [...modules.keys()].sort();
    const visited = new Set();
    let i = 0;
    const visit = (n, stack = new Set()) => {
      if (visited.has(n) || stack.has(n)) return;
      stack.add(n);
      for (const dep of modules.get(n)?.sequence || []) if (modules.has(dep)) visit(dep, stack);
      visited.add(n);
      modules.get(n).order = i++;
    };
    names.forEach(n => visit(n));
  }
  const byPackage = new Map([...modules.values()].filter(m => m.package).map(m => [m.package, m.name]));
  const dirs = [...modules.values()].sort((a, b) => b.dir.length - a.dir.length);
  const depCache = new Map();

  function dependsOn(a, b) {
    if (!a || !b || a === b) return false;
    const key = `${a}>${b}`;
    if (depCache.has(key)) return depCache.get(key);
    depCache.set(key, false);
    const seen = new Set();
    const queue = [a];
    let found = false;
    while (queue.length && !found) {
      const cur = modules.get(queue.shift());
      if (!cur || seen.has(cur.name)) continue;
      seen.add(cur.name);
      const next = [...cur.sequence, ...cur.requires.map(r => byPackage.get(r)).filter(Boolean)];
      if (next.includes(b)) found = true;
      queue.push(...next);
    }
    depCache.set(key, found);
    return found;
  }

  return {
    modules,
    orderSource,
    moduleOf(relPath) {
      const hit = dirs.find(m => relPath === m.dir || relPath.startsWith(m.dir + '/'));
      return hit ? hit.name : null;
    },
    isEnabled(name) { return name && modules.has(name) ? modules.get(name).enabled : null; },
    orderOf(name) {
      const o = name && modules.has(name) ? modules.get(name).order : null;
      return o === null || o === undefined ? Number.MAX_SAFE_INTEGER : o;
    },
    dependsOn,
  };
}

/**
 * Order declarations of the same key the way Magento merges them for `area`: global first, then the
 * area; within a scope in module load order. Declarations of disabled modules are set aside.
 * `ambiguous` lists pairs in the same scope whose modules have neither a <sequence> nor a composer
 * dependency on each other — their relative order is incidental and can change with an update.
 */
export function orderDeclarations(decls, idx, area = 'global', conflicts = () => true) {
  const withModule = decls.map(d => ({ ...d, module: d.module ?? idx.moduleOf(d.file) }));
  const disabledModule = withModule.filter(d => idx.isEnabled(d.module) === false);
  const scoped = withModule
    .filter(d => idx.isEnabled(d.module) !== false && (d.area === 'global' || d.area === area))
    .map(d => ({ d, scope: d.area === 'global' ? 0 : 1, order: idx.orderOf(d.module) }))
    .sort((a, b) => a.scope - b.scope || a.order - b.order);
  const ambiguous = [];
  for (let i = 0; i < scoped.length; i++) {
    for (let j = i + 1; j < scoped.length; j++) {
      const a = scoped[i].d;
      const b = scoped[j].d;
      if (scoped[i].scope !== scoped[j].scope || !a.module || !b.module || a.module === b.module) continue;
      if (idx.dependsOn(a.module, b.module) || idx.dependsOn(b.module, a.module)) continue;
      if (conflicts(a, b)) ambiguous.push({ first: a, second: b });
    }
  }
  return { ordered: scoped.map(x => x.d), disabledModule, ambiguous };
}

/**
 * Keep only the ambiguous pairs whose swap would change the outcome: an incidental order matters
 * only when it decides something (the winning preference, the class that runs, enabled/disabled).
 */
function outcomeDependent(ordered, ambiguous, outcome) {
  const base = JSON.stringify(outcome(ordered));
  return ambiguous.filter(({ first, second }) => {
    const i = ordered.indexOf(first);
    const j = ordered.indexOf(second);
    if (i < 0 || j < 0) return false;
    const swapped = [...ordered];
    swapped[i] = second;
    swapped[j] = first;
    return JSON.stringify(outcome(swapped)) !== base;
  });
}

/** Effective preference for `forName` in `area`, with the superseded declarations. */
export function preferenceCascade(model, idx, forName, area = 'global') {
  const decls = model.preferences.filter(p => p.for === normalizeClassName(forName));
  const res = orderDeclarations(decls, idx, area, (a, b) => a.type !== b.type);
  const { ordered, disabledModule } = res;
  const winner = ordered[ordered.length - 1] || null;
  const ambiguous = outcomeDependent(ordered, res.ambiguous, list => list[list.length - 1]?.type ?? null);
  return { winner, superseded: ordered.slice(0, -1), disabledModule, ambiguous };
}

/**
 * Merge declarations of one named plugin (on one type) or one named observer (on one event):
 * attributes of later declarations override earlier ones, absent attributes are kept.
 */
export function mergeNamedDeclarations(decls, idx, area = 'global', instanceKey = 'type') {
  const differs = (a, b) =>
    (a[instanceKey] && b[instanceKey] && a[instanceKey] !== b[instanceKey]) ||
    (a.disabledAttr !== null && b.disabledAttr !== null && a.disabledAttr !== b.disabledAttr) ||
    (a.disabledAttr === null) !== (b.disabledAttr === null);
  const res = orderDeclarations(decls, idx, area, differs);
  const { ordered, disabledModule } = res;
  const fold = list => {
    let inst = null;
    let dis = false;
    for (const d of list) {
      if (d[instanceKey]) inst = d[instanceKey];
      if (d.disabledAttr !== null && d.disabledAttr !== undefined) dis = d.disabledAttr;
    }
    return { inst, dis };
  };
  // Order-dependent only if it decides what runs: a disabled result stays "does not run" either way.
  const ambiguous = outcomeDependent(ordered, res.ambiguous, list => {
    const r = fold(list);
    return r.dis ? 'disabled' : r.inst;
  });
  let instance = null;
  let instanceFrom = null;
  let disabled = false;
  let disabledBy = null;
  let sortOrder = null;
  for (const d of ordered) {
    if (d[instanceKey]) { instance = d[instanceKey]; instanceFrom = d; }
    if (d.disabledAttr !== null && d.disabledAttr !== undefined) { disabled = d.disabledAttr; disabledBy = d.disabledAttr ? d : null; }
    if (d.sortOrder !== null && d.sortOrder !== undefined) sortOrder = d.sortOrder;
  }
  return { instance, instanceFrom, disabled, disabledBy, sortOrder, ordered, disabledModule, ambiguous };
}

// ─── Interceptability ───────────────────────────────────────────

export const NONINTERCEPTABLE_INTERFACE = 'Magento\\Framework\\ObjectManager\\NoninterceptableInterface';
// Mirrors Magento\Framework\Interception\Code\Generator\Interceptor::isInterceptedMethod()
const NOT_INTERCEPTED_METHODS = ['__construct', '__destruct', '__sleep', '__wakeup', '__clone', '_resetState'];

/** Class modifiers and method signatures (visibility, static, final) of `shortName` in a PHP file. */
export function parsePhpMembers(source, shortName) {
  const code = stripPhpComments(source);
  const decl = new RegExp(`((?:\\b(?:final|abstract|readonly)\\s+)*)\\b(class|interface|trait|enum)\\s+${shortName}\\b`, 'i').exec(code);
  if (!decl) return null;
  const methods = new Map();
  const re = /((?:\b(?:final|abstract|public|protected|private|static)\s+)*)function\s+&?\s*(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(code.slice(decl.index))) !== null) {
    const mods = m[1];
    methods.set(m[2].toLowerCase(), {
      name: m[2],
      visibility: /\bprivate\b/.test(mods) ? 'private' : /\bprotected\b/.test(mods) ? 'protected' : 'public',
      isStatic: /\bstatic\b/.test(mods),
      isFinal: /\bfinal\b/.test(mods),
    });
  }
  return { kind: decl[2].toLowerCase(), isFinal: /\bfinal\b/i.test(decl[1]), isAbstract: /\babstract\b/i.test(decl[1]), methods };
}

/** `membersOf(fqcn)` → parsePhpMembers result, or null when the file cannot be found or read. */
export function createMemberResolver(findFile, readFile = p => readFileSync(p, 'utf-8')) {
  const cache = new Map();
  return function membersOf(fqcn) {
    const n = normalizeClassName(fqcn);
    if (cache.has(n)) return cache.get(n);
    let info = null;
    try {
      const file = findFile(n);
      if (file) info = parsePhpMembers(readFile(file), n.split('\\').pop());
    } catch { info = null; }
    cache.set(n, info);
    return info;
  };
}

/**
 * Whether plugins on `className` (and on `methodName`, when given) can run.
 * Returns { interceptable: true } / { interceptable: false, reason } / { interceptable: null } (unknown).
 */
export function interceptionStatus(className, methodName, ancestorsOf, membersOf) {
  const n = normalizeClassName(className);
  const own = membersOf(n);
  if (!own) return { interceptable: null };
  const ancestors = ancestorsOf(n);
  if (n === NONINTERCEPTABLE_INTERFACE || ancestors.includes(NONINTERCEPTABLE_INTERFACE)) {
    return { interceptable: false, reason: `implements \`${NONINTERCEPTABLE_INTERFACE}\` — no interceptor is generated` };
  }
  if (own.kind === 'class' && own.isFinal) {
    return { interceptable: false, reason: 'the class is final — it cannot be intercepted' };
  }
  if (!methodName) return { interceptable: true };
  const key = methodName.toLowerCase();
  let unknown = false;
  for (const type of [n, ...ancestors]) {
    const info = type === n ? own : membersOf(type);
    if (!info) { unknown = true; continue; }
    const method = info.methods.get(key);
    if (!method) continue;
    if (NOT_INTERCEPTED_METHODS.includes(method.name) || NOT_INTERCEPTED_METHODS.map(x => x.toLowerCase()).includes(key)) {
      return { interceptable: false, reason: `\`${method.name}()\` is never intercepted` };
    }
    if (method.visibility !== 'public') return { interceptable: false, reason: `\`${method.name}()\` is ${method.visibility} — only public methods are intercepted` };
    if (method.isStatic) return { interceptable: false, reason: `\`${method.name}()\` is static — not intercepted` };
    if (method.isFinal) return { interceptable: false, reason: `\`${method.name}()\` is final — not intercepted` };
    return { interceptable: true };
  }
  if (unknown) return { interceptable: null };
  return { interceptable: false, reason: `no \`${methodName}()\` method on the class or its parents — the plugin method never runs (magic __call methods are not intercepted)` };
}

// ─── Reverse class hierarchy (instanceof) ───────────────────────

/** All class / interface declarations in a PHP file with their resolved parents and interfaces. */
export function parsePhpTypes(source) {
  const code = stripPhpComments(source);
  const ns = (/^\s*namespace\s+([\w\\]+)\s*[;{]/mi.exec(code) || [])[1] || '';
  const uses = parsePhpUses(code);
  const out = [];
  const declRe = /(?:^|[\s;{}])((?:(?:final|abstract|readonly)\s+)*)(class|interface|enum)\s+(\w+)([^{;]*)\{/gi;
  let d;
  while ((d = declRe.exec(code)) !== null) {
    const kind = d[2].toLowerCase();
    // enum Name: string implements X — drop the backing type before reading the lists
    const tail = kind === 'enum' ? d[4].replace(/^\s*:\s*\w+/, '') : d[4];
    const ext = (/\bextends\s+([\w\\\s,]+?)(?=\bimplements\b|$)/i.exec(tail) || [])[1] || '';
    const impl = (/\bimplements\s+([\w\\\s,]+)$/i.exec(tail.trim()) || [])[1] || '';
    const list = s => s.split(',').map(x => resolvePhpName(x, ns, uses)).filter(Boolean);
    const fqcn = ns ? `${ns}\\${d[3]}` : d[3];
    if (kind === 'interface') out.push({ fqcn, kind: 'interface', parents: [], interfaces: list(ext) });
    else if (kind === 'enum') out.push({ fqcn, kind: 'enum', parents: [], interfaces: list(impl) });
    else out.push({ fqcn, kind: /\babstract\b/i.test(d[1]) ? 'abstract class' : 'class', parents: list(ext).slice(0, 1), interfaces: list(impl) });
  }
  return out;
}

/** Build { types: Map fqcn → decl+file, children: Map fqcn → [{ child, relation }] }. */
export function buildClassHierarchy(entries) {
  const types = new Map();
  const children = new Map();
  const add = (parent, child, relation) => {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push({ child, relation });
  };
  for (const { relPath, source } of entries) {
    let decls;
    try { decls = parsePhpTypes(source); } catch { continue; }
    for (const t of decls) {
      if (types.has(t.fqcn)) continue;
      types.set(t.fqcn, { ...t, file: relPath });
      for (const p of t.parents) add(p, t.fqcn, 'extends');
      for (const i of t.interfaces) add(i, t.fqcn, t.kind === 'interface' ? 'extends' : 'implements');
    }
  }
  return { types, children };
}

/**
 * Everything that is `instanceof` `fqcn`: implementors, extending interfaces, their implementors
 * and all subclasses, transitively. Each entry carries the path from `fqcn`.
 */
export function instancesOf(hierarchy, fqcn) {
  const root = normalizeClassName(fqcn);
  const out = [];
  const seen = new Set([root]);
  const queue = [{ name: root, path: [root] }];
  while (queue.length) {
    const { name, path } = queue.shift();
    for (const { child, relation } of hierarchy.children.get(name) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      const decl = hierarchy.types.get(child);
      const childPath = [...path, child];
      out.push({ fqcn: child, kind: decl?.kind || 'class', file: decl?.file || null, relation, via: name, depth: path.length, path: childPath });
      queue.push({ name: child, path: childPath });
    }
  }
  return out;
}
