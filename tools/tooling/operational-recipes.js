import { downloadOfficialGitHubRelease } from './official-release-download.js';

// Immutable publisher metadata observed on 2026-10-23, without downloading or
// executing any package. These are recipe inputs, not platform qualification.
// https://graphviz.org/download/ (ZIP checksums + GitLab package HEAD sizes)
// https://api.github.com/repos/BurntSushi/ripgrep/releases/tags/15.2.0
// https://api.github.com/repos/scip-code/scip/releases/tags/v0.10.0
const GRAPHVIZ = {
  x64: [9767733, '733e49626c492242eb8dca30ea627b6ead20710e207998c7933b4909d92d6abc', '64'],
  ia32: [8271496, '37906f29ede26cf1952f8cf942c1e7814ab86ef448130136c8607b1b6ffe0870', '32']
};
const RIPGREP = {
  'win32-x64': ['x86_64-pc-windows-msvc', 1789611, '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5'],
  'win32-arm64': ['aarch64-pc-windows-msvc', 1640124, 'e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f'],
  'win32-ia32': ['i686-pc-windows-msvc', 1642641, '9bf73bdb3fda9ad4b0235e1295b02c717031c986afa4d7c05dd0af8b74010a95'],
  'darwin-x64': ['x86_64-apple-darwin', 1878284, 'af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1'],
  'darwin-arm64': ['aarch64-apple-darwin', 1764284, '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4'],
  'linux-x64': ['x86_64-unknown-linux-musl', 2265718, '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c'],
  'linux-arm64': ['aarch64-unknown-linux-musl', 1982561, '800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915']
};
const SCIP = {
  'darwin-x64': ['darwin-amd64', 12872646, 'e1d5eb355e5fcfc1c6d6479dd94cb9334c24262a34e38ff514dd5a2231b779ec'],
  'darwin-arm64': ['darwin-arm64', 12328760, '7ea200390e0790b3da8999b7b1cd4e3597700dcb3d354911872523bfe0090779'],
  'linux-x64': ['linux-amd64', 12357047, 'eeb28ebbff443c01609fb1691809958f3f0c7a8651af689a5bc8560061cd8ab0'],
  'linux-arm64': ['linux-arm64', 11542121, '6ab677dc2c4bf2955975d0530766152e45daaa988f9404068d8adecacd0bb24c']
};

const recipe = ({ toolId, version, platform, arch, url, bytes, sha256, type, command, root = null }) => {
  // Shared archive extraction enforces a 1 GiB ceiling. Reserve that inclusive
  // bound, the archive, and bounded transaction/receipt metadata in one owner.
  const storageEstimate = { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + bytes + 32 * 1024 * 1024 }] };
  return { managedDescriptor: { schemaVersion: 1, toolId, recipeId: `${toolId}-official-native-archive`, version, platform, arch,
    archive: { url, bytes, sha256, type }, command, args: [], ...(root ? { root } : {}),
    requiredFiles: [command], executables: [command], storageEstimate }, storageEstimate,
  approvedOrigins: [new URL(url).origin], ...(url.startsWith('https://github.com/') ? { download: downloadOfficialGitHubRelease } : {}) };
};

export const resolveOperationalManagedRecipe = (id, { platform = process.platform, arch = process.arch } = {}) => {
  if (id === 'cargo-cyclonedx' && platform === 'win32' && arch === 'x64') {
    // cargo-dist's published dist-manifest.json identifies a flat ZIP with
    // cargo-cyclonedx.exe; other targets use tar.xz, unsupported by our bounded
    // archive extractor. No implicit xz utility/source build is substituted.
    const selected = recipe({ toolId: id, version: '0.5.9', platform, arch, bytes: 2181064,
      sha256: '8750e00775661dcb75bc482c1a298839fd94e8a0c033b49905ba0f246ffed202', type: 'zip', command: 'cargo-cyclonedx.exe',
      url: 'https://github.com/CycloneDX/cyclonedx-rust-cargo/releases/download/cargo-cyclonedx-0.5.9/cargo-cyclonedx-x86_64-pc-windows-msvc.zip' });
    selected.managedDescriptor.args = ['cyclonedx'];
    return selected;
  }
  if (id === 'graphviz') {
    const asset = platform === 'win32' ? GRAPHVIZ[arch] : null;
    if (!asset) return null;
    const [bytes, sha256, bits] = asset, version = '16.1.0';
    return recipe({ toolId: id, version, platform, arch, bytes, sha256, type: 'zip', command: 'bin/dot.exe', root: `Graphviz-${version}-win${bits}`,
      url: `https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/${version}/windows_10_cmake_Release_Graphviz-${version}-win${bits}.zip` });
  }
  if (id === 'ripgrep') {
    const asset = RIPGREP[`${platform}-${arch}`];
    if (!asset) return null;
    const [target, bytes, sha256] = asset, version = '15.2.0', root = `ripgrep-${version}-${target}`;
    const type = platform === 'win32' ? 'zip' : 'tar.gz';
    return recipe({ toolId: id, version, platform, arch, bytes, sha256, type, root, command: platform === 'win32' ? 'rg.exe' : 'rg',
      url: `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${root}.${type}` });
  }
  if (id === 'scip') {
    const asset = SCIP[`${platform}-${arch}`];
    if (!asset) return null;
    const [target, bytes, sha256] = asset, version = '0.10.0';
    return recipe({ toolId: id, version, platform, arch, bytes, sha256, type: 'tar.gz', command: 'scip',
      url: `https://github.com/scip-code/scip/releases/download/v${version}/scip-${target}.tar.gz` });
  }
  return null;
};
