/**
 * Resolve and download ONNX model files for magector-core.
 *
 * Resolution order:
 * 1. MAGECTOR_MODELS env var
 * 2. ~/.magector/models/ (global cache)
 * 3. rust-core/models/ (dev fallback)
 *
 * Downloads from HuggingFace if not found — into MAGECTOR_MODELS when set, else the
 * global cache.
 */
import { existsSync, statSync, mkdirSync, createWriteStream, unlinkSync, renameSync, rmSync } from 'fs';
import { get as httpsGet } from 'https';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL_FILES = [
  {
    name: 'all-MiniLM-L6-v2.onnx',
    url: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
    description: 'ONNX embedding model (~86MB)'
  },
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
    description: 'Tokenizer vocabulary (~700KB)'
  }
];

function getGlobalCacheDir() {
  return path.join(os.homedir(), '.magector', 'models');
}

/**
 * Where a missing model is downloaded: MAGECTOR_MODELS when set (the directory the user
 * chose, and the first place resolveModels() looks), else the global cache.
 */
export function modelDownloadDir(env = process.env) {
  return env.MAGECTOR_MODELS || getGlobalCacheDir();
}

/**
 * Find the model directory. Does NOT download — returns null if not found.
 */
export function resolveModels() {
  // 1. Explicit env var
  if (process.env.MAGECTOR_MODELS) {
    if (hasModels(process.env.MAGECTOR_MODELS)) {
      return process.env.MAGECTOR_MODELS;
    }
  }

  // 2. Global cache
  const globalDir = getGlobalCacheDir();
  if (hasModels(globalDir)) {
    return globalDir;
  }

  // 3. Dev fallback
  const devDir = path.join(__dirname, '..', 'rust-core', 'models');
  if (hasModels(devDir)) {
    return devDir;
  }

  return null;
}

function hasModels(dir) {
  return MODEL_FILES.every(f => {
    const p = path.join(dir, f.name);
    return existsSync(p) && statSync(p).size > 0;
  });
}

/**
 * Ensure models exist, downloading if needed. Returns the model directory path.
 */
export async function ensureModels({ silent = false } = {}) {
  const existing = resolveModels();
  if (existing) return existing;

  const targetDir = modelDownloadDir();
  mkdirSync(targetDir, { recursive: true });

  if (!silent) {
    console.log(`Downloading ONNX model to ${targetDir} ...`);
  }

  for (const file of MODEL_FILES) {
    const dest = path.join(targetDir, file.name);
    if (existsSync(dest) && statSync(dest).size > 0) continue;
    if (existsSync(dest)) unlinkSync(dest);

    if (!silent) {
      process.stdout.write(`  ${file.description} ... `);
    }
    await downloadFile(file.url, dest);
    if (!silent) {
      console.log('done');
    }
  }

  if (!hasModels(targetDir)) {
    throw new Error('Model download failed — files missing after download');
  }

  return targetDir;
}

/**
 * Download `url` to `dest` by way of `<dest>.part`, renamed into place only once the whole
 * body has arrived and matches Content-Length (when the server sent one). A dropped
 * connection or a short body must never leave a truncated model under its final name:
 * hasModels() would accept it, and it would be used and copied along with the directory.
 * `get` is injectable for tests.
 */
export function downloadFile(url, dest, get = httpsGet) {
  const part = dest + '.part';
  return new Promise((resolve, reject) => {
    let settled = false;
    let response = null;
    let file = null; // the .part stream, opened once a 200 response arrives

    // Every failure ends here: stop the transfer, close the stream, then remove the partial file.
    const fail = (err, streamClosed = false) => {
      if (settled) return;
      settled = true;
      if (response) response.destroy();
      const done = () => { rmSync(part, { force: true }); reject(err); };
      if (!file || streamClosed) return done();
      file.once('close', done);
      file.destroy();
    };

    function follow(currentUrl) {
      get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(new URL(res.headers.location, currentUrl).href);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }
        response = res;
        const expected = Number(res.headers['content-length']); // NaN when the header is absent
        let ended = false;
        file = createWriteStream(part);
        res.on('end', () => { ended = true; });
        res.on('error', fail);
        res.on('close', () => {
          if (!ended) fail(new Error(`Connection closed before ${url} finished downloading`));
        });
        file.on('error', fail);
        file.on('close', () => {
          if (settled) return;
          try {
            const size = statSync(part).size;
            if (Number.isFinite(expected) && size !== expected) {
              throw new Error(`Incomplete download of ${url}: got ${size} of ${expected} bytes`);
            }
            renameSync(part, dest);
          } catch (err) {
            return fail(err, true);
          }
          settled = true;
          resolve();
        });
        res.pipe(file);
      }).on('error', fail);
    }

    follow(url);
  });
}
