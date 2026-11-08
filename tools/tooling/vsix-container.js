import fs from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import AdmZip from 'adm-zip';
import { parse } from 'acorn';
import { buildDeterministicZipFromEntries } from './archive-determinism.js';

const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const fail = (message) => { throw new Error(`Invalid VSIX: ${message}`); };
const safePath = (value) => typeof value === 'string' && value.length > 0
  && !value.includes('\\') && !value.includes('\0') && !path.posix.isAbsolute(value)
  && !path.win32.isAbsolute(value)
  && value.split('/').every((part) => part && part !== '.' && part !== '..');

const localRequires = (source, filename) => {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const required = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier'
      && node.callee.name === 'require') {
      const argument = node.arguments?.[0];
      if (node.arguments.length !== 1 || argument?.type !== 'Literal' || typeof argument.value !== 'string') {
        fail(`dynamic require cannot be qualified in ${filename}`);
      }
      required.push(argument.value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(tree);
  return required;
};

/** Structural qualification of the actual VSIX, independent of its sidecar. */
export const validateVsixContainer = async (archivePath) => {
  const zip = new AdmZip(archivePath);
  const files = new Map();
  const identities = new Set();
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (entry.isDirectory) continue;
    const mode = Number(entry.header?.attr || 0) >>> 16;
    if (!safePath(name) || identities.has(name.toLowerCase()) || (mode & 0o170000) === 0o120000) {
      fail(`unsafe or duplicate entry ${name}`);
    }
    identities.add(name.toLowerCase());
    files.set(name, entry.getData());
  }
  const read = (name) => {
    if (!files.has(name)) fail(`missing ${name}`);
    return files.get(name).toString('utf8');
  };
  const { parseStringPromise } = await import('xml2js');
  const parseXml = async (name) => {
    const text = read(name);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail(`unsupported XML declaration in ${name}`);
    try { return await parseStringPromise(text, { explicitArray: false, strict: true }); }
    catch (error) { fail(`${name}: ${error.message}`); }
  };
  const metadata = (await parseXml('extension.vsixmanifest'))?.PackageManifest;
  const types = (await parseXml('[Content_Types].xml'))?.Types;
  let manifest;
  try { manifest = JSON.parse(read('extension/package.json')); }
  catch (error) { fail(`package.json: ${error.message}`); }
  const identity = metadata?.Metadata?.Identity?.$;
  if (!identity || identity.Id !== manifest.name || identity.Version !== manifest.version
    || identity.Publisher !== manifest.publisher) fail('manifest identity differs from package.json');
  const engine = array(metadata?.Metadata?.Properties?.Property)
    .find((property) => property?.$?.Id === 'Microsoft.VisualStudio.Code.Engine')?.$?.Value;
  if (typeof engine !== 'string' || !engine || engine !== manifest.engines?.vscode) {
    fail('engine compatibility differs from package.json');
  }
  const assets = array(metadata?.Assets?.Asset);
  const packageAsset = assets.find((asset) => asset?.$?.Type === 'Microsoft.VisualStudio.Code.Manifest');
  if (packageAsset?.$?.Path !== 'extension/package.json') fail('package manifest asset is missing or misdirected');
  for (const asset of assets) {
    if (!safePath(asset?.$?.Path) || !files.has(asset.$.Path)) fail(`missing asset ${asset?.$?.Path}`);
  }
  // The pinned official packager emits dotted extensions (including
  // .vsixmanifest); readers may also receive the equivalent undotted spelling.
  const defaults = new Map(array(types?.Default).map((entry) => [entry?.$?.Extension?.replace(/^\./u, '').toLowerCase(), entry?.$?.ContentType]));
  const overrides = new Map(array(types?.Override).map((entry) => [entry?.$?.PartName, entry?.$?.ContentType]));
  if (!types || (!defaults.get('vsixmanifest') && !overrides.get('/extension.vsixmanifest'))) {
    fail('content types do not describe the VSIX manifest');
  }
  for (const filename of files.keys()) {
    if (filename === '[Content_Types].xml') continue;
    const extension = path.posix.extname(filename).slice(1).toLowerCase();
    if (!defaults.get(extension) && !overrides.get(`/${filename}`)) fail(`missing content type for ${filename}`);
  }
  const main = typeof manifest.main === 'string' ? manifest.main.replace(/^\.\//, '') : '';
  if (!safePath(main)) fail('missing or unsafe runtime entrypoint');
  const pending = [`extension/${main}`];
  const visited = new Set();
  const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`), 'vscode']);
  while (pending.length) {
    const filename = pending.pop();
    if (visited.has(filename)) continue;
    visited.add(filename);
    const source = read(filename);
    if (filename.endsWith('.json')) { JSON.parse(source); continue; }
    for (const request of localRequires(source, filename)) {
      if (builtins.has(request)) continue;
      if (!request.startsWith('./') && !request.startsWith('../')) fail(`unbundled dependency ${request} in ${filename}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(filename), request));
      if (!target.startsWith('extension/') || !safePath(target)) fail(`escaping runtime dependency ${request}`);
      const resolved = [target, `${target}.js`, `${target}.json`, `${target}/index.js`].find((name) => files.has(name));
      if (!resolved) fail(`missing runtime module ${request} in ${filename}`);
      pending.push(resolved);
    }
  }
  return { extensionId: `${manifest.publisher}.${manifest.name}`, version: manifest.version, engine, runtimeModules: visited.size };
};

/** Use the pinned official packager, then normalize its entire output. */
export const buildVsixContainer = async ({ sourceDir, archivePath }) => {
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  const temporary = await fs.mkdtemp(path.join(path.dirname(archivePath), '.vsix-'));
  try {
    const { createVSIX } = await import('@vscode/vsce');
    const original = path.join(temporary, 'official.vsix');
    await createVSIX({ cwd: sourceDir, packagePath: original, dependencies: false, useYarn: false, skipLicense: true });
    const official = new AdmZip(original);
    const files = official.getEntries().filter((entry) => !entry.isDirectory).map((entry) => {
      const mode = Number(entry.header?.attr || 0) >>> 16;
      if ((mode & 0o170000) === 0o120000) fail(`symlink entry ${entry.entryName}`);
      return { path: entry.entryName, content: entry.getData(), mode };
    });
    const candidate = path.join(temporary, 'normalized.vsix');
    const built = await buildDeterministicZipFromEntries({ files, archivePath: candidate });
    const container = await validateVsixContainer(candidate);
    await fs.copyFile(candidate, archivePath);
    return { ...built, archivePath: path.resolve(archivePath), container };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
};
