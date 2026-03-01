#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MAX_JSON_BYTES, loadChunkMeta, loadJsonArrayArtifact } from '../../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig, resolveToolRoot } from '../../../../tools/shared/dict-utils.js';
import { repoRoot } from '../../../helpers/root.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = repoRoot();
const tempRoot = resolveTestCachePath(root, 'type-inference-crossfile-go');
const repoDir = path.join(tempRoot, 'repo');
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
const hasPyright = () => {
  const toolRoot = resolveToolRoot();
  const candidates = process.platform === 'win32'
    ? ['pyright-langserver.cmd', 'pyright-langserver.exe', 'pyright-langserver']
    : ['pyright-langserver'];
  const searchDirs = [
    path.join(root, 'node_modules', '.bin'),
    toolRoot ? path.join(toolRoot, 'node_modules', '.bin') : null
  ].filter(Boolean);
  const canRun = (cmd) => {
    try {
      const result = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
      return result.status === 0;
    } catch {}
    return false;
  };
  for (const dir of searchDirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (!fsSync.existsSync(full)) continue;
      if (canRun(full)) return true;
    }
  }
  return canRun('pyright-langserver');
};
const pyrightAvailable = hasPyright();

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoDir, 'src'), { recursive: true });

await fsPromises.writeFile(
  path.join(repoDir, 'src', 'widget.go'),
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
  path.join(repoDir, 'src', 'builder.go'),
  `package sample

func BuildGoWidget() GoWidget {
  return MakeGoWidget()
}
`
);

await fsPromises.writeFile(
  path.join(repoDir, 'src', 'lib.rs'),
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
  path.join(repoDir, 'src', 'JavaWidget.java'),
  `package sample;

public class JavaWidget {
  public final int id = 1;
}
`
);

await fsPromises.writeFile(
  path.join(repoDir, 'src', 'JavaWidgetFactory.java'),
  `package sample;

public class JavaWidgetFactory {
  public static JavaWidget makeWidget() {
    return new JavaWidget();
  }
}
`
);

await fsPromises.writeFile(
  path.join(repoDir, 'src', 'JavaWidgetBuilder.java'),
  `package sample;

public class JavaWidgetBuilder {
  public static JavaWidget buildWidget() {
    return JavaWidgetFactory.makeWidget();
  }
}
`
);

if (pythonAvailable && pyrightAvailable) {
  await fsPromises.writeFile(
    path.join(repoDir, 'src', 'py_widget.py'),
    `class PyWidget:
    def __init__(self):
        self.id = 1

def make_py_widget() -> PyWidget:
    return PyWidget()
`
  );

  await fsPromises.writeFile(
    path.join(repoDir, 'src', 'py_builder.py'),
    `from py_widget import make_py_widget, PyWidget

def build_py_widget() -> PyWidget:
    return make_py_widget()
`
  );
}
const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      embeddings: { enabled: false },
      typeInference: true,
      typeInferenceCrossFile: true,
      treeSitter: {
        deferMissing: false
      }
    },
    tooling: {
      autoEnableOnDetect: false
    }
  }
});

const result = spawnSync(process.execPath, [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--stage',
  'stage2',
  '--mode',
  'code',
  '--repo',
  repoDir
], {
  cwd: repoDir,
  env,
  stdio: 'inherit'
});
if (result.status !== 0) {
  console.error('Cross-file inference test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoDir);
const codeDir = getIndexDir(repoDir, 'code', userConfig);
let chunkMeta = [];
let fileMeta = [];
try {
  chunkMeta = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  fileMeta = await loadJsonArrayArtifact(codeDir, 'file_meta', { maxBytes: MAX_JSON_BYTES, strict: true });
} catch (err) {
  console.error(`Failed to load cross-file artifacts at ${codeDir}: ${err?.message || err}`);
  process.exit(1);
}
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
const goSignature = String(buildGo.docmeta?.signature || '');
if (!goSignature.includes('GoWidget')) {
  console.error('Go cross-file inference missing GoWidget in BuildGoWidget signature.');
  process.exit(1);
}
const goCallLinks = buildGo.codeRelations?.callLinks || buildGo.metaV2?.relations?.callLinks || [];
if (!goCallLinks.some((link) => String(link?.to?.targetName || '').includes('MakeGoWidget'))) {
  console.error('Go cross-file inference missing resolved call link from BuildGoWidget to MakeGoWidget.');
  process.exit(1);
}
if (inferredGo.length > 0 && !inferredGo.some((entry) => entry.type === 'GoWidget')) {
  console.error('Go cross-file inference returned inferred types, but none include GoWidget.');
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
const rustSignature = String(buildRust.docmeta?.signature || '');
if (!rustSignature.includes('RustWidget')) {
  console.error('Rust cross-file inference missing RustWidget in build_rust_widget signature.');
  process.exit(1);
}
if (inferredRust.length > 0 && !inferredRust.some((entry) => entry.type === 'RustWidget')) {
  console.error('Rust cross-file inference returned inferred types, but none include RustWidget.');
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

if (pythonAvailable && pyrightAvailable) {
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
  const reason = !pythonAvailable ? 'python not available' : 'pyright not available';
  console.log(`Skipping Python cross-file inference (${reason}).`);
}

console.log('Cross-file inference tests passed (Go/Rust/Java/Python).');

