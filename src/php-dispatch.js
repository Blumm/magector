/**
 * Where a Magento event is dispatched — including names built at runtime from a property or a class
 * constant of the class that runs the code (`$this->_eventPrefix . '_save_after'` in
 * Model\AbstractModel, with the prefix declared by Catalog\Model\Product four levels below).
 *
 * The facts come from the PHP files (extractPhpFacts, per file); a dispatch site is resolved for every
 * concrete class that runs it (resolveDispatchSite), walking each class's inheritance chain level by
 * level: the class, its traits, its parent, … A level whose file is not found ends the walk, and what
 * it could have declared becomes a wildcard — a layer is never skipped silently. Names that are only
 * known at runtime (a request value, a function call) keep their known parts: `layout_render_before_*`.
 */

import { scanPhp, parsePhpFile, qualifyPhpName, normalizeClassName } from './di-config.js';

/** Marks the part of a name that is only known at runtime. */
export const WILD = '\u0001';
/**
 * Marks a value that holds only after an ordinary method ran (`$this->_eventPrefix = 'b'` in `useB()`):
 * a possible name, not an exact one. Kept in the string like WILD, so it survives concatenation.
 */
export const COND = '\u0002';
/** The name without the COND marks. */
export const plainName = value => value.split(COND).join('');

// ─── Scanning helpers (strings kept, comments blanked; offsets as in the source) ───────────

/** Index of the character after the expression starting at `i`: the first `stops` char at depth 0. */
function expressionEnd(text, i, stops) {
  let depth = 0;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (c === "'" || c === '"') { k = stringEnd(text, k) - 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return k;
      depth--;
    } else if (depth === 0 && stops.includes(c)) return k;
  }
  return text.length;
}

/** Index after the string literal that starts at `i` (quote at text[i]). */
function stringEnd(text, i) {
  const q = text[i];
  for (let k = i + 1; k < text.length; k++) {
    if (text[k] === '\\') { k++; continue; }
    if (text[k] === q) return k + 1;
  }
  return text.length;
}

/** Positions of a top-level operator in an expression (outside strings and brackets). */
function topLevelSplit(expr, isOperatorAt) {
  const parts = [];
  let depth = 0, from = 0;
  for (let k = 0; k < expr.length; k++) {
    const c = expr[k];
    if (c === "'" || c === '"') { k = stringEnd(expr, k) - 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) {
      const len = isOperatorAt(expr, k);
      if (len) { parts.push(expr.slice(from, k)); from = k + len; k += len - 1; }
    }
  }
  parts.push(expr.slice(from));
  return parts;
}

