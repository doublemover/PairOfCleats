import fs from 'node:fs';
import path from 'node:path';
import { hashManagedToolFile as hashManagedGoFile, readManagedToolText as readManagedGoText } from './managed-tool-file.js';
import { normalizeEnvPathKeys, resolveEnvPath } from './env-path.js';

export const GO_RELEASE_INDEX_URL = 'https://go.dev/dl/?mode=json';
export const GO_ARCHIVE_ORIGIN = 'https://dl.google.com/go/';
const RELEASE_VERSION = /^go\d+\.\d+\.\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const resolveGoSdkTarget = ({ platform = process.platform, arch = process.arch } = {}) => {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform];
  const cpu = { x64: 'amd64', arm64: 'arm64', ia32: '386' }[arch];
  if (!os || !cpu || (os === 'darwin' && cpu === '386')) return null;
  return { os, arch: cpu, archiveType: os === 'windows' ? 'zip' : 'tar.gz' };
};

const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/** Managed cache discovery never grants repository execution authority. */
export const resolveManagedGoSdk = (toolingRoot, targetOptions = {}) => {
  const target = resolveGoSdkTarget(targetOptions);
  if (!toolingRoot || !target) return null;
  try {
    const physicalTooling = fs.realpathSync(toolingRoot);
    const cache = path.join(toolingRoot, 'sdk', 'go');
    if (!within(physicalTooling, fs.realpathSync(cache))) return null;
    const receipt = JSON.parse(readManagedGoText(path.join(cache, 'current.json')));
    if (receipt?.schemaVersion !== 1 || receipt.indexUrl !== GO_RELEASE_INDEX_URL
      || !RELEASE_VERSION.test(receipt.version) || receipt.os !== target.os || receipt.arch !== target.arch
      || !SHA256.test(receipt.archiveSha256) || !SHA256.test(receipt.goBinarySha256)) return null;
    const packageKey = `${receipt.version}-${target.os}-${target.arch}`;
    const filename = `${receipt.version}.${target.os}-${target.arch}.${target.archiveType}`;
    if (receipt.packageKey !== packageKey || receipt.filename !== filename
      || receipt.sourceUrl !== `${GO_ARCHIVE_ORIGIN}${filename}`
      || receipt.identity?.family !== 'go' || receipt.identity?.version !== receipt.version
      || receipt.identity?.platform !== target.os || receipt.identity?.arch !== target.arch) return null;
    const packageRoot = path.join(cache, packageKey);
    const goRoot = path.join(packageRoot, 'go');
    const physicalGoRoot = fs.realpathSync(goRoot);
    if (!within(physicalTooling, physicalGoRoot) || !within(fs.realpathSync(cache), physicalGoRoot)) return null;
    const command = path.join(goRoot, 'bin', target.os === 'windows' ? 'go.exe' : 'go');
    if (!(fs.lstatSync(path.join(goRoot, 'bin'))).isDirectory()
      || !within(physicalGoRoot, fs.realpathSync(command))) return null;
    if (hashManagedGoFile(command) !== receipt.goBinarySha256) return null;
    const versionText = readManagedGoText(path.join(goRoot, 'VERSION'), 4096);
    if (versionText?.split('\n')[0].trim() !== receipt.version) return null;
    for (const relativeFile of [target.os === 'windows' ? 'bin/gofmt.exe' : 'bin/gofmt', 'src/runtime/runtime.go']) {
      const stat = fs.lstatSync(path.join(goRoot, relativeFile));
      if (!stat.isFile() || stat.size <= 0) return null;
    }
    const compilerTools = path.join(goRoot, 'pkg', 'tool', `${target.os}_${target.arch}`);
    const tools = fs.readdirSync(compilerTools, { withFileTypes: true });
    if (!fs.lstatSync(compilerTools).isDirectory() || !tools.length || tools.some((entry) => !entry.isFile())) return null;
    return { ...receipt, goRoot, binDir: path.join(goRoot, 'bin'), command };
  } catch {
    return null;
  }
};

export const applyManagedGoEnvironment = (baseEnv, { toolingRoot, sdk = null } = {}) => {
  const managed = sdk || resolveManagedGoSdk(toolingRoot);
  const env = { ...(baseEnv || {}) };
  if (!managed) return env;
  const pathInfo = normalizeEnvPathKeys(env);
  env[pathInfo.key] = [managed.binDir, resolveEnvPath(env)].filter(Boolean).join(path.delimiter);
  env.GOROOT = managed.goRoot;
  // Keep preparation serial and forbid an implicit, unverified toolchain download.
  env.GOMAXPROCS = env.GOMAXPROCS || '1';
  env.GOTOOLCHAIN = env.GOTOOLCHAIN || 'local';
  env.GOPATH = env.GOPATH || path.join(toolingRoot, 'go-cache', 'modules');
  env.GOCACHE = env.GOCACHE || path.join(toolingRoot, 'go-cache', 'build');
  if (!/(?:^|\s)-p(?:=|\s)/.test(env.GOFLAGS || '')) env.GOFLAGS = `${env.GOFLAGS || ''} -p=1`.trim();
  return env;
};

export const isGoToolchainServer = ({ providerId = '', command = '' } = {}) => {
  const id = String(providerId).trim().toLowerCase();
  const name = path.basename(String(command)).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
  return ['gopls', 'lsp-gopls', 'sqls', 'lsp-sqls'].includes(id) || ['gopls', 'sqls'].includes(name);
};

export { hashManagedGoFile, readManagedGoText };
