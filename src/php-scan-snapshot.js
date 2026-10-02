/**
 * The PHP scan (class hierarchy, dispatch sites, trait users) shared by every MCP instance of one
 * Magento root. A full scan reads the whole tree (~30-50 s, one core, on ~100k files); several
 * sessions started together each read it again. The instance that scans writes the result to
 * `.magector/php-scan.json`; the others load it and check it against the tree by file stamps.
 * While one instance scans (it holds `.magector/php-scan.lock`), the others wait for its file.
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync, mkdirSync, openSync, closeSync, chmodSync, constants as fsConstants } from 'fs';
import path from 'path';

/** Bumped whenever the shape of the scan changes: a file of another format is not read. */
export const SNAPSHOT_FORMAT = 1;

export function snapshotPathFor(magentoRoot) {
  return path.join(magentoRoot, '.magector', 'php-scan.json');
}

export function scanLockPathFor(magentoRoot) {
  return path.join(magentoRoot, '.magector', 'php-scan.lock');
}

/** `mtimeMs:size` of a file, or null when it is gone — the stamp the scan keeps per file. */
export function fileStampOf(absPath) {
  try { const st = statSync(absPath); return `${st.mtimeMs}:${st.size}`; } catch { return null; }
}

/** The scan as plain JSON data (Maps as entry lists). */
export function serializeScan(scan, { root, version }) {
  return JSON.stringify({
    format: SNAPSHOT_FORMAT, version, root, builtAt: Date.now(),
    stamps: [...scan.stamps],
    typeFiles: [...scan.typeFiles],
    dispatchFiles: [...scan.dispatchFiles],
    dispatchSites: scan.dispatchSites,
    traitUsers: [...scan.traitUsers],
    types: [...scan.hierarchy.types],
    children: [...scan.hierarchy.children],
  });
}

/** The scan back from serializeScan's text, or null when it is of another format, version or root. */
export function deserializeScan(text, { root, version }) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || d.format !== SNAPSHOT_FORMAT || d.version !== version || d.root !== root) return null;
  return {
    builtAt: d.builtAt,
    stamps: new Map(d.stamps),
    typeFiles: new Set(d.typeFiles),
    dispatchFiles: new Map(d.dispatchFiles),
    dispatchSites: d.dispatchSites,
    traitUsers: new Map(d.traitUsers),
    hierarchy: { types: new Map(d.types), children: new Map(d.children) },
  };
}

/**
 * The scan checked against the tree by the stamp of every file it read. A changed or deleted file
 * that declared classes / used traits makes it unusable ({ staleTypeFile }): a class it no longer
 * declares would stay in the hierarchy. Any other changed file is listed in `changed`, to be read
 * again; deleted ones in `deleted`. Files added later are left to the scan's own refresh.
 */
export function checkSnapshot(root, scan) {
  const changed = [];
  const deleted = [];
  for (const [rel, stamp] of scan.stamps) {
    const now = fileStampOf(path.join(root, rel));
    if (now === stamp) continue;
    if (scan.typeFiles.has(rel)) return { staleTypeFile: rel };
    (now ? changed : deleted).push(rel);
  }
  return { changed, deleted };
}

/**
 * The snapshot of root, checked against the tree: { scan, changed, deleted } when usable, else
 * { reason } — no file, another format / version / root, or a changed file with classes.
 */
export function loadSnapshot(root, version) {
  let text;
  try { text = readFileSync(snapshotPathFor(root), 'utf-8'); } catch { return { reason: 'no snapshot' }; }
  const scan = deserializeScan(text, { root, version });
  if (!scan) return { reason: 'snapshot of another format, version or root' };
  const check = checkSnapshot(root, scan);
  if (check.staleTypeFile) return { reason: `changed since the snapshot: ${check.staleTypeFile}` };
  return { scan, changed: check.changed, deleted: check.deleted };
}

/** Writes the snapshot atomically (temp file + rename), readable by the owner only. */
export function writeSnapshot(root, scan, version) {
  const file = snapshotPathFor(root);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, serializeScan(scan, { root, version }), { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* non-POSIX */ }
    renameSync(tmp, file);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch {}
    return false;
  }
}

/** PID of the live instance scanning root now (holding the lock), or null. */
export function scanLockHolder(root) {
  try {
    const pid = parseInt(readFileSync(scanLockPathFor(root), 'utf-8').trim(), 10);
    if (!pid || isNaN(pid)) return null;
    if (pid === process.pid) return pid;
    process.kill(pid, 0);   // throws when it is gone
    return pid;
  } catch {
    return null;
  }
}

/**
 * Takes the scan lock: true when this process may scan. False only when another live process holds
 * it; a lock that cannot be written at all (read-only tree) does not stop the scan.
 */
export function acquireScanLock(root) {
  const lock = scanLockPathFor(root);
  const create = () => {
    const fd = openSync(lock, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  };
  try { mkdirSync(path.dirname(lock), { recursive: true }); } catch {}
  try { create(); return true; } catch (e) { if (e.code !== 'EEXIST') return true; }
  if (scanLockHolder(root)) return scanLockHolder(root) === process.pid;
  try { unlinkSync(lock); } catch {}                       // left by a process that is gone
  try { create(); return true; } catch (e) { return e.code !== 'EEXIST'; }
}

export function releaseScanLock(root) {
  try {
    const lock = scanLockPathFor(root);
    if (readFileSync(lock, 'utf-8').trim() === String(process.pid)) unlinkSync(lock);
  } catch {}
}

/** Waits while another live process scans root, up to maxMs; true when it finished in time. */
export async function waitForScanLock(root, maxMs, pollMs = 500) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const holder = scanLockHolder(root);
    if (!holder || holder === process.pid) return true;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return !scanLockHolder(root);
}
