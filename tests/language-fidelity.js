#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const cacheRoot = path.join(root, 'tests', '.cache', 'language-fidelity');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: fixtureRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run([path.join(root, 'build_index.js'), '--stub-embeddings'], 'build index');

const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');
if (!fs.existsSync(chunkMetaPath)) {
  console.error(`Missing chunk meta at ${chunkMetaPath}`);
  process.exit(1);
}

const chunkMeta = JSON.parse(fs.readFileSync(chunkMetaPath, 'utf8'));

function findChunk(match) {
  return chunkMeta.find((chunk) => {
    if (!chunk || !chunk.file) return false;
    if (match.file && chunk.file !== match.file) return false;
    if (match.kind && chunk.kind !== match.kind) return false;
    if (match.nameIncludes && !String(chunk.name || '').includes(match.nameIncludes)) return false;
    return true;
  });
}

const failures = [];

const pointChunk = findChunk({ file: 'src/python_advanced.py', kind: 'ClassDeclaration', nameIncludes: 'Point' });
if (!pointChunk) {
  failures.push('Missing Python dataclass chunk (Point).');
} else {
  const fields = pointChunk.docmeta?.fields || [];
  const fieldNames = fields.map((field) => field.name);
  if (!fieldNames.includes('x') || !fieldNames.includes('y')) {
    failures.push('Python dataclass fields missing for Point (expected x,y).');
  }
}

if (!findChunk({ file: 'src/python_advanced.py', nameIncludes: 'outer.inner' })) {
  failures.push('Missing nested function chunk (outer.inner).');
}

if (!findChunk({ file: 'src/python_advanced.py', nameIncludes: 'Point.distance.sq' })) {
  failures.push('Missing nested method helper chunk (Point.distance.sq).');
}

if (!findChunk({ file: 'src/swift_advanced.swift', kind: 'MethodDeclaration', nameIncludes: 'Box.isEqual' })) {
  failures.push('Missing Swift extension method chunk (Box.isEqual).');
}

const objcMethod = findChunk({ file: 'src/objc_advanced.m', kind: 'MethodDeclaration', nameIncludes: 'OCGreeter.objcGreet' });
if (!objcMethod) {
  failures.push('Missing ObjC method chunk (OCGreeter.objcGreet:).');
}

if (!findChunk({ file: 'src/rust_advanced.rs', kind: 'MethodDeclaration', nameIncludes: 'Widget.render' })) {
  failures.push('Missing Rust method chunk (Widget.render).');
}

if (!findChunk({ file: 'src/cpp_advanced.cpp', kind: 'FunctionDeclaration', nameIncludes: 'addValues' })) {
  failures.push('Missing C++ template function chunk (addValues).');
}

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('language fidelity test passed');
