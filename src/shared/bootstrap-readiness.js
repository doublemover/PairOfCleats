import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { probeNativePackage } from './native-package-probe.js';
import { buildReadinessReceipt } from '../../tools/setup/readiness.js';

export const BOOTSTRAP_RECEIPT = 'node_modules/.pairofcleats-bootstrap.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const INPUTS = ['package.json', 'package-lock.json', '.nvmrc',
  'tools/setup/apply-patches.js', 'tools/setup/rebuild-native.js',
  'tools/setup/rebuild-native-sqlite.js', 'tools/setup/readiness.js', 'src/shared/native-package-probe.js',
  'src/shared/bootstrap-readiness.js', 'src/lang/tree-sitter/native-runtime.js'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = () => ({ node: process.version, abi: process.versions.modules,
  platform: process.platform, arch: process.arch });
const readiness = (ready, reason = null) => ({
  ...buildReadinessReceipt({ items: [{ id: 'bootstrap', required: true,
    state: ready ? 'available-and-verified' : 'unverified', reason,
    verificationLevel: ready ? 'setup-inputs-artifact-metadata-and-native-activation' : null }] }), reason
});
const signature = file => {
  const stat = fs.statSync(file);
  return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode];
};
const readBounded = (file, limit = MAX_RECEIPT_BYTES) => {
  if (fs.statSync(file).size > limit) throw new Error(`Readiness input exceeds its byte bound: ${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length > limit) throw new Error(`Readiness input exceeds its byte bound: ${file}`);
  return bytes;
};
const inputHashes = root => {
  const files = [...INPUTS];
  const patches = path.join(root, 'patches');
  if (fs.existsSync(patches)) {
    const names = fs.readdirSync(patches).sort();
    if (names.length > 128) throw new Error('Bootstrap patch inventory exceeds its bound.');
    for (const name of names) if (name.endsWith('.patch')) files.push(`patches/${name}`);
  }
  return files.map(relative => [relative, hash(readBounded(path.join(root, relative)))]);
};
const safeFile = (root, relative) => {
  if (typeof relative !== 'string' || !relative.startsWith('node_modules/')
    || relative.includes('\\') || relative.split('/').some(part => part === '..' || !part)) {
    throw new Error('Invalid bootstrap artifact path.');
  }
  return path.join(root, relative);
};

/** Called only after the existing complete native verifier and patch verifier
 * succeed. A receipt records evidence, not a substitute for current readiness.
 */
export const recordBootstrapReadiness = (root, verifiedPackages) => {
  root = fs.realpathSync(root);
  const pkg = JSON.parse(readBounded(path.join(root, 'package.json')));
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();
  for (const name of declared) {
    if (!fs.existsSync(path.join(root, 'node_modules', name, 'package.json'))) {
      throw new Error(`Required checkout dependency is missing: ${name}. Run npm run bootstrap.`);
    }
  }
  const artifacts = [], pending = ['node_modules'];
  let visited = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = fs.opendirSync(path.join(root, relative));
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++visited > 500000) throw new Error('Bootstrap inventory exceeds its file bound.');
        if (entry.name === '.cache' || entry.name === '.bin' || entry.name.startsWith('.pairofcleats-bootstrap')) continue;
        const child = relative + '/' + entry.name;
        if (entry.isDirectory()) pending.push(child);
        else if (entry.isFile() && (entry.name === 'package.json' || entry.name === '.package-lock.json'
          || /\.(?:node|dll|dylib|so(?:\.\d+)*)$/.test(entry.name))) {
          artifacts.push([child, signature(path.join(root, child))]);
        }
      }
    } finally { directory.closeSync(); }
  }
  // Package patch targets are part of readiness even when they are plain JS/C.
  for (const [relative] of inputHashes(root)) if (relative.startsWith('patches/')) {
    const text = readBounded(path.join(root, relative)).toString('utf8');
    for (const match of text.matchAll(/^\+\+\+ b\/(node_modules\/[^\r\n]+)$/gm)) {
      artifacts.push([match[1], signature(safeFile(root, match[1]))]);
    }
  }
  if (artifacts.length > 10000) throw new Error('Bootstrap artifact inventory exceeds its bound.');
  const receipt = { schemaVersion: 1, root, runtime: runtime(), inputs: inputHashes(root),
    verifiedPackages: [...verifiedPackages].sort(), declared, artifacts: artifacts.sort((a, b) => a[0].localeCompare(b[0])) };
  const text = JSON.stringify(receipt);
  if (Buffer.byteLength(text) > MAX_RECEIPT_BYTES) throw new Error('Bootstrap receipt exceeds its byte bound.');
  const target = path.join(root, BOOTSTRAP_RECEIPT), temporary = `${target}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, text, { flag: 'wx' }); fs.renameSync(temporary, target); }
  finally { fs.rmSync(temporary, { force: true }); }
  return receipt;
};

