import fs from 'node:fs';
import path from 'node:path';
import { hashManagedToolFile, readManagedToolText } from './managed-tool-file.js';

export const CLANGD_RELEASE_INDEX_URL = 'https://api.github.com/repos/clangd/clangd/releases/latest';
export const CLANGD_MAX_BINARY_BYTES = 512 * 1024 * 1024;
export const resolveClangdArchiveTarget = ({ platform = process.platform, arch = process.arch } = {}) => {
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return { platform, arch, assetPlatform: 'mac' };
  if (arch === 'x64' && ['linux', 'win32'].includes(platform)) {
    return { platform, arch, assetPlatform: platform === 'win32' ? 'windows' : 'linux' };
  }
  return null;
};

/** Read binary headers only; no executable/library load. */
export const hasClangdTargetHeader = (command, target) => {
  const fd = fs.openSync(command, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 32 || stat.size > CLANGD_MAX_BINARY_BYTES) return false;
    const header = Buffer.alloc(4096);
    const read = fs.readSync(fd, header, 0, header.length, 0);
    if (target.platform === 'linux') {
      return read >= 20 && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
        && header[4] === 2 && header[5] === 1 && header.readUInt16LE(18) === 0x3e;
    }
    if (target.platform === 'win32') {
      if (read < 64 || header.readUInt16LE(0) !== 0x5a4d) return false;
      const pe = header.readUInt32LE(0x3c);
      return pe + 6 <= read && header.readUInt32LE(pe) === 0x4550 && header.readUInt16LE(pe + 4) === 0x8664;
    }
    if (target.platform !== 'darwin' || read < 8) return false;
    const cpu = target.arch === 'arm64' ? 0x0100000c : 0x01000007;
    const magic = header.readUInt32BE(0);
    if (magic === 0xfeedfacf) return header.readUInt32BE(4) === cpu;
    if (magic === 0xcffaedfe) return header.readUInt32LE(4) === cpu;
    const bigEndian = [0xcafebabe, 0xcafebabf].includes(magic);
    const littleEndian = [0xbebafeca, 0xbfbafeca].includes(magic);
    if (!bigEndian && !littleEndian) return false;
    const readInt = (offset) => bigEndian ? header.readUInt32BE(offset) : header.readUInt32LE(offset);
    const count = readInt(4);
    const stride = [0xcafebabf, 0xbfbafeca].includes(magic) ? 32 : 20;
    if (!count || count > 8 || 8 + count * stride > read) return false;
    for (let i = 0; i < count; i += 1) if (readInt(8 + i * stride) === cpu) return true;
    return false;
  } finally {
    fs.closeSync(fd);
  }
};

export const resolveManagedClangd = (toolingRoot, targetOptions = {}) => {
  const target = resolveClangdArchiveTarget(targetOptions);
  if (!toolingRoot || !target) return null;
  try {
    const physicalRoot = fs.realpathSync(toolingRoot);
    const cache = path.join(toolingRoot, 'servers', 'clangd');
    const receipt = JSON.parse(readManagedToolText(path.join(cache, 'current.json')));
    if (receipt?.schemaVersion !== 1 || receipt.family !== 'clangd' || receipt.indexUrl !== CLANGD_RELEASE_INDEX_URL
      || !/^\d+\.\d+\.\d+$/.test(receipt.version) || receipt.platform !== target.platform || receipt.arch !== target.arch
      || !/^[a-f0-9]{64}$/.test(receipt.archiveSha256) || !/^[a-f0-9]{64}$/.test(receipt.binarySha256)) return null;
    const filename = `clangd-${target.assetPlatform}-${receipt.version}.zip`;
    const sourceUrl = `https://github.com/clangd/clangd/releases/download/${receipt.version}/${filename}`;
    const packageKey = `${receipt.version}-${target.platform}-${target.arch}`;
    if (receipt.filename !== filename || receipt.sourceUrl !== sourceUrl || receipt.packageKey !== packageKey) return null;
    const packageRoot = path.join(cache, packageKey, `clangd_${receipt.version}`);
    const command = path.join(packageRoot, 'bin', target.platform === 'win32' ? 'clangd.exe' : 'clangd');
    const relative = path.relative(physicalRoot, fs.realpathSync(packageRoot));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || !fs.lstatSync(path.join(packageRoot, 'bin')).isDirectory()) return null;
    const commandRelative = path.relative(fs.realpathSync(packageRoot), fs.realpathSync(command));
    if (commandRelative.startsWith(`..${path.sep}`) || path.isAbsolute(commandRelative)) return null;
    if (!hasClangdTargetHeader(command, target) || hashManagedToolFile(command, CLANGD_MAX_BINARY_BYTES) !== receipt.binarySha256) return null;
    const resources = path.join(packageRoot, 'lib', 'clang', receipt.version.split('.')[0], 'include');
    const resourceRelative = path.relative(fs.realpathSync(packageRoot), fs.realpathSync(resources));
    if (!fs.lstatSync(resources).isDirectory() || !fs.readdirSync(resources).length
      || resourceRelative === '..' || resourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resourceRelative)) return null;
    return { ...receipt, packageRoot, command, binDir: path.join(packageRoot, 'bin'), resourceDir: resources };
  } catch {
    return null;
  }
};
