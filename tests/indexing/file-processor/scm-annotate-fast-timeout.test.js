#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const noop = () => {};
const timing = {
  metricsCollector: null,
  addSettingMetric: noop,
  addLineSpan: noop,
  addParseDuration: noop,
  addTokenizeDuration: noop,
  addEnrichDuration: noop,
  addEmbeddingDuration: noop,
  addLintDuration: noop,
  addComplexityDuration: noop,
  setGitDuration: noop,
  setPythonAstDuration: noop
};

const createContext = ({
  mode = 'code',
  abs,
  ext,
  rel,
  relKey,
  text,
  fileStat,
  languageHint,
  scmProviderImpl,
  fileHash,
  scmConfig = { annotate: {} },
  analysisPolicy = null,
  runIo = (fn) => fn(),
  runProc = (fn) => fn()
}) => ({
  abs,
  root,
  mode,
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext,
  rel,
  relKey,
  text,
  fileStat,
  fileHash,
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: 'git',
  scmProviderImpl,
  scmRepoRoot: root,
  scmConfig,
  languageOptions: { treeSitter: { enabled: false }, pythonAst: { enabled: false } },
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  normalizedSegmentsConfig: normalizeSegmentsConfig(null),
  normalizedCommentsConfig: normalizeCommentConfig(null),
  tokenDictWords: new Set(),
  dictConfig: {},
  tokenContext: {
    dictWords: new Set(),
    dictConfig: {},
    codeDictCache: new Map(),
    tokenClassification: { enabled: false },
    phraseEnabled: false,
    chargramEnabled: false
  },
  postingsConfig: {},
  contextWin: {},
  relationsEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  gitBlameEnabled: true,
  analysisPolicy,
  workerPool: null,
  workerDictOverride: null,
  workerState: {},
  tokenizationStats: null,
  tokenizeEnabled: true,
  embeddingEnabled: false,
  embeddingNormalize: false,
  embeddingBatchSize: 0,
  getChunkEmbedding: null,
  getChunkEmbeddings: null,
  runEmbedding: (fn) => fn(),
  runProc,
  runTreeSitterSerial: (fn) => fn(),
  runIo,
  log: noop,
  logLine: noop,
  showLineProgress: false,
  toolInfo: null,
  treeSitterScheduler: null,
  timing,
  languageHint,
  crashLogger: { enabled: false, updateFile: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
});

const yamlAbs = path.join(root, 'tests', 'fixtures', 'mixed', 'src', 'config.yml');
const yamlRel = path.relative(root, yamlAbs);
const yamlRelKey = yamlRel.split(path.sep).join('/');
const yamlText = await fs.readFile(yamlAbs, 'utf8');
const yamlStat = await fs.stat(yamlAbs);
const yamlLanguageHint = getLanguageForFile('.yml', yamlRelKey);
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

await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.yml',
  rel: yamlRel,
  relKey: yamlRelKey,
  text: yamlText,
  fileStat: yamlStat,
  languageHint: yamlLanguageHint,
  scmProviderImpl: yamlScmProvider,
  fileHash: 'scm-annotate-fast-timeout-yml'
}));
assert.equal(yamlAnnotateCalls, 1, 'expected annotate to run for .yml files');
assert.equal(yamlTimeoutMs, 5000, 'expected .yml annotate timeout to clamp to 5000ms by default');
assert.equal(yamlMetaTimeoutMs, 250, 'expected .yml meta timeout to clamp to 250ms by default');
assert.equal(yamlIncludeChurn, false, 'expected fast-path .yml churn metadata to be disabled');

const jsAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');
const jsRel = path.relative(root, jsAbs);
const jsRelKey = jsRel.split(path.sep).join('/');
const jsText = await fs.readFile(jsAbs, 'utf8');
const jsStat = await fs.stat(jsAbs);
const jsLanguageHint = getLanguageForFile('.js', jsRelKey);
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

await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.js',
  rel: jsRel,
  relKey: jsRelKey,
  text: jsText,
  fileStat: jsStat,
  languageHint: jsLanguageHint,
  scmProviderImpl: jsScmProvider,
  fileHash: 'scm-annotate-fast-timeout-js'
}));
assert.equal(jsAnnotateCalls, 1, 'expected annotate to run for .js files');
assert.equal(jsTimeoutMs, 2000, 'expected non-metadata annotate timeout to clamp to 2000ms');
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
await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.java',
  rel: javaRelKey,
  relKey: javaRelKey,
  text: javaText,
  fileStat: javaStat,
  languageHint: javaLanguageHint,
  scmProviderImpl: javaScmProvider,
  fileHash: 'scm-annotate-fast-timeout-java'
}));
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
await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.h',
  rel: heavyRelKey,
  relKey: heavyRelKey,
  text: heavyText,
  fileStat: heavyStat,
  languageHint: heavyLanguageHint,
  scmProviderImpl: heavyScmProvider,
  fileHash: 'scm-annotate-fast-timeout-heavy-path'
}));
assert.equal(heavyAnnotateCalls, 1, 'expected annotate to run for heavy include paths');
assert.equal(heavyTimeoutMs, 5000, 'expected heavy include paths to use 5s annotate timeout cap');
assert.equal(heavyMetaTimeoutMs, 250, 'expected heavy include paths to keep fast metadata timeout cap');
assert.equal(heavyIncludeChurn, false, 'expected heavy include paths to keep churn disabled on fast path');

const swiftAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'swift.swift');
const swiftRel = path.relative(root, swiftAbs);
const swiftRelKey = swiftRel.split(path.sep).join('/');
const swiftText = await fs.readFile(swiftAbs, 'utf8');
const swiftStat = await fs.stat(swiftAbs);
const swiftLanguageHint = getLanguageForFile('.swift', swiftRelKey);
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
await processFileCpu(createContext({
  abs: swiftAbs,
  ext: '.swift',
  rel: swiftRel,
  relKey: swiftRelKey,
  text: swiftText,
  fileStat: swiftStat,
  languageHint: swiftLanguageHint,
  scmProviderImpl: swiftScmProvider,
  fileHash: 'scm-annotate-fast-timeout-swift'
}));
assert.equal(swiftAnnotateCalls, 1, 'expected annotate to run for .swift files');
assert.equal(swiftTimeoutMs, 5000, 'expected .swift annotate timeout to clamp to 5000ms');
assert.equal(swiftMetaTimeoutMs, 250, 'expected .swift meta timeout to clamp to 250ms');

const pyAbs = path.join(root, 'tests', 'fixtures', 'sample', 'src', 'sample.py');
const pyRel = path.relative(root, pyAbs);
const pyRelKey = pyRel.split(path.sep).join('/');
const pyText = await fs.readFile(pyAbs, 'utf8');
const pyStat = await fs.stat(pyAbs);
const pyLanguageHint = getLanguageForFile('.py', pyRelKey);
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
await processFileCpu(createContext({
  abs: pyAbs,
  ext: '.py',
  rel: pyRel,
  relKey: pyRelKey,
  text: pyText,
  fileStat: pyStat,
  languageHint: pyLanguageHint,
  scmProviderImpl: pyScmProvider,
  fileHash: 'scm-annotate-fast-timeout-py'
}));
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
await processFileCpu(createContext({
  abs: pyAbs,
  ext: '.py',
  rel: pyGeneratedRelKey,
  relKey: pyGeneratedRelKey,
  text: pyText,
  fileStat: pyStat,
  languageHint: getLanguageForFile('.py', pyGeneratedRelKey),
  scmProviderImpl: pyGeneratedScmProvider,
  fileHash: 'scm-annotate-fast-timeout-py-generated'
}));
assert.equal(pyGeneratedMetaCalls, 1, 'expected generated python files to keep SCM file metadata');
assert.equal(pyGeneratedAnnotateCalls, 0, 'expected generated python files to skip SCM annotate');

let legacyIncludeChurn = null;
const legacyScmProvider = {
  async getFileMeta(args) {
    legacyIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate() {
    return { ok: false, reason: 'timeout' };
  }
};
await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.js',
  rel: jsRel,
  relKey: jsRelKey,
  text: jsText,
  fileStat: jsStat,
  languageHint: jsLanguageHint,
  scmProviderImpl: legacyScmProvider,
  fileHash: 'scm-annotate-fast-timeout-legacy-churn-off',
  scmConfig: { annotate: {}, meta: { includeChurn: false } }
}));
assert.equal(legacyIncludeChurn, false, 'expected legacy scm meta.includeChurn=false to disable churn metadata');

