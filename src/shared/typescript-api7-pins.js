export const TYPESCRIPT_API7_VERSION = '7.1.0-beta';
export const TYPESCRIPT_API7_PROFILE = 'typescript-api7-request-snapshot-v1';
export const TYPESCRIPT_API7_PRODUCER_VERSION = '1';
const SDK = Object.freeze({ bytes: 576463,
  sha512: '7235a3640243b26673b0d0b91b01cd956d183cceb98d96b9a11d0ac907185f72925487d3bed06afffbdec084b26ad2a4e0e2e2e60ad98c7848544f5f76bc3551' });
// Official registry metadata and tarball SHA512, reviewed 2026-11-07. The SDK
// vendors its JS dependencies; only this target's separately pinned native
// package is needed when the API is connected to our explicit process owner.
const NATIVE = Object.freeze({
  x64: [10283326, '50a707bdbc9b636b434ef156d9bd6fc2202f0e5211a28a3af6587c09759584e41e8dcbe9339f8881b8855bd108c11e568b95ffbfe05d37b81d59b8a006e277af'],
  arm64: [9385247, '9496e8ef520439f2fb6592199c0ad168e2ea8e7f4101fa12cf25109f46928df4a90d92f8aeed1a7d4b1d05fa3a3d01230fab2c7668b49ff47068f0035fa6ecbd']
});
const recipe = (role, platform, arch) => {
  const native = role === 'native', [bytes, sha512] = native ? NATIVE[arch] : [SDK.bytes, SDK.sha512];
  const packageName = `typescript-win32-${arch}`, component = `typescript-api7-${role}-${TYPESCRIPT_API7_VERSION}-${platform}-${arch}`;
  const storageEstimate = { complete: true, basis: 'bounded-archive-owner-v1', writes: [
    { destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + bytes + 32 * 1024 * 1024 }
  ] };
  return { storageEstimate, approvedOrigins: ['https://registry.npmjs.org'], managedDescriptor: {
    schemaVersion: 1, toolId: component, recipeId: `typescript-api7-${role}-official-archive-v1`, version: TYPESCRIPT_API7_VERSION,
    platform, arch, archive: { type: 'tar.gz', bytes, sha512,
      url: native ? `https://registry.npmjs.org/@typescript/${packageName}/-/${packageName}-${TYPESCRIPT_API7_VERSION}.tgz`
        : `https://registry.npmjs.org/typescript/-/typescript-${TYPESCRIPT_API7_VERSION}.tgz` },
    root: 'package', command: native ? 'lib/tsc.exe' : 'dist/api/async/api.js', args: [], executables: native ? ['lib/tsc.exe'] : [], storageEstimate,
    requiredFiles: native ? ['lib/tsc.exe', 'lib/lib.d.ts', 'package.json', 'LICENSE', 'NOTICE.txt']
      : ['dist/api/async/api.js', 'dist/api/async/client.js', 'dist/api/fs.js', 'dist/ast/index.js',
        'dist/api/fsCallbacks.js', 'vendor/vscode-jsonrpc/lib/node/main.js', 'package.json', 'lib/version.cjs', 'LICENSE', 'NOTICE.txt']
  } };
};
/** Version/target-qualified component owners prevent a future SDK upgrade from
 * replacing the selected files of an earlier API/native pair. Neither package
 * changes npm dependencies, .bin links or the current compiler's command. */
export const resolveManagedTypeScriptApi7Recipes = ({ platform = process.platform, arch = process.arch } = {}) =>
  platform === 'win32' && Object.hasOwn(NATIVE, arch) ? { sdk: recipe('sdk', platform, arch), native: recipe('native', platform, arch) } : null;

