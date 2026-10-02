/**
 * Read the JSON a magector-core command printed on stdout.
 *
 * The npm-distributed binary can print other lines to stdout as well: ANSI-coloured tracing even
 * with RUST_LOG=error, and hnsw_rs's "setting number of points 50000". `search -f json` prints its
 * results with serde_json::to_string_pretty, over many lines — and a line of that output can be
 * valid JSON on its own (`"reindexEntity"` in a methods list, `42`, `{}`). Taking the last line that
 * parses therefore returned a string instead of the results, and the search answered empty.
 */

const LOG_LINE = /^\s*(\x1b\[|\[[\d\-T:.Z]+)/;
const JSON_START = /^\s*[\[{"\-0-9tfn]/;

export function extractJson(stdout) {
  const lines = String(stdout ?? '').split('\n');

  // The whole output without the tracing lines around it: pretty-printed JSON, the normal case.
  let start = lines.findIndex(l => l.trim() && !LOG_LINE.test(l) && JSON_START.test(l));
  if (start < 0) start = 0;
  const cleaned = lines.slice(start).filter(l => l.trim() && !LOG_LINE.test(l)).join('\n').trim();
  if (cleaned) {
    try { return JSON.parse(cleaned); } catch { /* other output after the JSON: one line below */ }
  }

  // Compact JSON on one line among other output: the last line that is an object or an array.
  // A scalar line is never the answer — it is a fragment of a pretty-printed document.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || (line[0] !== '{' && line[0] !== '[')) continue;
    try {
      const value = JSON.parse(line);
      if (value !== null && typeof value === 'object') return value;
    } catch { /* not JSON */ }
  }
  throw new SyntaxError('No valid JSON found in command output');
}