const unescapeSingle = s => s.replace(/\\(['\\])/g, '$1');
const unescapeDouble = s => s.replace(/\\(["\\$])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t');

// ─── Expressions → AST ──────────────────────────────────────────

/**
 * The parts of an event-name expression: lit, prop ($this->x), sprop (self|static::$x),
 * const (Ref::X, optionally indexed), local ($x), union (a ?? b, c ? a : b), concat (a . b), null,
 * unknown (anything else — a call, a request value).
 */
export function parseNameExpr(raw) {
  let e = String(raw || '').trim();
  while (e.startsWith('(') && expressionEnd(e, 1, '') === e.length - 1) e = e.slice(1, -1).trim();
  if (!e) return { t: 'unknown', text: '' };
  const coalesce = topLevelSplit(e, (s, k) => (s[k] === '?' && s[k + 1] === '?' && s[k + 2] !== '=' ? 2 : 0));
  if (coalesce.length > 1) return { t: 'union', options: coalesce.map(parseNameExpr) };
  const ternaryQ = topLevelSplit(e, (s, k) => (s[k] === '?' && s[k + 1] !== '?' && s[k - 1] !== '?' && s[k + 1] !== '-' ? 1 : 0));
  if (ternaryQ.length === 2) {
    const branches = topLevelSplit(ternaryQ[1], (s, k) => (s[k] === ':' && s[k + 1] !== ':' && s[k - 1] !== ':' ? 1 : 0));
    if (branches.length === 2) return { t: 'union', options: [parseNameExpr(branches[0] || ternaryQ[0]), parseNameExpr(branches[1])] };
  }
  const concat = topLevelSplit(e, (s, k) => (s[k] === '.' && s[k + 1] !== '.' && s[k - 1] !== '.' && s[k + 1] !== '=' &&
    !(/\d/.test(s[k - 1] || '') && /\d/.test(s[k + 1] || '')) ? 1 : 0));
  if (concat.length > 1) return { t: 'concat', parts: concat.map(parseNameExpr) };
  let m;
  if ((m = /^'((?:[^'\\]|\\.)*)'$/s.exec(e))) return { t: 'lit', value: unescapeSingle(m[1]) };
  if ((m = /^"((?:[^"\\]|\\.)*)"$/s.exec(e))) return interpolated(m[1]);
  if (/^null$/i.test(e)) return { t: 'null' };
  if ((m = /^\$this->(\w+)$/.exec(e))) return { t: 'prop', name: m[1] };
  if ((m = /^(self|static)::\$(\w+)$/i.exec(e))) return { t: 'sprop', scope: m[1].toLowerCase(), name: m[2] };
  if ((m = /^(self|static|parent|\\?[A-Za-z_][\w\\]*)::([A-Za-z_]\w*)\s*(\[.*\])?$/s.exec(e))) {
    if (m[2].toLowerCase() === 'class') return { t: 'classname', ref: m[1] };
    return { t: 'const', ref: m[1], name: m[2], indexed: Boolean(m[3]) };
  }
  if ((m = /^\$(\w+)$/.exec(e))) return { t: 'local', name: m[1] };
  // sprintf('fmt_%s', …) and strtolower(…): the parts that are known stay known
  if ((m = /^\\?(sprintf|strtolower|mb_strtolower)\s*\(/i.exec(e)) && expressionEnd(e, m[0].length, '') === e.length - 1) {
    const args = topLevelSplit(e.slice(m[0].length, -1), (s, k) => (s[k] === ',' ? 1 : 0)).map(parseNameExpr);
    return m[1].toLowerCase() === 'sprintf' ? { t: 'sprintf', args } : { t: 'lower', arg: args[0] || { t: 'unknown', text: e } };
  }
  return { t: 'unknown', text: e };
}

/** "a_{$this->x}_b" / "a_$x" → concat of literals and the interpolated parts. */
function interpolated(body) {
  if (!/\$/.test(body.replace(/\\\$/g, ''))) return { t: 'lit', value: unescapeDouble(body) };
  const parts = [];
  const re = /\{(\$[^}]+)\}|\$(\w+(?:->\w+)?)/g;
  let last = 0, m;
  while ((m = re.exec(body)) !== null) {
    if (body[m.index - 1] === '\\') continue;
    if (m.index > last) parts.push({ t: 'lit', value: unescapeDouble(body.slice(last, m.index)) });
    parts.push(parseNameExpr(m[1] || `$${m[2]}`));
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ t: 'lit', value: unescapeDouble(body.slice(last)) });
  return { t: 'concat', parts };
}

/** Whether the value depends on the class that runs the code ($this->x, static::). */
export function dependsOnCalledClass(ast) {
  switch (ast.t) {
    case 'prop': return true;
    case 'sprop': return ast.scope === 'static';
    case 'const': return ast.ref.toLowerCase() === 'static';
    case 'concat': return ast.parts.some(dependsOnCalledClass);
    case 'union': return ast.options.some(dependsOnCalledClass);
    case 'sprintf': return ast.args.some(dependsOnCalledClass);
    case 'lower': return dependsOnCalledClass(ast.arg);
    default: return false;
  }
}

/** Whether the value depends on the class that wrote the code (self:: / parent::) — in a trait, the class using it. */
function refersToLexicalClass(ast) {
  switch (ast.t) {
    case 'const': return ['self', 'parent'].includes(ast.ref.toLowerCase());
    case 'sprop': return ast.scope === 'self';
    case 'classname': return ast.ref.toLowerCase() === 'self';
    case 'concat': return ast.parts.some(refersToLexicalClass);
    case 'union': return ast.options.some(refersToLexicalClass);
    case 'sprintf': return ast.args.some(refersToLexicalClass);
    case 'lower': return refersToLexicalClass(ast.arg);
    default: return false;
  }
}

/** True when the expression has a part that stays unknown whatever class runs it. */
function hasRuntimePart(ast) {
  switch (ast.t) {
    case 'unknown': return true;
    case 'concat': return ast.parts.some(hasRuntimePart);
    case 'union': return ast.options.some(hasRuntimePart);
    case 'sprintf': return ast.args.some(hasRuntimePart);
    case 'lower': return hasRuntimePart(ast.arg);
    default: return false;
  }
}

// ─── Facts of a PHP file ────────────────────────────────────────

const EVENT_MANAGER_RECEIVER = /eventmanager/i;
const MEMBER_MODS = '(?:(?:public|protected|private|var|static|readonly|final)\\s+)+';

/**
 * Per type: kind, parent, interfaces, traits, the `use` imports, property defaults, constants,
 * assignments to properties, methods (with their parameters and whether they call parent::);
 * and every `->dispatch(` with its receiver, argument, method and line.
 */
export function extractPhpFacts(source) {
  const src = String(source || '');
  const parsed = parsePhpFile(src).types;
  const code = scanPhp(src);                              // strings and comments blanked
  const text = scanPhp(src, { keepStrings: true });       // comments blanked, strings kept
  const n = code.length;
  const depthAt = new Int32Array(n + 1);
  let depth = 0;
  for (let k = 0; k < n; k++) {
    depthAt[k] = depth;
    if (code[k] === '{') depth++;
    else if (code[k] === '}') depth = Math.max(0, depth - 1);
  }
  depthAt[n] = depth;
  const lineStarts = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === '\n') lineStarts.push(k + 1);
  const lineAt = off => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };
  const closeOf = open => { const d = depthAt[open] + 1; for (let k = open + 1; k < n; k++) if (code[k] === '}' && depthAt[k] === d) return k; return n; };

  const types = [];
  const used = new Set();
  const declRe = /(?<![\w$\\>:])((?:(?:final|abstract|readonly)\s+)*)(class|interface|trait|enum)\s+([A-Za-z_]\w*)([^{;]*)\{/gi;
  let m;
  while ((m = declRe.exec(code)) !== null) {
    const idx = parsed.findIndex((t, k) => !used.has(k) && t.shortName === m[3]);
    if (idx < 0) continue;
    used.add(idx);
    const t = parsed[idx];
    const open = m.index + m[0].length - 1;
    const close = closeOf(open);
    const bodyDepth = depthAt[open] + 1;
    const atBody = k => depthAt[k] === bodyDepth;
    const rec = {
      fqcn: t.fqcn, kind: t.kind, isAbstract: t.isAbstract, namespace: t.namespace, uses: t.uses,
      parent: t.parents[0] || null, interfaces: t.interfaces, traits: t.traits,
      bodyStart: open, bodyEnd: close, line: lineAt(m.index),
      props: new Map(), consts: new Map(), assigns: new Map(), methods: new Map(),
      source: text,                          // for parent:: checks in method bodies (offsets as in the file)
    };
    const body = text.slice(open + 1, close);
    const at = k => open + 1 + k;
    // methods: name, parameters, body range
    const fnRe = /((?:\b(?:final|abstract|public|protected|private|static)\s+)*)function\s+&?\s*([A-Za-z_]\w*)\s*\(/gi;
    let f;
    while ((f = fnRe.exec(body)) !== null) {
      if (!atBody(at(f.index + f[1].length))) continue;
      const paramsOpen = at(f.index + f[0].length);
      const paramsClose = expressionEnd(text, paramsOpen, '');
      // parameters, and the default of each that has one (`$eventPrefix = 'x'`)
      const params = [], defaults = new Map();
      for (const p of topLevelSplit(text.slice(paramsOpen, paramsClose), (s, k) => (s[k] === ',' ? 1 : 0))) {
        const pm = /\$(\w+)\s*(?:=\s*([\s\S]*\S))?\s*$/.exec(p);
        if (!pm) continue;
        params.push(pm[1]);
        if (pm[2] !== undefined) defaults.set(pm[1], pm[2]);
      }
      let k = paramsClose + 1;
      while (k < close && code[k] !== '{' && code[k] !== ';') k++;
      const hasBody = code[k] === '{';       // an abstract or interface method has none
      const method = { name: f[2], params, defaults, hasBody, bodyStart: k, bodyEnd: hasBody ? closeOf(k) : k, line: lineAt(at(f.index)) };
      if (!rec.methods.has(f[2].toLowerCase())) rec.methods.set(f[2].toLowerCase(), method);
    }
    const methodAt = off => [...rec.methods.values()].find(mt => off > mt.bodyStart && off < mt.bodyEnd) || null;
    // property defaults (at the class body's depth)
    const propRe = new RegExp(`(?<![\\w$])${MEMBER_MODS}(?:\\??[\\w\\\\|]+\\s+)?\\$(\\w+)\\s*(=|;|,)`, 'g');
    while ((f = propRe.exec(body)) !== null) {
      if (!atBody(at(f.index)) || methodAt(at(f.index))) continue;
      const isStatic = /\bstatic\b/i.test(f[0]);
      if (f[2] === '=') {
        const start = at(f.index + f[0].length);
        const end = expressionEnd(text, start, ';,');
        rec.props.set(f[1], { expr: text.slice(start, end).trim(), line: lineAt(at(f.index)), isStatic });
      } else {
        rec.props.set(f[1], { expr: 'null', line: lineAt(at(f.index)), isStatic });
      }
    }
    // constants (several per statement: const A = 'x', B = 'y';)
    const constRe = /(?<![\w$])(?:(?:public|protected|private|final)\s+)*const\s+(?:[\w\\|?]+\s+)?([A-Za-z_]\w*)\s*=/g;
    while ((f = constRe.exec(body)) !== null) {
      if (!atBody(at(f.index))) continue;
      let start = at(f.index + f[0].length);
      let name = f[1];
      for (;;) {
        const end = expressionEnd(text, start, ';,');
        rec.consts.set(name, { expr: text.slice(start, end).trim(), line: lineAt(start) });
        if (text[end] !== ',') break;
        const next = /^\s*([A-Za-z_]\w*)\s*=/.exec(text.slice(end + 1));
        if (!next) break;
        name = next[1];
        start = end + 1 + next[0].length;
      }
    }
    // assignments to properties inside methods
    const asgRe = /(?:\$this->(\w+)|(?:self|static)::\$(\w+))\s*=(?![=>])/g;
    while ((f = asgRe.exec(body)) !== null) {
      const off = at(f.index);
      const mt = methodAt(off);
      if (!mt) continue;
      const start = at(f.index + f[0].length);
      const end = expressionEnd(text, start, ';');
      const name = f[1] || f[2];
      if (!rec.assigns.has(name)) rec.assigns.set(name, []);
      rec.assigns.get(name).push({ method: mt.name, expr: text.slice(start, end).trim(), line: lineAt(off) });
    }
    types.push(rec);
  }

  const typeAt = off => types.filter(t => off > t.bodyStart && off < t.bodyEnd).sort((a, b) => b.bodyStart - a.bodyStart)[0] || null;
  const dispatches = [];
  const dRe = /->\s*dispatch\s*\(/g;
  while ((m = dRe.exec(code)) !== null) {
    const before = code.slice(Math.max(0, m.index - 120), m.index);
    const recv = (/([$\w\\]+(?:\s*(?:->|::)\s*\w+(?:\s*\([^()]*\))?)*)\s*$/.exec(before) || [])[1] || '';
    const argStart = m.index + m[0].length;
    const argEnd = expressionEnd(text, argStart, ',');
    const arg = text.slice(argStart, argEnd).trim();
    if (!arg) continue;
    const type = typeAt(m.index);
    const method = type ? [...type.methods.values()].find(mt => m.index > mt.bodyStart && m.index < mt.bodyEnd) || null : null;
    dispatches.push({
      type: type ? type.fqcn : null,
      method: method ? method.name : null,
      line: lineAt(m.index),
      offset: m.index,                       // identifies the site: one line can hold two
      receiver: recv.replace(/\s+/g, ''),
      eventManager: EVENT_MANAGER_RECEIVER.test(recv),
      arg,
      // the method body before the call, for local variables assigned there
      before: method ? text.slice(method.bodyStart + 1, m.index) : '',
    });
  }
  return { types, dispatches };
}

// ─── Resolution ─────────────────────────────────────────────────

const MAX_COMBINATIONS = 64;

/**
 * The resolver walks inheritance through `typeOf(fqcn)` (the facts of the type's file, or null when
 * the file is not found) and reads constructor arguments of `di.xml` through
 * `diStringArgs(owner, argumentName)` → [{ value, area, file, owner }] (owner: type or virtual type,
 * already following Magento's argument inheritance).
 */
export function createDispatchResolver({ typeOf, diStringArgs = () => [] }) {
  const type = fqcn => (fqcn ? typeOf(normalizeClassName(fqcn)) : null);

  /** [class, its traits (nested, in use order), parent, its traits, …]; broken: the first level not found. */
  function levels(fqcn) {
    const out = [];
    const seen = new Set();
    let name = normalizeClassName(fqcn);
    let broken = null;
    while (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      const rec = type(name);
      if (!rec) { broken = name; break; }
      out.push({ rec, via: rec });
      const addTraits = (r, user) => {
        for (const tn of r.traits || []) {
          const tr = type(tn);
          if (!tr) { broken = broken || tn; continue; }
          out.push({ rec: tr, via: user });
          addTraits(tr, user);
        }
      };
      addTraits(rec, rec);
      name = rec.parent;
    }
    return { levels: out, broken };
  }

  /** The class chain only (no traits): [K, parent, …]. */
  function classChain(fqcn) {
    return levels(fqcn).levels.filter(l => l.rec === l.via).map(l => l.rec);
  }

  /** Interfaces of a class chain, with the interfaces they extend. */
  function interfacesOf(fqcn) {
    const out = [];
    const seen = new Set();
    const visit = name => {
      const k = normalizeClassName(name).toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      const rec = type(name);
      if (!rec) return;
      out.push(rec);
      for (const i of rec.interfaces || []) visit(i);
    };
    for (const c of classChain(fqcn)) for (const i of c.interfaces || []) visit(i);
    return out;
  }

  function product(sets) {
    let acc = [''];
    for (const set of sets) {
      const next = [];
      for (const a of acc) for (const b of set) next.push(a + b);
      if (next.length > MAX_COMBINATIONS) return [WILD];
      acc = next;
    }
    return acc;
  }

  /**
   * Values of an expression. ctx: { self (class `self::` means), called (class that runs the code, or
   * null), lexical (type whose file wrote the code: imports), before (method text before the use),
   * params, visiting, notes }.
   */
  function evaluate(ast, ctx) {
    switch (ast.t) {
      case 'lit': return [ast.value];
      case 'null': return [];
      case 'classname': return [ast.ref.toLowerCase() === 'self' ? ctx.self?.fqcn || WILD : qualifyPhpName(ast.ref, ctx.lexical)];
      case 'union': return [...new Set(ast.options.flatMap(o => evaluate(o, ctx)))];
      case 'concat': {
        const sets = ast.parts.map(p => evaluate(p, ctx));
        if (sets.some(s => !s.length)) return [];
        return product(sets);
      }
      case 'prop': return ctx.called ? propValues(ctx.called, ast.name, ctx) : unknown(ctx, `$this->${ast.name}`);
      case 'sprop': {
        const owner = ast.scope === 'static' ? ctx.called : ctx.self;
        return owner ? propValues(owner, ast.name, ctx) : unknown(ctx, `${ast.scope}::$${ast.name}`);
      }
      case 'const': return constValues(ast, ctx);
      case 'local': return localValues(ast.name, ctx);
      case 'lower': return evaluate(ast.arg, ctx).map(v => v.toLowerCase());
      case 'sprintf': {
        const [format, ...args] = ast.args;
        if (!format) return unknown(ctx, 'sprintf()');
        const out = [];
        for (const f of evaluate(format, ctx)) {
          // %s / %d in order take the arguments; %1$s and other specifiers stay unknown
          const pieces = f.split(/(%(?:\d+\$)?[-+ 0'#]*\d*(?:\.\d+)?[bcdeEfFgGosuxX%])/);
          const sets = [];
          let next = 0;
          for (const piece of pieces) {
            if (piece === '%%') sets.push(['%']);
            else if (/^%[bcdeEfFgGosuxX]$/.test(piece)) sets.push(args[next] ? evaluate(args[next++], ctx) : [WILD]);
            else if (piece.startsWith('%') && piece.length > 1 && f.includes(piece)) sets.push([WILD]);
            else sets.push([piece]);
          }
          out.push(...product(sets));
        }
        return [...new Set(out)];
      }
      default: return unknown(ctx, ast.text);
    }
  }

  function unknown(ctx, what) {
    ctx.notes.push({ kind: 'runtime', what });
    return [WILD];
  }

  /**
   * `$name` in the method before the call: every assignment there (a branch or a loop: all of them),
   * and `.=` appends to what it held — maybe in a branch, so the value without the suffix stays too.
   */
  function localValues(name, ctx) {
    const re = new RegExp(`\\$${name}\\s*(\\.?)=(?![=>])`, 'g');
    const unset = () => unknown(ctx, (ctx.params || []).includes(name) ? `parameter $${name}` : `$${name}`);
    let values = null;
    let m;
    while ((m = re.exec(ctx.before || '')) !== null) {
      const start = m.index + m[0].length;
      const end = expressionEnd(ctx.before, start, ';');
      const assigned = evaluate(parseNameExpr(ctx.before.slice(start, end)), ctx);
      if (m[1] === '.') {
        const base = values || unset();
        values = [...new Set([...base, ...product([base, assigned])])];
      } else {
        values = [...new Set([...(values || []), ...assigned])];
      }
    }
    return values || unset();
  }

  /** The class a `self` / `static` / `parent` / named reference means in this context. */
  function refClass(ref, ctx) {
    const r = ref.toLowerCase();
    if (r === 'self') return ctx.self?.fqcn || null;
    if (r === 'static') return (ctx.called || ctx.self)?.fqcn || null;
    if (r === 'parent') return ctx.self?.parent || null;
    return qualifyPhpName(ref, ctx.lexical);
  }

  function constValues(ast, ctx) {
    if (ctx.shape && ast.ref.toLowerCase() === 'static') return [WILD];
    const cls = refClass(ast.ref, ctx);
    if (!cls) return unknown(ctx, `${ast.ref}::${ast.name}`);
    const key = `${cls.toLowerCase()}::${ast.name}`;
    if (ctx.visiting.has(key)) return unknown(ctx, `${ast.ref}::${ast.name} (cycle)`);
    const { levels: lv, broken } = levels(cls);
    const owners = [...lv, ...interfacesOf(cls).map(rec => ({ rec, via: rec }))];
    const hit = owners.find(o => o.rec.consts.has(ast.name));
    if (!hit) return unknown(ctx, `${ast.ref}::${ast.name}${broken ? ` (inheritance broken at ${broken})` : ''}`);
    const decl = hit.rec.consts.get(ast.name);
    ctx.visiting.add(key);
    const sub = { ...ctx, self: hit.via, called: null, lexical: hit.rec, before: '', params: [] };
    let values;
    if (ast.indexed) {
      values = [...decl.expr.matchAll(/=>\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[\w\\:]+)/g)].flatMap(v => evaluate(parseNameExpr(v[1]), sub));
      if (!values.length) values = unknown(ctx, `${ast.ref}::${ast.name}[…]`);
    } else {
      values = evaluate(parseNameExpr(decl.expr), sub);
    }
    ctx.visiting.delete(key);
    ctx.notes.push({ kind: 'const', name: `${hit.rec.fqcn}::${ast.name}`, rec: hit.rec, line: decl.line, lookedUpIn: cls, constName: ast.name, values });
    return values;
  }

  /**
   * `$this->name` for class K: the nearest declaration from K up (K, its traits, its parent, …), plus
   * every assignment in that chain — a constructor parameter assigned to it takes the `di.xml`
   * argument of K (or of the virtual type), and then the declared default no longer applies when that
   * constructor runs for K.
   */
  function propValues(called, name, ctx) {
    const K = called;
    const { levels: lv, broken } = levels(K.fqcn);
    const declIdx = lv.findIndex(l => l.rec.props.has(name));
    const values = [];
    let fromConstructor = false;
    for (const l of lv) {
      for (const a of l.rec.assigns.get(name) || []) {
        const method = l.rec.methods.get(a.method.toLowerCase());
        const param = /^\$(\w+)$/.exec(a.expr);
        if (param && method && method.params.includes(param[1]) && a.method.toLowerCase() === '__construct') {
          const di = diStringArgs(ctx.diOwner || K.fqcn, param[1]);
          // ObjectManager passes the di.xml argument; an area where di.xml sets none gets the default
          const defaultExpr = method.defaults?.get(param[1]);
          const byDefault = areasWithArgument => {
            const v = evaluate(parseNameExpr(defaultExpr), { ...ctx, self: l.via, lexical: l.rec, before: '', params: [] });
            values.push(...v);
            ctx.notes.push({ kind: 'default', name, argument: param[1], expr: defaultExpr, values: v, rec: l.rec, line: method.line, outside: areasWithArgument });
          };
          if (di.length) {
            for (const d of di) values.push(d.value);
            ctx.notes.push({ kind: 'di', name, argument: param[1], di, rec: l.rec });
            if (defaultExpr !== undefined && !di.some(d => d.area === 'global')) byDefault(di.map(d => d.area));
          } else if (defaultExpr !== undefined) {
            byDefault(null);
          } else {
            values.push(...unknown(ctx, `$${param[1]} (constructor of ${l.via.fqcn})`));
          }
          // the constructor assigns the parameter whatever it holds: the declared default no longer applies
          if (constructorRuns(K, l.via)) fromConstructor = true;
        } else {
          const v = evaluate(parseNameExpr(a.expr), { ...ctx, self: l.via, lexical: l.rec, before: '', params: method?.params || [] });
          // the constructor always runs; any other method only if something called it before the dispatch
          const conditional = a.method.toLowerCase() !== '__construct';
          values.push(...(conditional ? v.map(x => COND + x) : v));
          ctx.notes.push({ kind: 'assigned', name, rec: l.rec, method: a.method, line: a.line, values: v, conditional });
        }
      }
    }
    if (!fromConstructor) {
      if (declIdx >= 0) {
        const { rec, via } = lv[declIdx];
        const decl = rec.props.get(name);
        const declared = evaluate(parseNameExpr(decl.expr), { ...ctx, self: via, lexical: rec, before: '', params: [] });
        values.push(...declared);
        ctx.notes.push({ kind: 'prop', name, rec, line: decl.line, values: declared, ofClass: K.fqcn });
      } else {
        values.push(...unknown(ctx, `$this->${name}${broken ? ` (inheritance broken at ${broken})` : ' (not declared)'}`));
      }
    }
    return [...new Set(values)];
  }

  /** Whether the constructor declared in `owner` runs for K: every override between calls parent::__construct. */
  function constructorRuns(K, owner) {
    for (const c of classChain(K.fqcn)) {
      if (c === owner) return true;
      const ctor = c.methods.get('__construct');
      if (ctor && !callsParent(c, ctor, '__construct')) return false;
    }
    return false;
  }

  /** The source of a method's body calls parent::<name>(. */
  function callsParent(rec, method, name) {
    return rec.source ? new RegExp(`parent::${name}\\s*\\(`, 'i').test(rec.source.slice(method.bodyStart, method.bodyEnd)) : true;
  }

  /**
   * A dispatch site resolved for every class that runs it: [{ forClass, path (classes from the site's
   * class down to it), values, notes, mayNotRun }]. `concrete(L)` lists the concrete subclasses of L
   * (and, for a trait, the classes that use it) with their path; `virtualTypesOf(K)` the virtual
   * types over K (their di.xml arguments differ).
   */
  function resolveSite(site, { concrete, virtualTypesOf = () => [] }) {
    const ast = parseNameExpr(site.arg);
    const L = site.type ? type(site.type) : null;
    const method = L && site.method ? L.methods.get(site.method.toLowerCase()) : null;
    const base = { lexical: L, self: L, before: site.before || '', params: method?.params || [], visiting: new Set() };
    // a name that depends on the class running the code, or a trait's self:: (the class using it): per class
    const perClass = L && (dependsOnCalledClass(ast) || (L.kind === 'trait' && refersToLexicalClass(ast)));
    if (!perClass) {
      const notes = [];
      const values = evaluate(ast, { ...base, called: L && L.kind === 'class' && !L.isAbstract ? L : null, notes });
      return [{ forClass: L && L.kind === 'class' ? L.fqcn : null, path: L ? [L.fqcn] : [], values, notes, mayNotRun: null, runtime: hasRuntimePart(ast) }];
    }
    const out = [];
    for (const { fqcn, path } of concrete(L)) {
      const K = type(fqcn);
      if (!K) continue;
      const selfCls = L.kind === 'trait' ? type(path[1] || fqcn) || K : L;
      const override = site.method ? overriddenWithoutParent(path, site.method, L) : null;
      for (const owner of [null, ...virtualTypesOf(fqcn)]) {
        const notes = [];
        const values = evaluate(ast, { ...base, self: selfCls, called: K, diOwner: owner?.name || null, notes });
        out.push({
          forClass: owner ? owner.name : fqcn, virtualTypeOf: owner ? fqcn : null, path, values, notes,
          mayNotRun: override?.cls || null, mayNotRunVia: override?.via || null, runtime: hasRuntimePart(ast), perClass: true,
        });
      }
    }
    return out;
  }

  /**
   * The first class below the site's class (path[1..]) whose method — its own, or one a trait (nested
   * traits too) brings in — overrides the site's method without parent:: → { cls, via: trait or null }.
   * `site` is the type that holds the dispatch: a trait using the site's own trait does not override it.
   */
  function overriddenWithoutParent(path, methodName, site) {
    for (const name of path.slice(1)) {
      const rec = type(name);
      const hit = rec && methodOf(rec, methodName.toLowerCase(), site);
      if (hit && !callsParent(hit.rec, hit.method, methodName)) return { cls: rec.fqcn, via: hit.rec === rec ? null : hit.rec.fqcn };
    }
    return null;
  }

  /** A class's method as PHP picks it: its own, else the first trait (in use order, nested) that has one with a body. */
  function methodOf(rec, lower, site) {
    const own = rec.methods.get(lower);
    if (own?.hasBody) return { rec, method: own };
    const seen = new Set();
    const visit = r => {
      for (const tn of r.traits || []) {
        const tr = type(tn);
        if (!tr || seen.has(tr.fqcn.toLowerCase())) continue;
        seen.add(tr.fqcn.toLowerCase());
        if (tr === site) continue;            // the dispatching method itself
        const mt = tr.methods.get(lower);
        if (mt?.hasBody) return { rec: tr, method: mt };
        const nested = visit(tr);
        if (nested) return nested;
      }
      return null;
    };
    return visit(rec);
  }

  /**
   * The site's name with every part that depends on the class running it as WILD — a cheap test
   * whether the site can dispatch a queried name before resolving it for every subclass.
   */
  function shapeOf(site) {
    const L = site.type ? type(site.type) : null;
    const method = L && site.method ? L.methods.get(site.method.toLowerCase()) : null;
    return evaluate(parseNameExpr(site.arg), {
      lexical: L, self: L, called: null, shape: true, before: site.before || '', params: method?.params || [],
      visiting: new Set(), notes: [],
    });
  }

  return { levels, classChain, evaluate, resolveSite, shapeOf };
}

/** A name pattern (WILD = unknown part) as a RegExp; Magento lower-cases event names on dispatch. */
export function patternRegExp(value) {
  const esc = plainName(value).toLowerCase().split(WILD).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${esc.join('.*')}$`);
}

/** A user's query (`*` = any) against a resolved value (WILD = unknown at runtime): can they meet? */
export function nameMatches(query, value) {
  const q = query.toLowerCase();
  const v = plainName(value).toLowerCase();
  if (!q.includes('*') && !v.includes(WILD)) return q === v;
  if (!v.includes(WILD)) return new RegExp(`^${q.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(v);
  if (!q.includes('*')) return patternRegExp(v).test(q);
  // both have unknown parts: compare the fixed prefix and suffix
  const [qp, qs] = [q.split('*')[0], q.split('*').pop()];
  const [vp, vs] = [v.split(WILD)[0], v.split(WILD).pop()];
  return (qp.startsWith(vp) || vp.startsWith(qp)) && (qs.endsWith(vs) || vs.endsWith(qs));
}

/** A name with a known part worth navigating by (not only wildcards and separators). */
export const isInformative = value => plainName(value).split(WILD).some(part => part.replace(/[_\-.]/g, '').length >= 3);

/**
 * For a query with `*`: the runtime name shares the query's known parts (`*_save_after` → its known
 * text contains `_save_after`). Two patterns with wildcards can always meet in theory; this keeps the
 * list to sites worth opening.
 */
export function sharesKnownParts(query, value) {
  if (!query.includes('*')) return true;
  const known = plainName(value).toLowerCase().split(WILD).join('\u0000');
  return query.toLowerCase().split('*').filter(f => f.replace(/[_\-.]/g, '').length >= 3).every(f => known.includes(f));
}

/** WILD → `*` for display (COND marks dropped). */
export const shownName = value => plainName(value).split(WILD).join('*');