export const inspectBootstrapReadiness = async ({ root = ROOT } = {}) => {
  try {
    root = fs.realpathSync(root);
    if (Number(process.versions.node.split('.')[0]) !== 26) throw new Error('This checkout requires Node.js 26.x.');
    const file = path.join(root, BOOTSTRAP_RECEIPT);
    if (!fs.existsSync(file)) throw new Error('Verified bootstrap receipt is missing; installation is incomplete or has not been verified.');
    const receipt = JSON.parse(readBounded(file));
    if (receipt.schemaVersion !== 1 || receipt.root !== root
      || JSON.stringify(receipt.runtime) !== JSON.stringify(runtime())) throw new Error('Bootstrap belongs to a different checkout, Node runtime or native ABI.');
    if (JSON.stringify(receipt.inputs) !== JSON.stringify(inputHashes(root))) throw new Error('Bootstrap setup inputs, package lock or required patches have changed.');
    if (!Array.isArray(receipt.artifacts) || !receipt.artifacts.length || receipt.artifacts.length > 10000
      || !Array.isArray(receipt.verifiedPackages) || !receipt.verifiedPackages.includes('tree-sitter')
      || !receipt.verifiedPackages.includes('better-sqlite3')) throw new Error('Bootstrap verification evidence is incomplete.');
    for (const [relative, expected] of receipt.artifacts) {
      if (JSON.stringify(signature(safeFile(root, relative))) !== JSON.stringify(expected)) {
        throw new Error(`Verified dependency artifact changed: ${relative}`);
      }
    }
    // Load success alone does not detect lazy SQLite binding failures or an
    // unusable tree-sitter grammar. Reuse the actual native activation probes.
    for (const name of ['better-sqlite3', 'tree-sitter']) {
      const result = await probeNativePackage(root, name);
      if (!result.ok) throw new Error(`${name} is not usable: ${result.message}`);
    }
    return readiness(true);
  } catch (error) { return readiness(false, error?.message || String(error)); }
};

export const formatBootstrapRequired = (reason, root = ROOT) => [
  '', '======================================================================',
  'PAIR OF CLEATS CANNOT START: BOOTSTRAP REQUIRED',
  '======================================================================', reason,
  `In the PairOfCleats checkout (${root}), run:`, '', '  npm run bootstrap', '',
  'For a clean, lockfile-pinned CI install: npm run bootstrap:ci',
  'Use Node.js 26.x. Bootstrap installs dependencies, applies required patches',
  'and rebuilds/verifies native modules. Nothing was installed automatically.',
  '======================================================================', ''
].join('\n');

/** Builtin-only entry gate runs before dependency-heavy dynamic imports. No
 * environment bypass: imported libraries are inert; executable paths are gated.
 */
export const requireBootstrap = async ({ root = ROOT } = {}) => {
  const result = await inspectBootstrapReadiness({ root });
  if (result.ready) return;
  const error = Object.assign(new Error(formatBootstrapRequired(result.reason, root)), { code: 'ERR_BOOTSTRAP_REQUIRED' });
  throw error;
};
export const guardBootstrapEntry = async entryUrl => {
  if (!process.argv[1]) return;
  let direct;
  try { direct = fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(entryUrl)); }
  catch { return; }
  if (!direct) return;
  try { await requireBootstrap(); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exit(1); }
};
