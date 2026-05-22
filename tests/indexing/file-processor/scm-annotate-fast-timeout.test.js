#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveScmConfig } from '../../../src/index/scm/registry.js';
import { getLanguageForFile, processScmFile, readFixture } from './scm-file-processor-test-helper.js';

const yaml = await readFixture('tests', 'fixtures', 'mixed', 'src', 'config.yml');
let yamlAnnotateCalls = 0;
let yamlTimeoutMs = null;
let yamlMetaTimeoutMs = null;
let yamlIncludeChurn = null;
const yamlScmProvider = {
  async getFileMeta(args) {
    yamlMetaTimeoutMs = args?.timeoutMs ?? null;
    yamlIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    yamlAnnotateCalls += 1;
    yamlTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};

await processScmFile({
  ...yaml,
  scmProviderImpl: yamlScmProvider,
  fileHash: 'scm-annotate-fast-timeout-yml'
});
assert.equal(yamlAnnotateCalls, 1, 'expected annotate to run for .yml files');
assert.equal(yamlTimeoutMs, 5000, 'expected .yml annotate timeout to clamp to 5000ms by default');
assert.equal(yamlMetaTimeoutMs, 250, 'expected .yml meta timeout to clamp to 250ms by default');
assert.equal(yamlIncludeChurn, false, 'expected fast-path .yml churn metadata to be disabled');

const js = await readFixture('tests', 'fixtures', 'tree-sitter', 'javascript.js');
let jsAnnotateCalls = 0;
let jsTimeoutMs = null;
let jsMetaTimeoutMs = null;
let jsIncludeChurn = null;
const jsScmProvider = {
  async getFileMeta(args) {
    jsMetaTimeoutMs = args?.timeoutMs ?? null;
    jsIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    jsAnnotateCalls += 1;
    jsTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};

await processScmFile({
  ...js,
  scmProviderImpl: jsScmProvider,
  fileHash: 'scm-annotate-fast-timeout-js'
});
assert.equal(jsAnnotateCalls, 1, 'expected annotate to run for .js files');
assert.equal(jsTimeoutMs, 5000, 'expected non-metadata annotate timeout to clamp to 5000ms');
assert.equal(jsMetaTimeoutMs, 750, 'expected non-metadata meta timeout to clamp to 750ms');
assert.equal(jsIncludeChurn, true, 'expected non-fast-path churn metadata enabled by default');

const javaRelKey = 'src/org/example/LargeAssertions.java';
const javaText = `${Array.from({ length: 600 }, (_, i) => `class JavaFastPathLine${i} {}`).join('\n')}\n`;
const javaStat = { size: Buffer.byteLength(javaText, 'utf8') };
const javaLanguageHint = getLanguageForFile('.java', javaRelKey);
let javaAnnotateCalls = 0;
let javaTimeoutMs = null;
let javaMetaTimeoutMs = null;
let javaIncludeChurn = null;
const javaScmProvider = {
  async getFileMeta(args) {
    javaMetaTimeoutMs = args?.timeoutMs ?? null;
    javaIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    javaAnnotateCalls += 1;
    javaTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  abs: js.abs,
  ext: '.java',
  rel: javaRelKey,
  relKey: javaRelKey,
  text: javaText,
  fileStat: javaStat,
  languageHint: javaLanguageHint,
  scmProviderImpl: javaScmProvider,
  fileHash: 'scm-annotate-fast-timeout-java'
});
assert.equal(javaAnnotateCalls, 1, 'expected annotate to run for .java files');
assert.equal(javaTimeoutMs, 5000, 'expected .java annotate timeout to clamp for large Java files');
assert.equal(javaMetaTimeoutMs, 250, 'expected .java meta timeout to clamp for large Java files');
assert.equal(javaIncludeChurn, false, 'expected fast-path large .java churn metadata to be disabled');

const heavyRelKey = 'include/fmt/base.h';
const heavyText = `${Array.from({ length: 500 }, (_, i) => `int heavy_path_timeout_${i};`).join('\n')}\n`;
const heavyStat = { size: Buffer.byteLength(heavyText, 'utf8') };
const heavyLanguageHint = getLanguageForFile('.h', heavyRelKey);
let heavyAnnotateCalls = 0;
let heavyTimeoutMs = null;
let heavyMetaTimeoutMs = null;
let heavyIncludeChurn = null;
const heavyScmProvider = {
  async getFileMeta(args) {
    heavyMetaTimeoutMs = args?.timeoutMs ?? null;
    heavyIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    heavyAnnotateCalls += 1;
    heavyTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  abs: js.abs,
  ext: '.h',
  rel: heavyRelKey,
  relKey: heavyRelKey,
  text: heavyText,
  fileStat: heavyStat,
  languageHint: heavyLanguageHint,
  scmProviderImpl: heavyScmProvider,
  fileHash: 'scm-annotate-fast-timeout-heavy-path'
});
assert.equal(heavyAnnotateCalls, 1, 'expected annotate to run for heavy include paths');
assert.equal(heavyTimeoutMs, 5000, 'expected heavy include paths to use 5s annotate timeout cap');
assert.equal(heavyMetaTimeoutMs, 250, 'expected heavy include paths to keep fast metadata timeout cap');
assert.equal(heavyIncludeChurn, false, 'expected heavy include paths to keep churn disabled on fast path');

const swift = await readFixture('tests', 'fixtures', 'tree-sitter', 'swift.swift');
let swiftAnnotateCalls = 0;
let swiftTimeoutMs = null;
let swiftMetaTimeoutMs = null;
const swiftScmProvider = {
  async getFileMeta(args) {
    swiftMetaTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false };
  },
  async annotate(args) {
    swiftAnnotateCalls += 1;
    swiftTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...swift,
  scmProviderImpl: swiftScmProvider,
  fileHash: 'scm-annotate-fast-timeout-swift'
});
assert.equal(swiftAnnotateCalls, 1, 'expected annotate to run for .swift files');
assert.equal(swiftTimeoutMs, 5000, 'expected .swift annotate timeout to clamp to 5000ms');
assert.equal(swiftMetaTimeoutMs, 250, 'expected .swift meta timeout to clamp to 250ms');

const py = await readFixture('tests', 'fixtures', 'sample', 'src', 'sample.py');
let pyAnnotateCalls = 0;
let pyTimeoutMs = null;
let pyMetaTimeoutMs = null;
let pyIncludeChurn = null;
const pyScmProvider = {
  async getFileMeta(args) {
    pyMetaTimeoutMs = args?.timeoutMs ?? null;
    pyIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    pyAnnotateCalls += 1;
    pyTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...py,
  scmProviderImpl: pyScmProvider,
  fileHash: 'scm-annotate-fast-timeout-py'
});
assert.equal(pyAnnotateCalls, 1, 'expected annotate to run for .py files');
assert.equal(pyTimeoutMs, 5000, 'expected .py annotate timeout to clamp to 5000ms');
assert.equal(pyMetaTimeoutMs, 250, 'expected .py meta timeout to clamp to 250ms');
assert.equal(pyIncludeChurn, false, 'expected fast-path .py churn metadata to be disabled');

let pyGeneratedMetaCalls = 0;
let pyGeneratedAnnotateCalls = 0;
const pyGeneratedScmProvider = {
  async getFileMeta() {
    pyGeneratedMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    pyGeneratedAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const pyGeneratedRelKey = 'pygments/lexers/_lasso_builtins.py';
await processScmFile({
  abs: py.abs,
  ext: '.py',
  rel: pyGeneratedRelKey,
  relKey: pyGeneratedRelKey,
  text: py.text,
  fileStat: py.fileStat,
  languageHint: getLanguageForFile('.py', pyGeneratedRelKey),
  scmProviderImpl: pyGeneratedScmProvider,
  fileHash: 'scm-annotate-fast-timeout-py-generated'
});
assert.equal(pyGeneratedMetaCalls, 1, 'expected generated python files to keep SCM file metadata');
assert.equal(pyGeneratedAnnotateCalls, 0, 'expected generated python files to skip SCM annotate');

let legacyMetaIgnoredIncludeChurn = null;
const legacyMetaIgnoredScmProvider = {
  async getFileMeta(args) {
    legacyMetaIgnoredIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate() {
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...js,
  scmProviderImpl: legacyMetaIgnoredScmProvider,
  fileHash: 'scm-annotate-fast-timeout-ignore-legacy-meta',
  scmConfig: { annotate: {}, meta: { includeChurn: false } }
});
assert.equal(
  legacyMetaIgnoredIncludeChurn,
  true,
  'expected legacy scm meta.includeChurn to be ignored under hard-cut SCM churn policy'
);

let policyOverrideIncludeChurn = null;
const policyOverrideScmProvider = {
  async getFileMeta(args) {
    policyOverrideIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate() {
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...js,
  scmProviderImpl: policyOverrideScmProvider,
  fileHash: 'scm-annotate-fast-timeout-policy-override',
  scmConfig: { annotate: {}, meta: { includeChurn: false } },
  analysisPolicy: { git: { churn: true } }
});
assert.equal(
  policyOverrideIncludeChurn,
  true,
  'expected analysis policy git.churn=true to enable churn metadata'
);

let explicitTimeoutMs = null;
let explicitMetaTimeoutMs = null;
let explicitIncludeChurn = null;
const explicitScmProvider = {
  async getFileMeta(args) {
    explicitMetaTimeoutMs = args?.timeoutMs ?? null;
    explicitIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    explicitTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...yaml,
  scmProviderImpl: explicitScmProvider,
  fileHash: 'scm-annotate-fast-timeout-explicit',
  scmConfig: { timeoutMs: 333, annotate: { timeoutMs: 4321 } },
  analysisPolicy: { git: { churn: false } }
});
assert.equal(explicitTimeoutMs, 4321, 'expected explicit annotate timeout to respect 5000ms fast-path cap');
assert.equal(explicitMetaTimeoutMs, 250, 'expected explicit meta timeout to still respect fast-path clamp');
assert.equal(explicitIncludeChurn, false, 'expected churn flag to respect analysis policy');

let allowSlowTimeoutMs = null;
let allowSlowMetaTimeoutMs = null;
const allowSlowScmProvider = {
  async getFileMeta(args) {
    allowSlowMetaTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false };
  },
  async annotate(args) {
    allowSlowTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...yaml,
  scmProviderImpl: allowSlowScmProvider,
  fileHash: 'scm-annotate-fast-timeout-allow-slow',
  scmConfig: {
    allowSlowTimeouts: true,
    timeoutMs: 333,
    annotate: { timeoutMs: 4321 }
  }
});
assert.equal(allowSlowTimeoutMs, 4321, 'expected allowSlowTimeouts to permit explicit annotate timeout');
assert.equal(allowSlowMetaTimeoutMs, 333, 'expected allowSlowTimeouts to permit explicit meta timeout');

let batchDefaultMetaTimeoutMs = null;
let batchDefaultAnnotateTimeoutMs = null;
const batchDefaultScmProvider = {
  async getFileMeta(args) {
    batchDefaultMetaTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false };
  },
  async annotate(args) {
    batchDefaultAnnotateTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...yaml,
  scmProviderImpl: batchDefaultScmProvider,
  fileHash: 'scm-annotate-fast-timeout-batch-default',
  scmConfig: resolveScmConfig({
    indexingConfig: {},
    analysisPolicy: null,
    workload: 'batch'
  })
});
assert.equal(
  batchDefaultMetaTimeoutMs,
  10000,
  'expected batch SCM policy to use slower metadata default when fast caps are disabled'
);
assert.equal(
  batchDefaultAnnotateTimeoutMs,
  10000,
  'expected batch SCM policy to keep default annotate timeout when fast caps are disabled'
);

let forcedCapAnnotateTimeoutMs = null;
let forcedCapMetaTimeoutMs = null;
const forcedCapScmProvider = {
  async getFileMeta(args) {
    forcedCapMetaTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false };
  },
  async annotate(args) {
    forcedCapAnnotateTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
const forcedCapRelKey = 'test/Sema/exhaustive_switch.swift';
await processScmFile({
  abs: swift.abs,
  ext: '.swift',
  rel: forcedCapRelKey,
  relKey: forcedCapRelKey,
  text: swift.text,
  fileStat: swift.fileStat,
  languageHint: getLanguageForFile('.swift', forcedCapRelKey),
  scmProviderImpl: forcedCapScmProvider,
  fileHash: 'scm-annotate-fast-timeout-force-cap',
  scmConfig: {
    allowSlowTimeouts: true,
    timeoutMs: 12000,
    annotate: { timeoutMs: 15000 }
  }
});
assert.equal(
  forcedCapAnnotateTimeoutMs,
  5000,
  'expected benchmark hotspot paths to keep fast annotate timeout caps even with allowSlowTimeouts'
);
assert.equal(
  forcedCapMetaTimeoutMs,
  250,
  'expected benchmark hotspot paths to keep fast metadata timeout caps even with allowSlowTimeouts'
);

let scmRunIoCalls = 0;
let scmRunProcCalls = 0;
const scmRunIoProvider = {
  async getFileMeta() {
    return { ok: false };
  },
  async annotate() {
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  ...yaml,
  scmProviderImpl: scmRunIoProvider,
  fileHash: 'scm-annotate-fast-timeout-runio',
  runIo: async (fn) => {
    scmRunIoCalls += 1;
    return fn();
  },
  runProc: async (fn) => {
    scmRunProcCalls += 1;
    return fn();
  },
});
assert.equal(scmRunIoCalls, 0, 'expected SCM metadata/blame to avoid shared runIo queue');
assert.equal(scmRunProcCalls, 2, 'expected SCM metadata/blame to use runProc queueing');

let docsCodeMetaCalls = 0;
let docsCodeAnnotateCalls = 0;
const docsCodeScmProvider = {
  async getFileMeta() {
    docsCodeMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    docsCodeAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const docsCodeRelKey = 'docs/examples/main.go';
await processScmFile({
  abs: js.abs,
  ext: '.go',
  rel: docsCodeRelKey,
  relKey: docsCodeRelKey,
  text: [
    'package main',
    'func main() { helper() }',
    'func helper() {}'
  ].join('\n'),
  fileStat: js.fileStat,
  languageHint: getLanguageForFile('.go', docsCodeRelKey),
  scmProviderImpl: docsCodeScmProvider,
  fileHash: 'scm-annotate-fast-timeout-docs-code'
});
assert.equal(docsCodeMetaCalls, 1, 'expected docs code files to keep SCM metadata');
assert.equal(docsCodeAnnotateCalls, 1, 'expected docs code files to keep SCM annotate');

let docsProseModeMetaCalls = 0;
let docsProseModeAnnotateCalls = 0;
const docsProseModeScmProvider = {
  async getFileMeta() {
    docsProseModeMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    docsProseModeAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const docsProseModeRelKey = 'docs/reference/index.html';
await processScmFile({
  mode: 'prose',
  abs: yaml.abs,
  ext: '.html',
  rel: docsProseModeRelKey,
  relKey: docsProseModeRelKey,
  text: '<html><body>Docs</body></html>',
  fileStat: yaml.fileStat,
  languageHint: getLanguageForFile('.html', docsProseModeRelKey),
  scmProviderImpl: docsProseModeScmProvider,
  fileHash: 'scm-annotate-fast-timeout-docs-prose-mode'
});
assert.equal(
  docsProseModeMetaCalls,
  1,
  'expected prose docs files to keep SCM file metadata'
);
assert.equal(
  docsProseModeAnnotateCalls,
  0,
  'expected prose docs files to skip SCM annotate'
);

let proseTxtMetaCalls = 0;
let proseTxtAnnotateCalls = 0;
const proseTxtScmProvider = {
  async getFileMeta() {
    proseTxtMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    proseTxtAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const proseTxtRelKey = 'test/stdlib/Inputs/NormalizationTest.txt';
await processScmFile({
  mode: 'prose',
  abs: yaml.abs,
  ext: '.txt',
  rel: proseTxtRelKey,
  relKey: proseTxtRelKey,
  text: 'A\nB\nC\n',
  fileStat: { size: 6 },
  languageHint: getLanguageForFile('.txt', proseTxtRelKey),
  scmProviderImpl: proseTxtScmProvider,
  fileHash: 'scm-annotate-fast-timeout-prose-txt'
});
assert.equal(proseTxtMetaCalls, 1, 'expected prose text files to keep SCM metadata');
assert.equal(proseTxtAnnotateCalls, 0, 'expected prose text files to skip SCM annotate by default');

let docsProseMetaCalls = 0;
let docsProseAnnotateCalls = 0;
const docsProseScmProvider = {
  async getFileMeta() {
    docsProseMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    docsProseAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const docsProseRelKey = 'docs/guide/readme.md';
await processScmFile({
  abs: yaml.abs,
  ext: '.md',
  rel: docsProseRelKey,
  relKey: docsProseRelKey,
  text: '# Docs\n\nParagraph text.',
  fileStat: yaml.fileStat,
  languageHint: getLanguageForFile('.md', docsProseRelKey),
  scmProviderImpl: docsProseScmProvider,
  fileHash: 'scm-annotate-fast-timeout-docs-prose'
});
assert.equal(docsProseMetaCalls, 0, 'expected docs prose-routed files to skip SCM metadata');
assert.equal(docsProseAnnotateCalls, 0, 'expected docs prose-routed files to skip SCM annotate');

let extractedCodeMetaCalls = 0;
let extractedCodeAnnotateCalls = 0;
const extractedCodeScmProvider = {
  async getFileMeta() {
    extractedCodeMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    extractedCodeAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const extractedCodeRelKey = 'src/extracted/main.js';
await processScmFile({
  mode: 'extracted-prose',
  abs: js.abs,
  ext: '.js',
  rel: extractedCodeRelKey,
  relKey: extractedCodeRelKey,
  text: js.text,
  fileStat: js.fileStat,
  languageHint: getLanguageForFile('.js', extractedCodeRelKey),
  scmProviderImpl: extractedCodeScmProvider,
  fileHash: 'scm-annotate-fast-timeout-extracted-code'
});
assert.equal(extractedCodeMetaCalls, 1, 'expected extracted-prose code files to keep SCM metadata');
assert.equal(extractedCodeAnnotateCalls, 0, 'expected extracted-prose code files to skip SCM annotate by default');

let extractedCodeOptInMetaCalls = 0;
let extractedCodeOptInAnnotateCalls = 0;
const extractedCodeOptInScmProvider = {
  async getFileMeta() {
    extractedCodeOptInMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    extractedCodeOptInAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
await processScmFile({
  mode: 'extracted-prose',
  abs: js.abs,
  ext: '.js',
  rel: extractedCodeRelKey,
  relKey: extractedCodeRelKey,
  text: js.text,
  fileStat: js.fileStat,
  languageHint: getLanguageForFile('.js', extractedCodeRelKey),
  scmConfig: { annotate: { extractedProse: true } },
  scmProviderImpl: extractedCodeOptInScmProvider,
  fileHash: 'scm-annotate-fast-timeout-extracted-code-opt-in'
});
assert.equal(extractedCodeOptInMetaCalls, 1, 'expected extracted-prose annotate opt-in to keep SCM metadata');
assert.equal(extractedCodeOptInAnnotateCalls, 1, 'expected extracted-prose annotate opt-in to enable SCM annotate');

let extractedDocsProseMetaCalls = 0;
let extractedDocsProseAnnotateCalls = 0;
const extractedDocsProseScmProvider = {
  async getFileMeta() {
    extractedDocsProseMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    extractedDocsProseAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const extractedDocsProseRelKey = 'docs/reference/search.json';
await processScmFile({
  mode: 'extracted-prose',
  abs: yaml.abs,
  ext: '.json',
  rel: extractedDocsProseRelKey,
  relKey: extractedDocsProseRelKey,
  text: '{"hits":[{"title":"docs"}]}',
  fileStat: yaml.fileStat,
  languageHint: getLanguageForFile('.json', extractedDocsProseRelKey),
  scmProviderImpl: extractedDocsProseScmProvider,
  fileHash: 'scm-annotate-fast-timeout-extracted-docs-prose'
});
assert.equal(
  extractedDocsProseMetaCalls,
  0,
  'expected extracted-prose docs prose-routed files to skip SCM metadata'
);
assert.equal(
  extractedDocsProseAnnotateCalls,
  0,
  'expected extracted-prose docs prose-routed files to skip SCM annotate'
);

let cappedMetaCalls = 0;
let cappedAnnotateCalls = 0;
const cappedScmProvider = {
  async getFileMeta() {
    cappedMetaCalls += 1;
    return { ok: false };
  },
  async annotate() {
    cappedAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const largeRelKey = 'src/huge.cpp';
const largeText = `int sentinel = 0;\n${'a'.repeat(600 * 1024)}`;
await processScmFile({
  abs: js.abs,
  ext: '.cpp',
  rel: largeRelKey,
  relKey: largeRelKey,
  text: largeText,
  fileStat: { size: Buffer.byteLength(largeText, 'utf8') },
  languageHint: getLanguageForFile('.cpp', largeRelKey),
  scmProviderImpl: cappedScmProvider,
  fileHash: 'scm-annotate-fast-timeout-default-size-cap'
});
assert.equal(cappedMetaCalls, 1, 'expected SCM metadata to remain enabled for large files');
assert.equal(cappedAnnotateCalls, 0, 'expected default annotate size cap to skip large-file blame');

console.log('scm annotate fast timeout test passed');
