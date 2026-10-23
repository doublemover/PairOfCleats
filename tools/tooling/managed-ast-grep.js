import { probeProvisioningCommand } from './provisioning-plan.js';
import { downloadOfficialGitHubRelease } from './official-release-download.js';

// Official 0.40.4 release asset metadata, resolved on 2026-10-23:
// https://api.github.com/repos/ast-grep/ast-grep/releases/tags/0.40.4
// The release workflow packages both executable names at the archive root.
// https://github.com/ast-grep/ast-grep/blob/0.40.4/.github/workflows/release.yml
export const AST_GREP_VERSION = '0.40.4';
const ASSETS = Object.freeze({
  'win32-x64': ['x86_64-pc-windows-msvc', 6871227, '165f38caa9269882563a4037f76d6bf793fa8856ccd2502488666aa4899946e9'],
  'win32-arm64': ['aarch64-pc-windows-msvc', 6584416, '35e99cb1ce93381d2aaeb43aca95789f6ec554e0eb130b4def20f398348221e9'],
  'win32-ia32': ['i686-pc-windows-msvc', 6507058, 'cd01dfe74f35cbc04f375080f60fd76d2f06e01468d00f16bf29c8d421051908'],
  'darwin-x64': ['x86_64-apple-darwin', 7399955, '098325df798666c226cb4b8b7a36fde9d395b272163d1a8a678f6f981e3f30c4'],
  'darwin-arm64': ['aarch64-apple-darwin', 7364563, '727551fdca243d8982e57ab233769cfcf5946786e1f5609598f0ec8714af3afa'],
  'linux-x64': ['x86_64-unknown-linux-gnu', 7521357, '5f598ef443e0d3f62ee086f4ea01d4448c993876f13a134982f43a6df74eaaf3'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', 7242479, '585addd6d5f50ab84c33540b4e00ee4860bd5c19c14deeb7bfa253fbea3c02ac']
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
export const verifyManagedAstGrep = async ({ root, command, descriptor, resourceId, signal = null }, { probe = probeProvisioningCommand } = {}) => {
  const settlement = { resourceId, settled: true, pending: false };
  const options = { cwd: root, signal, timeoutMs: 4000, maxOutputBytes: 65536 };
  const version = await probe(command, ['--version'], options);
  const identified = version.ok && identifyAstGrepVersion(version.stdout) === descriptor.version;
  if (!identified) return { ok: false, level: 'executable-version-rejected', settlement };
  const input = 'console.log("pairofcleats-managed-probe")';
  const matched = await probe(command, ['run', '--lang', 'javascript', '--pattern', input, '--json=compact', '--stdin'], { ...options, input });
  let rows = null;
  try { rows = JSON.parse(matched.stdout); } catch { /* Non-JSON output cannot prove the selected capability. */ }
  const ok = matched.ok && Array.isArray(rows) && rows.length === 1 && rows[0]?.text === input;
  return { ok, level: ok ? 'pinned-executable-and-local-structural-match' : 'local-structural-match-rejected',
    identity: { family: 'ast-grep', version: descriptor.version }, localRulesOnly: true, settlement };
};
