#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../../../helpers/root.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { loadCodeChunkArtifacts } from './artifact-fixture.js';

const root = repoRoot();
const tempRoot = resolveTestCachePath(root, 'type-inference-crossfile-go');
const repoDir = path.join(tempRoot, 'repo');

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
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  }
});

const result = runNode([
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--stage',
  'stage2',
  '--mode',
  'code',
  '--repo',
  repoDir
], 'cross-file inference Go/Rust build index', repoDir, env, {
  stdio: 'inherit',
  allowFailure: true
});
if (result.status !== 0) {
  console.error('Cross-file inference test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const { chunkMeta, resolveChunkFile } = await loadCodeChunkArtifacts(repoDir, 'cross-file');

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

console.log('Cross-file inference tests passed (Go/Rust).');

