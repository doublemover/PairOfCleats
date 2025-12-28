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

function hasPython() {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
}
const pythonAvailable = hasPython();

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

if (pythonAvailable) {
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

  const updateState = findChunk({ file: 'src/python_advanced.py', nameIncludes: 'update_state' });
  if (!updateState) {
    failures.push('Missing Python dataflow chunk (update_state).');
  } else {
    const mutations = updateState.docmeta?.dataflow?.mutations || [];
    if (!mutations.some((name) => name === 'state[]')) {
      failures.push('Python dataflow missing state[] mutation.');
    }
    const throws = updateState.docmeta?.throws || [];
    if (!throws.some((name) => String(name).includes('ValueError'))) {
      failures.push('Python throws metadata missing ValueError for update_state.');
    }
    if (!updateState.docmeta?.returnsValue) {
      failures.push('Python returnsValue missing for update_state.');
    }
  }

  const fetchData = findChunk({ file: 'src/python_advanced.py', nameIncludes: 'fetch_data' });
  if (!fetchData) {
    failures.push('Missing Python async chunk (fetch_data).');
  } else {
    if (!fetchData.docmeta?.async) {
      failures.push('Python async metadata missing for fetch_data.');
    }
    const awaits = fetchData.docmeta?.awaits || [];
    if (!awaits.some((name) => name === 'client.fetch')) {
      failures.push('Python await metadata missing client.fetch.');
    }
  }
} else {
  console.log('Skipping Python AST checks (python not available).');
}

const jsWidgetClass = chunkMeta.find((chunk) => {
  if (!chunk || chunk.file !== 'src/javascript_advanced.js') return false;
  if (chunk.name !== 'Widget') return false;
  return chunk.kind === 'ClassDeclaration' ||
    chunk.kind === 'ExportedClass' ||
    chunk.kind === 'ExportDefaultClassDeclaration';
});
if (!jsWidgetClass) {
  failures.push('Missing JS class chunk (Widget).');
} else {
  const bases = jsWidgetClass.docmeta?.extends || [];
  if (!bases.includes('BaseWidget')) {
    failures.push('JS class metadata missing BaseWidget extends.');
  }
}

const jsMakeWidget = findChunk({ file: 'src/javascript_advanced.js', nameIncludes: 'makeWidget' });
if (!jsMakeWidget) {
  failures.push('Missing JS function chunk (makeWidget).');
} else {
  const signature = jsMakeWidget.docmeta?.signature || '';
  if (!signature.includes('makeWidget')) {
    failures.push('JS docmeta missing signature for makeWidget.');
  }
  const paramDefaults = jsMakeWidget.docmeta?.paramDefaults || {};
  if (!Object.prototype.hasOwnProperty.call(paramDefaults, 'opts')) {
    failures.push('JS docmeta missing default param for makeWidget (opts).');
  }
}

const jsLoad = findChunk({ file: 'src/javascript_advanced.js', nameIncludes: 'Widget.load' });
if (!jsLoad) {
  failures.push('Missing JS async method chunk (Widget.load).');
} else {
  if (!jsLoad.docmeta?.modifiers?.async) {
    failures.push('JS async modifier missing for Widget.load.');
  }
  const awaits = jsLoad.docmeta?.awaits || [];
  if (!awaits.some((name) => name === 'fetchData')) {
    failures.push('JS dataflow missing awaited fetchData call.');
  }
  const throws = jsLoad.docmeta?.throws || [];
  if (!throws.some((name) => name === 'Error')) {
    failures.push('JS throws metadata missing Error for Widget.load.');
  }
}

const jsUpdate = findChunk({ file: 'src/javascript_advanced.js', nameIncludes: 'Widget.update' });
if (!jsUpdate) {
  failures.push('Missing JS method chunk (Widget.update).');
} else {
  const mutations = jsUpdate.docmeta?.dataflow?.mutations || [];
  if (!mutations.some((name) => name === 'this.count')) {
    failures.push('JS dataflow missing mutation for this.count.');
  }
}

if (!findChunk({ file: 'src/swift_advanced.swift', kind: 'MethodDeclaration', nameIncludes: 'Box.isEqual' })) {
  failures.push('Missing Swift extension method chunk (Box.isEqual).');
}

const boxChunk = findChunk({ file: 'src/swift_advanced.swift', kind: 'StructDeclaration', nameIncludes: 'Box' });
if (!boxChunk) {
  failures.push('Missing Swift generic struct chunk (Box).');
} else {
  const generics = boxChunk.docmeta?.generics || [];
  if (!generics.includes('T')) {
    failures.push('Swift generics missing for Box (expected T).');
  }
}

