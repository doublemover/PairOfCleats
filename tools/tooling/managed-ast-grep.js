import path from 'node:path';
import { identifyProvisioningExecutable, probeProvisioningCommand } from './provisioning-plan.js';
import { downloadOfficialGitHubRelease } from './official-release-download.js';
import { runOperationalChildWithStorage } from './operational-storage.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';

// Official 0.51.0 release asset metadata, resolved on 2026-10-29:
// https://api.github.com/repos/ast-grep/ast-grep/releases/tags/0.51.0
// The release workflow packages both executable names at the archive root.
// https://github.com/ast-grep/ast-grep/blob/0.51.0/.github/workflows/release.yml
export const AST_GREP_VERSION = '0.51.0';
const ASSETS = Object.freeze({
  'win32-x64': ['x86_64-pc-windows-msvc', 16249102, '1a5b7824c5925ac34257f806488e54860817cefd855fd308d13df7550d068908'],
  'win32-arm64': ['aarch64-pc-windows-msvc', 15496895, 'fb6a4c3c6ed350d7e64eae81961bdf6b3f201c6e7c31ace8caccf8ceddff1cac'],
  'win32-ia32': ['i686-pc-windows-msvc', 15410100, '20ee5bdbe55ec63180a808076a5095ee531f938d61c7b6466368605b61525e0e'],
  'darwin-x64': ['x86_64-apple-darwin', 8689176, '8438fe549da59da28518c45bdaab5b851aabafe8fb4f8dc05c261a7649b4eca6'],
  'darwin-arm64': ['aarch64-apple-darwin', 8626879, 'e18e13c27ed6c4b3ec4de00745b0755dee9dc26c035e226f4dd5d147dca99cc8'],
  'linux-x64': ['x86_64-unknown-linux-gnu', 8857052, 'a7eead5552d3a8daad70f5d50d935da44bd0c138e946b5b0a96b1d38169fa639'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', 8511534, '73af0ebe5958acee012754a5b2826a186580ef83333092408a7a01096fc30b8b']
});

export const identifyAstGrepVersion = output => /^ast-grep (\d+\.\d+\.\d+)\s*$/u.exec(String(output || '').trim())?.[1] || null;

export const resolveAstGrepManagedRecipe = ({ platform = process.platform, arch = process.arch,
  libc = platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'unknown' : null } = {}) => {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset || platform === 'linux' && libc !== 'glibc') return null;
  const [target, bytes, sha256] = asset;
  const command = platform === 'win32' ? 'ast-grep.exe' : 'ast-grep';
  const storageEstimate = { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + bytes + 32 * 1024 * 1024 }] };
  return { managedDescriptor: {
    schemaVersion: 1, toolId: 'ast-grep', recipeId: 'ast-grep-official-native-archive', version: AST_GREP_VERSION,
    platform, arch, archive: { url: `https://github.com/ast-grep/ast-grep/releases/download/${AST_GREP_VERSION}/app-${target}.zip`,
      type: 'zip', bytes, sha256 }, command, args: [], requiredFiles: [command], executables: [command],
    // The shared archive owner enforces a 1 GiB extracted-byte ceiling. Reserve
    // that bound, the retained ZIP, and its bounded inventory/receipt metadata.
    // This is an inclusive admission bound, not an observed installed size.
    storageEstimate
  }, storageEstimate, approvedOrigins: ['https://github.com'], download: downloadOfficialGitHubRelease };
};

/** A version string is only executable identity. Readiness additionally proves
 * the pinned parser can perform a local stdin match without scanning a project.
 */
export const verifyManagedAstGrep = async ({ root, command, descriptor, toolingRoot, env: baseEnv = process.env, resourceId, signal = null }, { probe = probeProvisioningCommand } = {}) => {
  if (!path.isAbsolute(toolingRoot || '') || !path.isAbsolute(root || '')) throw new Error('Managed ast-grep verification requires its launch-selected tooling owner and exact generation root.');
  const settlement = { resourceId, settled: true, pending: false };
  const identity = identifyProvisioningExecutable(command, { signal });
  const env = resolveNoProvisionToolingEnvironment(baseEnv, { command, providerId: 'ast-grep', toolingRoot, cwd: root });
  const options = { cwd: root, signal, timeoutMs: 4000, maxOutputBytes: 65536, env };
  const run = (args, extra = {}) => runOperationalChildWithStorage({ id: 'ast-grep', toolingRoot, repoRoot: toolingRoot,
    command, identity, env, cwd: root }, ({ env: routed }) => probe(command, args, { ...options, ...extra, env: routed }));
  const version = await run(['--version']);
  const identified = version.ok && identifyAstGrepVersion(version.stdout) === descriptor.version;
  if (!identified) return { ok: false, level: 'executable-version-rejected', settlement };
  const input = 'console.log("pairofcleats-managed-probe")';
  const matched = await run(['run', '--lang', 'javascript', '--pattern', input, '--json=compact', '--stdin'], { input });
  let rows = null;
  try { rows = JSON.parse(matched.stdout); } catch { /* Non-JSON output cannot prove the selected capability. */ }
  const ok = matched.ok && Array.isArray(rows) && rows.length === 1 && rows[0]?.text === input;
  return { ok, level: ok ? 'pinned-executable-and-local-structural-match' : 'local-structural-match-rejected',
    identity: { family: 'ast-grep', version: descriptor.version }, localRulesOnly: true, settlement };
};
