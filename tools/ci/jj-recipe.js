// Official stable release, checked2026-10-30. Digests/sizes are the vendor's
// GitHub release asset identities, frozen here rather than resolving latest at run time.
export const JJ_VERSION = '0.46.0';
const targets = Object.freeze({
  'win32:x64': ['x86_64-pc-windows-msvc.zip', 10233241, 'c42316b10df04611bc65029a18bcb2d92636edddb6871d511f7bb4233e999b83'],
  'win32:arm64': ['aarch64-pc-windows-msvc.zip', 9472142, 'f6f0552d0e292e3e62aa7fd21f4b15e9b6644d4939db908ed6d6b04b5b0a7907'],
  'linux:x64': ['x86_64-unknown-linux-musl.tar.gz', 11110358, 'fce0271158e665ceb82dc66c5eb95b1728649094e9133074f3b5baece345fc08'],
  'linux:arm64': ['aarch64-unknown-linux-musl.tar.gz', 10396522, '80e28f7501c11e50e0ca06cd6a1fa1d982cff9cc59bfe4411a9d36aa501d867e'],
  'darwin:x64': ['x86_64-apple-darwin.tar.gz', 10721091, '10d941de276c7c5074ef5d395312813b4575f4ce92cb9c0b05738efb90bd3b60'],
  'darwin:arm64': ['aarch64-apple-darwin.tar.gz', 10074305, '43daa37ce0f9716cdf6fb65a29cbcae74a3160aef048cf3cb3d166d41cb4ab58']
});
export const resolveCiJjRecipe = (platform = process.platform, arch = process.arch) => {
  const row = targets[`${platform}:${arch}`];
  if (!row) throw new Error('No qualified CI Jujutsu archive for this platform/architecture.');
  const [suffix, bytes, sha256] = row, filename = `jj-v${JJ_VERSION}-${suffix}`;
  return Object.freeze({ version: JJ_VERSION, platform, arch, filename, bytes, sha256,
    url: `https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/${filename}`,
    archiveType: suffix.endsWith('.zip') ? 'zip' : 'tar.gz' });
};
