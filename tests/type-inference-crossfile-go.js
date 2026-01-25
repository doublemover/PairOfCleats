#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(root, 'tests', '.cache', 'type-inference-crossfile-go');
const repoRoot = path.join(tempRoot, 'repo');
const hasPython = () => {
  const candidates = ['python', 'python3'];
  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ['-c', 'import sys; sys.stdout.write("ok")'], {
        encoding: 'utf8'
      });
      if (result.status === 0 && String(result.stdout || '').trim() === 'ok') return true;
    } catch {}
  }
  return false;
};
const pythonAvailable = hasPython();

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'widget.go'),
  `package sample

type GoWidget struct {
  ID int
}

func MakeGoWidget() GoWidget {
  return GoWidget{ID: 1}
}
`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'builder.go'),
  `package sample

func BuildGoWidget() GoWidget {
  return MakeGoWidget()
}
`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'lib.rs'),
  `pub struct RustWidget {
    pub id: i32,
}

pub fn make_rust_widget() -> RustWidget {
    return RustWidget { id: 1 };
}

pub fn build_rust_widget() -> RustWidget {
    return make_rust_widget();
}
`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'JavaWidget.java'),
  `package sample;

public class JavaWidget {
  public final int id = 1;
}
`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'JavaWidgetFactory.java'),
  `package sample;

public class JavaWidgetFactory {
  public static JavaWidget makeWidget() {
    return new JavaWidget();
  }
}
`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'JavaWidgetBuilder.java'),
  `package sample;

public class JavaWidgetBuilder {
  public static JavaWidget buildWidget() {
    return JavaWidgetFactory.makeWidget();
  }
}
`
);

if (pythonAvailable) {
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'py_widget.py'),
    `class PyWidget:
    def __init__(self):
        self.id = 1

def make_py_widget() -> PyWidget:
    return PyWidget()
`
  );

  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'py_builder.py'),
    `from py_widget import make_py_widget, PyWidget

def build_py_widget() -> PyWidget:
    return make_py_widget()
`
  );
}
const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({
    indexing: {
      typeInference: true,
      typeInferenceCrossFile: true
    }
  }),
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_TEST_CONFIG = env.PAIROFCLEATS_TEST_CONFIG;
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;

const result = spawnSync(process.execPath, [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], {
  cwd: repoRoot,
  env,
  stdio: 'inherit'
});
if (result.status !== 0) {
  console.error('Cross-file inference test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');
if (!fs.existsSync(chunkMetaPath)) {
  console.error(`Missing chunk meta at ${chunkMetaPath}`);
  process.exit(1);
}

const chunkMeta = JSON.parse(fs.readFileSync(chunkMetaPath, 'utf8'));
const fileMetaPath = path.join(codeDir, 'file_meta.json');
const fileMeta = fs.existsSync(fileMetaPath)
  ? JSON.parse(fs.readFileSync(fileMetaPath, 'utf8'))
  : [];
const fileById = new Map(
  (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
);
const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;

const buildGo = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/builder.go' &&
  chunk.name === 'BuildGoWidget'
);
if (!buildGo) {
  console.error('Missing BuildGoWidget chunk in builder.go.');
  process.exit(1);
}

const inferredGo = buildGo.docmeta?.inferredTypes?.returns || [];
if (!inferredGo.some((entry) => entry.type === 'GoWidget' && entry.source === 'flow')) {
  console.error('Go cross-file inference missing return type GoWidget for BuildGoWidget.');
  process.exit(1);
}

const buildRust = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/lib.rs' &&
  chunk.name === 'build_rust_widget'
);
if (!buildRust) {
  console.error('Missing build_rust_widget chunk in lib.rs.');
  process.exit(1);
}

const inferredRust = buildRust.docmeta?.inferredTypes?.returns || [];
if (!inferredRust.some((entry) => entry.type === 'RustWidget' && entry.source === 'flow')) {
  console.error('Rust cross-file inference missing return type RustWidget for build_rust_widget.');
  process.exit(1);
}

const buildJava = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/JavaWidgetBuilder.java' &&
  chunk.name === 'JavaWidgetBuilder.buildWidget'
);
if (!buildJava) {
  console.error('Missing JavaWidgetBuilder.buildWidget chunk in JavaWidgetBuilder.java.');
  process.exit(1);
}

const inferredJava = buildJava.docmeta?.inferredTypes?.returns || [];
if (!inferredJava.some((entry) => entry.type === 'JavaWidget' && entry.source === 'flow')) {
  console.error('Java cross-file inference missing return type JavaWidget for buildWidget.');
  process.exit(1);
}

if (pythonAvailable) {
  const buildPy = chunkMeta.find((chunk) =>
    resolveChunkFile(chunk) === 'src/py_builder.py' &&
    chunk.name === 'build_py_widget'
  );
  if (!buildPy) {
    console.error('Missing build_py_widget chunk in py_builder.py.');
    process.exit(1);
  }
  const inferredPy = buildPy.docmeta?.inferredTypes?.returns || [];
  if (!inferredPy.some((entry) => entry.type === 'PyWidget' && entry.source === 'flow')) {
    console.error('Python cross-file inference missing return type PyWidget for build_py_widget.');
    process.exit(1);
  }
} else {
  console.log('Skipping Python cross-file inference (python not available).');
}

console.log('Cross-file inference tests passed (Go/Rust/Java/Python).');