let legacyWithPolicyIncludeChurn = null;
const legacyWithPolicyScmProvider = {
  async getFileMeta(args) {
    legacyWithPolicyIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate() {
    return { ok: false, reason: 'timeout' };
  }
};
await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.js',
  rel: jsRel,
  relKey: jsRelKey,
  text: jsText,
  fileStat: jsStat,
  languageHint: jsLanguageHint,
  scmProviderImpl: legacyWithPolicyScmProvider,
  fileHash: 'scm-annotate-fast-timeout-legacy-churn-policy-override',
  scmConfig: { annotate: {}, meta: { includeChurn: false } },
  analysisPolicy: { git: { churn: true } }
}));
assert.equal(
  legacyWithPolicyIncludeChurn,
  true,
  'expected analysis policy git.churn to override legacy scm meta.includeChurn'
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
await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.yml',
  rel: yamlRel,
  relKey: yamlRelKey,
  text: yamlText,
  fileStat: yamlStat,
  languageHint: yamlLanguageHint,
  scmProviderImpl: explicitScmProvider,
  fileHash: 'scm-annotate-fast-timeout-explicit',
  scmConfig: { timeoutMs: 333, annotate: { timeoutMs: 4321 } },
  analysisPolicy: { git: { churn: false } }
}));
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
await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.yml',
  rel: yamlRel,
  relKey: yamlRelKey,
  text: yamlText,
  fileStat: yamlStat,
  languageHint: yamlLanguageHint,
  scmProviderImpl: allowSlowScmProvider,
  fileHash: 'scm-annotate-fast-timeout-allow-slow',
  scmConfig: {
    allowSlowTimeouts: true,
    timeoutMs: 333,
    annotate: { timeoutMs: 4321 }
  }
}));
assert.equal(allowSlowTimeoutMs, 4321, 'expected allowSlowTimeouts to permit explicit annotate timeout');
assert.equal(allowSlowMetaTimeoutMs, 333, 'expected allowSlowTimeouts to permit explicit meta timeout');

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
await processFileCpu(createContext({
  abs: swiftAbs,
  ext: '.swift',
  rel: forcedCapRelKey,
  relKey: forcedCapRelKey,
  text: swiftText,
  fileStat: swiftStat,
  languageHint: getLanguageForFile('.swift', forcedCapRelKey),
  scmProviderImpl: forcedCapScmProvider,
  fileHash: 'scm-annotate-fast-timeout-force-cap',
  scmConfig: {
    allowSlowTimeouts: true,
    timeoutMs: 12000,
    annotate: { timeoutMs: 15000 }
  }
}));
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
await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.yml',
  rel: yamlRel,
  relKey: yamlRelKey,
  text: yamlText,
  fileStat: yamlStat,
  languageHint: yamlLanguageHint,
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
}));
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
await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.go',
  rel: docsCodeRelKey,
  relKey: docsCodeRelKey,
  text: [
    'package main',
    'func main() { helper() }',
    'func helper() {}'
  ].join('\n'),
  fileStat: jsStat,
  languageHint: getLanguageForFile('.go', docsCodeRelKey),
  scmProviderImpl: docsCodeScmProvider,
  fileHash: 'scm-annotate-fast-timeout-docs-code'
}));
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
await processFileCpu(createContext({
  mode: 'prose',
  abs: yamlAbs,
  ext: '.html',
  rel: docsProseModeRelKey,
  relKey: docsProseModeRelKey,
  text: '<html><body>Docs</body></html>',
  fileStat: yamlStat,
  languageHint: getLanguageForFile('.html', docsProseModeRelKey),
  scmProviderImpl: docsProseModeScmProvider,
  fileHash: 'scm-annotate-fast-timeout-docs-prose-mode'
}));
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
await processFileCpu(createContext({
  mode: 'prose',
  abs: yamlAbs,
  ext: '.txt',
  rel: proseTxtRelKey,
  relKey: proseTxtRelKey,
  text: 'A\nB\nC\n',
  fileStat: { size: 6 },
  languageHint: getLanguageForFile('.txt', proseTxtRelKey),
  scmProviderImpl: proseTxtScmProvider,
  fileHash: 'scm-annotate-fast-timeout-prose-txt'
}));
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
await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.md',
  rel: docsProseRelKey,
  relKey: docsProseRelKey,
  text: '# Docs\n\nParagraph text.',
  fileStat: yamlStat,
  languageHint: getLanguageForFile('.md', docsProseRelKey),
  scmProviderImpl: docsProseScmProvider,
  fileHash: 'scm-annotate-fast-timeout-docs-prose'
}));
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
await processFileCpu(createContext({
  mode: 'extracted-prose',
  abs: jsAbs,
  ext: '.js',
  rel: extractedCodeRelKey,
  relKey: extractedCodeRelKey,
  text: jsText,
  fileStat: jsStat,
  languageHint: getLanguageForFile('.js', extractedCodeRelKey),
  scmProviderImpl: extractedCodeScmProvider,
  fileHash: 'scm-annotate-fast-timeout-extracted-code'
}));
assert.equal(extractedCodeMetaCalls, 1, 'expected extracted-prose code files to keep SCM metadata');
assert.equal(extractedCodeAnnotateCalls, 1, 'expected extracted-prose code files to keep SCM annotate');

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
await processFileCpu(createContext({
  mode: 'extracted-prose',
  abs: yamlAbs,
  ext: '.json',
  rel: extractedDocsProseRelKey,
  relKey: extractedDocsProseRelKey,
  text: '{"hits":[{"title":"docs"}]}',
  fileStat: yamlStat,
  languageHint: getLanguageForFile('.json', extractedDocsProseRelKey),
  scmProviderImpl: extractedDocsProseScmProvider,
  fileHash: 'scm-annotate-fast-timeout-extracted-docs-prose'
}));
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
await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.cpp',
  rel: largeRelKey,
  relKey: largeRelKey,
  text: largeText,
  fileStat: { size: Buffer.byteLength(largeText, 'utf8') },
  languageHint: getLanguageForFile('.cpp', largeRelKey),
  scmProviderImpl: cappedScmProvider,
  fileHash: 'scm-annotate-fast-timeout-default-size-cap'
}));
assert.equal(cappedMetaCalls, 1, 'expected SCM metadata to remain enabled for large files');
assert.equal(cappedAnnotateCalls, 0, 'expected default annotate size cap to skip large-file blame');

console.log('scm annotate fast timeout test passed');
