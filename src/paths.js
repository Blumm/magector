/**
 * Shared path defaults for the CLI and the MCP server.
 */
import path from 'path';

/**
 * Index database path: MAGECTOR_DB when set, else <MAGENTO_ROOT or cwd>/.magector/index.db.
 * The index lives with the code it describes, whatever directory the process started in
 * (an MCP client usually starts the server outside the Magento root).
 */
export function defaultDbPath(env = process.env, cwd = process.cwd()) {
  return env.MAGECTOR_DB || path.join(env.MAGENTO_ROOT || cwd, '.magector', 'index.db');
}