const boxExtension = findChunk({ file: 'src/swift_advanced.swift', kind: 'ExtensionDeclaration', nameIncludes: 'Box' });
if (!boxExtension) {
  failures.push('Missing Swift extension declaration chunk (Box).');
} else {
  const whereClause = boxExtension.docmeta?.whereClause || '';
  if (!whereClause.includes('T: Equatable')) {
    failures.push('Swift extension where clause missing (expected T: Equatable).');
  }
}

const objcMethod = findChunk({ file: 'src/objc_advanced.m', kind: 'MethodDeclaration', nameIncludes: 'OCGreeter.objcGreet' });
if (!objcMethod) {
  failures.push('Missing ObjC method chunk (OCGreeter.objcGreet:).');
}

const objcCaller = findChunk({ file: 'src/objc_advanced.m', kind: 'FunctionDeclaration', nameIncludes: 'use_add_numbers' });
if (!objcCaller) {
  failures.push('Missing ObjC/C helper function chunk (use_add_numbers).');
} else {
  const calls = objcCaller.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'add_numbers')) {
    failures.push('ObjC/C call graph missing add_numbers call.');
  }
}

if (!findChunk({ file: 'src/rust_advanced.rs', kind: 'MethodDeclaration', nameIncludes: 'Widget.render' })) {
  failures.push('Missing Rust method chunk (Widget.render).');
}

if (!findChunk({ file: 'src/rust_advanced.rs', kind: 'MethodDeclaration', nameIncludes: 'Widget.new' })) {
  failures.push('Missing Rust impl method chunk (Widget.new).');
}

if (!findChunk({ file: 'src/rust_advanced.rs', kind: 'MacroDeclaration', nameIncludes: 'make_widget' })) {
  failures.push('Missing Rust macro chunk (make_widget).');
}

if (!findChunk({ file: 'src/cpp_advanced.cpp', kind: 'FunctionDeclaration', nameIncludes: 'addValues' })) {
  failures.push('Missing C++ template function chunk (addValues).');
}

const cppCaller = findChunk({ file: 'src/cpp_advanced.cpp', kind: 'FunctionDeclaration', nameIncludes: 'useAdd' });
if (!cppCaller) {
  failures.push('Missing C++ helper function chunk (useAdd).');
} else {
  const calls = cppCaller.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'addValues')) {
    failures.push('C++ call graph missing addValues call.');
  }
}

const goMethod = findChunk({ file: 'src/go_advanced.go', kind: 'MethodDeclaration', nameIncludes: 'Widget.Render' });
if (!goMethod) {
  failures.push('Missing Go method chunk (Widget.Render).');
}

const goFunc = findChunk({ file: 'src/go_advanced.go', kind: 'FunctionDeclaration', nameIncludes: 'MakeWidget' });
if (!goFunc) {
  failures.push('Missing Go function chunk (MakeWidget).');
} else {
  const calls = goFunc.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'strings.TrimSpace' || callee === 'TrimSpace')) {
    failures.push('Go call graph missing strings.TrimSpace call.');
  }
}

const javaMethod = findChunk({ file: 'src/java_advanced.java', kind: 'MethodDeclaration', nameIncludes: 'Box.add' });
if (!javaMethod) {
  failures.push('Missing Java method chunk (Box.add).');
} else {
  const imports = javaMethod.codeRelations?.imports || [];
  if (!imports.some((imp) => imp === 'java.util.List')) {
    failures.push('Java import capture missing java.util.List.');
  }
}

const perlSub = findChunk({ file: 'src/perl_advanced.pl', kind: 'FunctionDeclaration', nameIncludes: 'encode_payload' });
if (!perlSub) {
  failures.push('Missing Perl sub chunk (encode_payload).');
} else {
  const calls = perlSub.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'JSON::PP::encode_json' || callee === 'encode_json')) {
    failures.push('Perl call graph missing JSON::PP::encode_json call.');
  }
}

const shellFunc = findChunk({ file: 'src/shell_advanced.sh', kind: 'FunctionDeclaration', nameIncludes: 'build_index' });
if (!shellFunc) {
  failures.push('Missing shell function chunk (build_index).');
} else {
  const calls = shellFunc.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'grep')) {
    failures.push('Shell call graph missing grep call.');
  }
}

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('language fidelity test passed');
