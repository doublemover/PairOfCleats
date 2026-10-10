import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const declarationNames = declaration => {
  const result = [];
  for (let node = declaration; node; node = node.parent) if (typeof node.name?.text === 'string') result.push(node.name.text);
  return result;
};
/** Authority comes from checker declarations and Program libraries, never callee spelling. */
export const createCompilerBoundaryAuthority = group => {
  const cache = new WeakMap(), sourceHashes = new WeakMap(), packageMetadata = new Map();
  const declaration = async node => {
    if (!node) return null;
    if (cache.has(node)) return cache.get(node);
    const sourceFile = node.getSourceFile(), filename = sourceFile.fileName.replaceAll('\\', '/');
    const names = declarationNames(node);
    let authority = null;
    if (group.isDefaultLibrary(sourceFile)) authority = { family: 'typescript-default-library', library: path.posix.basename(filename), names, packageName: 'typescript', packageVersion: group.context.compilerVersion };
    else {
      const marker = '/node_modules/@types/node/', index = filename.lastIndexOf(marker);
      if (index >= 0) {
        const packageRoot = filename.slice(0, index + marker.length - 1);
        if (!packageMetadata.has(packageRoot)) packageMetadata.set(packageRoot, Promise.resolve(group.compilerReadFile ? group.compilerReadFile(path.join(packageRoot, 'package.json')) : fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')).then(text => { if (typeof text !== 'string') return null; const value = JSON.parse(text.replace(/^\uFEFF/, '')); return value.name === '@types/node' && typeof value.version === 'string' ? { ...value, metadataHash: hash(text) } : null; }).catch(error => { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }));
        const metadata = await packageMetadata.get(packageRoot);
        const moduleName = names.find(name => ['child_process', 'node:child_process', 'events', 'node:events', 'timers', 'node:timers', 'module', 'node:module', 'process', 'node:process', 'url', 'node:url'].includes(name)) || null;
        if (metadata) authority = { family: 'node-type-package', library: filename.slice(index + marker.length), names, moduleName, packageName: metadata.name, packageVersion: metadata.version, packageMetadataHash: metadata.metadataHash };
      }
    }
    if (!sourceHashes.has(sourceFile)) sourceHashes.set(sourceFile, hash(sourceFile.text));
    if (authority) authority = { ...authority, path: filename, sourceHash: sourceHashes.get(sourceFile), declarationSpan: [node.getStart(sourceFile), node.end] };
    cache.set(node, authority); return authority;
  };
  const type = async (doc, node, expected) => {
    if (!node) return null;
    const input = doc.checker.getTypeAtLocation(node), alternatives = input.isUnion() ? input.types : [input], authorities = [];
    for (const alternative of alternatives) {
      const symbol = expected.includes(alternative.aliasSymbol?.name) ? alternative.aliasSymbol : alternative.symbol;
      if (!expected.includes(symbol?.name)) return null;
      let found = null;
      for (const candidate of symbol?.declarations || []) {
        const value = await declaration(candidate);
        if (value) { found = value; break; }
      }
      if (!found) return null;
      authorities.push(found);
    }
    return authorities;
  };
  return { declaration, type };
};
