/**
 * Index file locations shared by the CLI and the MCP server: where the DB lives, the
 * manifest sidecar paired with it, and how a rebuilt DB replaces the live one.
 */
import { existsSync, renameSync, rmSync, unlinkSync } from 'fs';
import path from 'path';

/**
 * Index database path: MAGECTOR_DB when set, else <MAGENTO_ROOT or cwd>/.magector/index.db.
 * The index lives with the code it describes, whatever directory the process started in
 * (an MCP client usually starts the server outside the Magento root).
 */
export function defaultDbPath(env = process.env, cwd = process.cwd()) {
  return env.MAGECTOR_DB || path.join(env.MAGENTO_ROOT || cwd, '.magector', 'index.db');
}

/**
 * Index database path when indexing `root` (`index <path>`): MAGECTOR_DB still wins, else
 * <root>/.magector/index.db — the index stays with the code it describes, not with
 * MAGENTO_ROOT or the cwd.
 */
export function dbPathForRoot(root, env = process.env) {
  return defaultDbPath({ ...env, MAGENTO_ROOT: root });
}

/**
 * The manifest sidecar the Rust core keeps beside an index DB: the file name with its last
 * extension replaced by `.manifest` (Rust's Path::with_extension), so `index.db` pairs with
 * `index.manifest` and `index.db.new` with `index.db.manifest`.
 */
export function manifestPath(dbPath) {
  return path.join(path.dirname(dbPath), path.parse(dbPath).name + '.manifest');
}

/**
 * Where a background re-index builds the new DB: `index.db` → `index.db.new`. A DB path
 * with no extension gets `.new.db` instead, because `<name>.new` would share its manifest
 * (`<name>.manifest`) with the live DB and the rebuild would overwrite the live sidecar.
 */
export function tempDbPathFor(dbPath) {
  return path.extname(dbPath) ? dbPath + '.new' : dbPath + '.new.db';
}

/**
 * Swap a freshly built index into place (old DB → .bak), moving its manifest with it.
 * The live manifest describes the OLD index, so it goes FIRST: a crash between the renames
 * then leaves no manifest (`index` rebuilds it), never the old manifest beside the new DB,
 * which `index` would trust for content the new DB may not hold. Throws on failure — before
 * touching anything when there is no temp DB (a re-index that saved nothing), so the
 * current DB and manifest stay live rather than the DB being stranded as .bak.
 */
export function swapInIndex(dbPath, tempDbPath, log = () => {}) {
  if (!existsSync(tempDbPath)) {
    throw new Error(`re-index wrote no ${path.basename(tempDbPath)}; keeping the current index`);
  }
  rmSync(manifestPath(dbPath), { force: true });
  if (existsSync(dbPath)) {
    const backupPath = dbPath + '.bak';
    if (existsSync(backupPath)) { try { unlinkSync(backupPath); } catch {} }
    renameSync(dbPath, backupPath);
    log('Old DB moved to .bak');
  }
  renameSync(tempDbPath, dbPath);
  const tempManifest = manifestPath(tempDbPath);
  if (existsSync(tempManifest)) renameSync(tempManifest, manifestPath(dbPath));
  log('New index swapped into place.');
}
