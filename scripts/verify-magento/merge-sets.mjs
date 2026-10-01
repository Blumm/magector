#!/usr/bin/env node
/**
 * File sets for compare.mjs merge that make Config\Dom resolve conflicts: each well-formed mutated
 * copy (mutate-xml.mjs values) merged with its original, in both orders, and with a second copy of
 * the same original when there is one — the same types, arguments, plugins and observers declared
 * twice, with other values, types, text and names.
 *
 *   node merge-sets.mjs <magento-root> <out-dir>/sources.tsv > sets.json
 *   php merge-truth.php sets < sets.json > merge-sets-truth.json      # in the PHP container
 *   node compare.mjs merge <magento-root> merge-sets-truth.json
 */
import { readFileSync } from 'fs';
import path from 'path';
import { checkXmlWellFormed } from '../../src/di-config.js';

const [rootArg, sourcesFile] = process.argv.slice(2);
if (!rootArg || !sourcesFile) {
  console.error('usage: node merge-sets.mjs <magento-root> <sources.tsv>');
  process.exit(2);
}
const root = path.resolve(rootArg);
const kindOf = f => (/(^|\/)di\.xml$/.test(f) ? 'di' : /(^|\/)events\.xml$/.test(f) ? 'events' : null);
const wellFormed = f => !checkXmlWellFormed(readFileSync(path.join(root, f), 'utf-8')).length;
const byOriginal = new Map();
for (const line of readFileSync(sourcesFile, 'utf-8').split('\n').filter(Boolean)) {
  const [copy, original] = line.split('\t');
  if (!kindOf(copy) || !wellFormed(copy) || !wellFormed(original)) continue;
  if (!byOriginal.has(original)) byOriginal.set(original, []);
  byOriginal.get(original).push(copy);
}
const sets = [];
for (const [original, copies] of byOriginal) {
  const kind = kindOf(original);
  for (const copy of copies) {
    sets.push({ kind, files: [original, copy] }, { kind, files: [copy, original] });
  }
  if (copies.length > 1) sets.push({ kind, files: [original, copies[0], copies[1]] }, { kind, files: [copies[1], original, copies[0]] });
}
console.log(JSON.stringify(sets));
console.error(`${sets.length} sets from ${byOriginal.size} originals`);
