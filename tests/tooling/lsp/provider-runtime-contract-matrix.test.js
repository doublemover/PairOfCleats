#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
registerDefaultToolingProviders();

const makeTempRoot = async (name) => {
  const tempRoot = resolveTestCachePath(root, `${name}-${process.pid}-${Date.now()}`);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
  return tempRoot;
};

const runOutputShapeCase = async ({
  name,
  providerId,
  fileName,
  languageId,
  effectiveExt,
  text,
  extraFiles = [],
  extraAssert = () => {}
}) => {
  const tempRoot = await makeTempRoot(name);
  for (const [relativePath, contents] of extraFiles) {
    const abs = path.join(tempRoot, relativePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, contents, 'utf8');
  }
  await fs.writeFile(path.join(tempRoot, 'src', fileName), text, 'utf8');

  const provider = getToolingProvider(providerId);
  assert.ok(provider, `expected ${providerId} provider`);
  const ctx = {
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {},
    logger: () => {},
    strict: true
  };
  const virtualPath = `src/${fileName}`;
  const document = {
    virtualPath,
    effectiveExt,
    languageId,
    text,
    docHash: `doc-${providerId}`,
    containerPath: virtualPath
  };
  const target = {
    virtualPath,
    languageId,
    chunkRef: {
      chunkUid: `ck:test:${providerId}:1`,
      file: virtualPath,
      start: 0,
      end: 10
    },
    symbolHint: { name: 'alpha', kind: 'function' }
  };
  const output = await provider.run(ctx, { documents: [document], targets: [target, target] });
  assert.ok(output && typeof output === 'object');
  assert.ok(output.byChunkUid && typeof output.byChunkUid === 'object');
  assert.ok(!('byFile' in output));
  const duplicate = (output.diagnostics?.checks || []).find((check) => check.name === 'duplicate_chunk_uid');
  assert.ok(duplicate, `expected duplicate chunkUid warning for ${providerId}`);
  assert.ok(Array.isArray(duplicate.samples) && duplicate.samples[0]?.startsWith('ck:'));
  extraAssert(output);
};

const runCommandOverrideCase = async ({
  name,
  providerId,
  configKey,
  commandKey = 'cmd',
  fixtureBinary,
  fileName,
  languageId,
  effectiveExt,
  text,
  args = [],
  extraConfig = {},
  extraAssert = () => {}
}) => {
  const tempRoot = await makeTempRoot(name);
  const provider = getToolingProvider(providerId);
  assert.ok(provider, `expected ${providerId} provider`);

  const fixtureCmd = path.join(
    root,
    'tests',
    'fixtures',
    'lsp',
    'bin',
    process.platform === 'win32' ? `${fixtureBinary}.cmd` : fixtureBinary
  );
  await fs.access(fixtureCmd);

  const ctx = {
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      [configKey]: {
        [commandKey]: fixtureCmd,
        args,
        ...extraConfig
      }
    },
    logger: () => {},
    strict: true
  };

  const virtualPath = `src/${fileName}`;
  const document = {
    virtualPath,
    effectiveExt,
    languageId,
    text,
    docHash: `doc-${providerId}-override`,
    containerPath: virtualPath
  };
  const chunkUid = `ck:test:${providerId}-override:1`;
  const target = {
    virtualPath,
    languageId,
    chunkRef: {
      chunkUid,
      chunkId: `chunk_${providerId.replace(/[^a-z0-9]+/gi, '_')}_override`,
      file: virtualPath,
      start: 0,
      end: text.length
    },
    virtualRange: { start: 0, end: text.length },
    symbolHint: { name: 'alpha', kind: 'function' }
  };
  const output = await provider.run(ctx, { documents: [document], targets: [target] });
  assert.ok(output?.byChunkUid?.[chunkUid], `expected payload output for ${providerId}`);
  const runtimeCommand = output?.diagnostics?.runtime?.command || '';
  assert.equal(runtimeCommand.length > 0, true, 'expected runtime command');
  extraAssert({ output, fixtureCmd, runtimeCommand });
};

await runOutputShapeCase({
  name: 'clangd-provider-output-shape-matrix',
  providerId: 'clangd',
  fileName: 'one.c',
  languageId: 'c',
  effectiveExt: '.c',
  text: 'int alpha(void) { return 1; }\n'
});

await runOutputShapeCase({
  name: 'pyright-provider-output-shape-matrix',
  providerId: 'pyright',
  fileName: 'one.py',
  languageId: 'python',
  effectiveExt: '.py',
  text: 'def alpha():\n    return 1\n',
  extraFiles: [['pyproject.toml', '[project]\nname = "pyright-shape"\n']],
  extraAssert(output) {
    assert.equal(typeof output.diagnostics?.planning?.workspaceRootRel, 'string');
  }
});

await runOutputShapeCase({
  name: 'sourcekit-provider-output-shape-matrix',
  providerId: 'sourcekit',
  fileName: 'one.swift',
  languageId: 'swift',
  effectiveExt: '.swift',
  text: 'func alpha() -> Int { return 1 }\n'
});

await runOutputShapeCase({
  name: 'typescript-provider-output-shape-matrix',
  providerId: 'typescript',
  fileName: 'one.ts',
  languageId: 'typescript',
  effectiveExt: '.ts',
  text: 'export function alpha(): number { return 1; }\n'
});

await runCommandOverrideCase({
  name: 'clangd-provider-command-override-matrix',
  providerId: 'clangd',
  configKey: 'clangd',
  fixtureBinary: 'clangd',
  fileName: 'one.c',
  languageId: 'c',
  effectiveExt: '.c',
  text: 'int alpha(void) { return 1; }\n',
  args: ['--background-index=false', '--log=error'],
  extraAssert({ fixtureCmd, runtimeCommand }) {
    assert.equal(path.resolve(runtimeCommand), path.resolve(fixtureCmd));
  }
});

await runCommandOverrideCase({
  name: 'pyright-provider-command-override-matrix',
  providerId: 'pyright',
  configKey: 'pyright',
  commandKey: 'command',
  fixtureBinary: 'pyright-langserver',
  fileName: 'one.py',
  languageId: 'python',
  effectiveExt: '.py',
  text: 'def greet(name: str) -> str:\n    return "hi"\n',
  args: ['--stdio'],
  extraAssert({ output, runtimeCommand }) {
    const payload = output?.byChunkUid?.['ck:test:pyright-override:1']?.payload || null;
    assert.ok(payload);
    assert.equal(payload.returnType, 'str');
    assert.equal(payload.paramTypes?.name?.[0]?.type, 'str');
    assert.equal(path.basename(runtimeCommand).toLowerCase().startsWith('pyright-langserver'), true);
  }
});

await runCommandOverrideCase({
  name: 'sourcekit-provider-command-override-matrix',
  providerId: 'sourcekit',
  configKey: 'sourcekit',
  fixtureBinary: 'sourcekit-lsp',
  fileName: 'one.swift',
  languageId: 'swift',
  effectiveExt: '.swift',
  text: 'func alpha() -> Int { return 1 }\n',
  extraConfig: { hostConcurrencyGate: true },
  extraAssert({ output, fixtureCmd, runtimeCommand }) {
    assert.equal(path.resolve(runtimeCommand), path.resolve(fixtureCmd));
    assert.equal(output?.diagnostics?.runtime?.pooling?.enabled, false);
  }
});

console.log('LSP provider runtime contract matrix test passed');
