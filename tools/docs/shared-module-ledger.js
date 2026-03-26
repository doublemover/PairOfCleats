#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { toPosix } from '../../src/shared/files.js';
import { listFilesRecursive } from '../shared/fs-utils.js';

const DEFAULT_JSON = 'docs/tooling/shared-module-ledger.json';
const DEFAULT_MARKDOWN = 'docs/tooling/shared-module-ledger.md';
const SHARED_ROOTS = ['src/shared', 'tools/shared'];
const BENCHMARK_SCAN_ROOT = 'benchmarks/queries';
const BENCHMARK_SCAN_FILES = ['benchmarks/repos.json'];
const CODE_SCAN_ROOTS = ['src', 'tools', 'bin', 'tests', 'extensions', 'sublime', BENCHMARK_SCAN_ROOT];
const CONSUMER_SCAN_ROOTS = ['src', 'tools', 'bin', 'extensions', 'sublime'];
const CODE_SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.ps1', '.txt']);
const MODULE_SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json'];
const DUPLICATE_STEM_STOP_WORDS = new Set(['index', 'readme', 'config', 'constants', 'types']);
const EXCLUDED_SCAN_PREFIXES = ['.git', 'node_modules', '.testLogs', 'tests/.cache', 'benchmarks/results'];

const H30_ISSUES = {
  '410': {
    title: 'Review shared core primitives and root-level contracts in src/shared',
    umbrella: '407'
  },
  '411': {
    title: 'Review shared artifact, cache, IO, bundle, and serialization module families',
    umbrella: '407'
  },
  '412': {
    title: 'Review shared concurrency, queue, subprocess, lifecycle, and worker module families',
    umbrella: '407'
  },
  '413': {
    title: 'Review shared CLI, command, dispatch, capability, and tooling support modules',
    umbrella: '407'
  },
  '414': {
    title: 'Review shared domain helper families for embeddings, indexing, search, risk, language, and type/token processing',
    umbrella: '407'
  },
  '415': {
    title: 'Review all tools/shared modules as a first-class shared surface',
    umbrella: '407'
  }
};

const H31_ISSUES = {
  '416': {
    title: 'Scan runtime and server surfaces for missed adoption of existing shared modules',
    umbrella: '408',
    roots: ['tools/api', 'tools/mcp', 'tools/service', 'src/workspace', 'bin']
  },
  '417': {
    title: 'Scan indexing, retrieval, graph, storage, and context-pack surfaces for missed shared-module adoption',
    umbrella: '408',
    roots: ['src/index', 'src/retrieval', 'src/graph', 'src/storage', 'src/context-pack', 'src/map']
  },
  '418': {
    title: 'Scan CLI, setup, download, install, doctor, dispatch, and maintenance tooling for missed shared-module adoption',
    umbrella: '408',
    roots: [
      'tools/analysis',
      'tools/bench',
      'tools/build',
      'tools/cache',
      'tools/ci',
      'tools/cli',
      'tools/config',
      'tools/dict-utils',
      'tools/dictionary',
      'tools/dicts',
      'tools/dispatch',
      'tools/download',
      'tools/eval',
      'tools/index',
      'tools/ingest',
      'tools/lexicon',
      'tools/release',
      'tools/setup',
      'tools/shared',
      'tools/sqlite',
      'tools/tooling',
      'tools/triage',
      'tools/usr',
      'tools/workspace'
    ],
    files: ['tools/build-native.js', 'tools/index-diff.js', 'tools/index-snapshot.js']
  },
  '419': {
    title: 'Scan tests, fixtures, benchmarks, and reporting surfaces for missed shared-module adoption',
    umbrella: '408',
    roots: ['tests', BENCHMARK_SCAN_ROOT, 'tools/docs', 'tools/reports', 'tools/testing', 'tools/test_times'],
    files: BENCHMARK_SCAN_FILES
  },
  '420': {
    title: 'Scan editor, extension, and integration surfaces for missed shared-module adoption',
    umbrella: '408',
    roots: ['extensions', 'sublime', 'src/integrations', 'tools/tui'],
    files: ['tools/package-vscode.js', 'tools/package-sublime.js']
  },
  '421': {
    title: 'Scan the full codebase for bespoke platform, path, env, and repo/workspace handling that should use existing shared modules',
    umbrella: '408',
    roots: CODE_SCAN_ROOTS,
    files: BENCHMARK_SCAN_FILES,
    includeMatchedFiles: false
  }
};

const H32_ISSUES = {
  '422': {
    title: 'Identify and create shared HTTP/request helper modules for API-like surfaces',
    umbrella: '409',
    roots: ['tools/api', 'tools/mcp', 'tools/service', 'extensions', 'sublime', 'src/integrations'],
    includeMatchedFiles: false
  },
  '423': {
    title: 'Identify and create shared repo, workspace, cache-root, and generation-context helper modules',
    umbrella: '409',
    roots: ['src/workspace', 'src/retrieval', 'src/index', 'tools/api', 'tools/shared', 'tools/workspace', 'tests'],
    includeMatchedFiles: false
  },
  '424': {
    title: 'Identify and create shared subprocess, toolchain, command-resolution, and installer helper modules',
    umbrella: '409',
    roots: ['src/shared/subprocess', 'src/index/tooling', 'tools/shared', 'tools/tooling', 'tools/setup', 'tools/download', 'tools/build', 'tools/tui'],
    includeMatchedFiles: false
  },
  '425': {
    title: 'Identify and create shared search, risk, context-pack, and payload-normalization helper modules across surfaces',
    umbrella: '409',
    roots: ['bin', 'tools/api', 'tools/analysis', 'tools/mcp', 'tools/triage', 'tools/tui', 'src/context-pack', 'src/retrieval', 'src/graph', 'extensions', 'sublime'],
    includeMatchedFiles: false
  },
  '426': {
    title: 'Identify and create shared filesystem, JSON, report-writing, and small persistence helper modules',
    umbrella: '409',
    roots: ['src', 'tools', 'tests', BENCHMARK_SCAN_ROOT],
    files: BENCHMARK_SCAN_FILES,
    includeMatchedFiles: false
  },
  '427': {
    title: 'Identify and create shared progress, fidelity, degradation, and closure-evidence helper modules',
    umbrella: '409',
    roots: ['tools/bench', 'src/index', 'src/retrieval', 'src/index/tooling', 'tools/api', 'tools/service', 'tools/reports'],
    includeMatchedFiles: false
  },
  '428': {
    title: 'Identify and create shared test harness, fixture, and surface-parity helper modules',
    umbrella: '409',
    roots: ['tests', BENCHMARK_SCAN_ROOT, 'extensions', 'sublime', 'tools/testing', 'tools/tui'],
    files: BENCHMARK_SCAN_FILES,
    includeMatchedFiles: false
  }
};

const ROOT_LEVEL_ISSUE_411 = new Set([
  'artifact-io.js',
  'artifact-schema-index.js',
  'artifact-schemas.js',
  'bundle-checksum.js',
  'bundle-contract.js',
  'bundle-io.js',
  'cache-cas.js',
  'cache-key.js',
  'cache-roots.js',
  'cache.js',
  'chunk-meta-cold.js',
  'docmeta.js',
  'encoding.js',
  'eol.js',
  'file-signature.js',
  'file-stats.js',
  'files.js',
  'index-artifact-helpers.js',
  'json-stream.js',
  'jsonc.js',
  'meta-v2.js',
  'optional-artifact-fallback.js',
  'provenance.js',
  'stable-json.js'
]);

const ROOT_LEVEL_ISSUE_412 = new Set([
  'abort.js',
  'bench-progress.js',
  'bounded-object-pool.js',
  'concurrency.js',
  'embeddings-progress.js',
  'kill-tree.js',
  'piscina-cleanup.js',
  'process-signals.js',
  'progress.js',
  'promise-keepalive.js',
  'promise-timeout.js',
  'queue.js',
  'retry.js',
  'sleep.js',
  'subprocess.js',
  'threads.js'
]);

const ROOT_LEVEL_ISSUE_413 = new Set([
  'capabilities.js',
  'cli-completions.js',
  'cli-options.js',
  'cli.js',
  'command-aliases.js',
  'command-registry.js',
  'legacy-cli-entrypoint.js',
  'runtime-capability-manifest.js',
  'tooling-bin-dirs.js'
]);

const ROOT_LEVEL_ISSUE_414 = new Set([
  'ann-similarity.js',
  'bloom.js',
  'boolean-normalization.js',
  'chargram-hash.js',
  'code-dictionaries.js',
  'dense-vector-artifacts.js',
  'dense-vector-mode.js',
  'dict-utils.js',
  'dictionary-wordlists.js',
  'dictionary.js',
  'dockerfile.js',
  'embedding-adapter.js',
  'embedding-batch.js',
  'embedding-identity.js',
  'embedding-input-format.js',
  'embedding-utils.js',
  'embedding.js',
  'hash.js',
  'hnsw.js',
  'lancedb.js',
  'onnx-embeddings.js',
  'ownership-segment.js',
  'packed-postings.js',
  'postings-config.js',
  'risk-explain.js',
  'risk-filters.js',
  'safe-regex.js',
  'seed-ref.js',
  'tantivy.js',
  'token-id.js',
  'tokenize.js',
  'truncation.js',
  'type-entry-utils.js',
  'type-normalization.js'
]);

const parseArgs = () => createCli({
  scriptName: 'pairofcleats shared-module-ledger',
  options: {
    root: { type: 'string' },
    json: { type: 'string', default: DEFAULT_JSON },
    markdown: { type: 'string', default: DEFAULT_MARKDOWN }
  }
})
  .strictOptions()
  .parse();

const listFiles = async (root, relativeDir) => {
  const targetDir = path.join(root, relativeDir);
  const entries = await listFilesRecursive(targetDir, {
    baseDir: root,
    sortEntries: true,
    include: ({ relPath }) => !EXCLUDED_SCAN_PREFIXES.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`))
  });
  return entries.map((entry) => toPosix(entry.relPath));
};

const matchesRoot = (relPath, root) => relPath === root || relPath.startsWith(`${root}/`);

const isCodeLikeFile = (relPath) => CODE_SCAN_EXTENSIONS.has(path.extname(relPath).toLowerCase());

const classifyH30Issue = (relPath) => {
  const normalized = toPosix(relPath);
  if (matchesRoot(normalized, 'tools/shared')) {
    return '415';
  }
  if (matchesRoot(normalized, 'src/shared/logging')) {
    return '410';
  }
  if (matchesRoot(normalized, 'src/shared/artifact-io')
    || matchesRoot(normalized, 'src/shared/io')
    || matchesRoot(normalized, 'src/shared/json-stream')
    || matchesRoot(normalized, 'src/shared/cache')) {
    return '411';
  }
  if (matchesRoot(normalized, 'src/shared/concurrency')
    || matchesRoot(normalized, 'src/shared/subprocess')
    || matchesRoot(normalized, 'src/shared/scheduler')
    || matchesRoot(normalized, 'src/shared/lifecycle')
    || matchesRoot(normalized, 'src/shared/locks')
    || matchesRoot(normalized, 'src/shared/workers')) {
    return '412';
  }
  if (matchesRoot(normalized, 'src/shared/cli') || matchesRoot(normalized, 'src/shared/dispatch')) {
    return '413';
  }
  if (matchesRoot(normalized, 'src/shared/embeddings-cache')
    || matchesRoot(normalized, 'src/shared/indexing')
    || matchesRoot(normalized, 'src/shared/filter')
    || matchesRoot(normalized, 'src/shared/fs')
    || matchesRoot(normalized, 'src/shared/hash')
    || matchesRoot(normalized, 'src/shared/perf')
    || matchesRoot(normalized, 'src/shared/text')
    || matchesRoot(normalized, 'src/shared/validation')
    || matchesRoot(normalized, 'src/shared/safe-regex')) {
    return '414';
  }
  if (!matchesRoot(normalized, 'src/shared')) {
    return null;
  }
  const baseName = path.posix.basename(normalized);
  if (ROOT_LEVEL_ISSUE_411.has(baseName)) return '411';
  if (ROOT_LEVEL_ISSUE_412.has(baseName)) return '412';
  if (ROOT_LEVEL_ISSUE_413.has(baseName)) return '413';
  if (ROOT_LEVEL_ISSUE_414.has(baseName)) return '414';
  return '410';
};

const uniqueSorted = (values) => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

const collectFilesForExtensions = async (root, extensions, relativeDirs = CODE_SCAN_ROOTS) => {
  const files = [];
  for (const relativeDir of relativeDirs) {
    try {
      files.push(...(await listFiles(root, relativeDir)).filter((file) => extensions.has(path.extname(file).toLowerCase())));
    } catch {}
  }
  return uniqueSorted(files);
};

// This is intentionally regex-based rather than AST-based so the ledger can scan
// every code-like file quickly, including simple CJS or docs-generator scripts.
const extractModuleSpecifiers = (contents) => {
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s[^'"`]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(contents)) !== null) {
      specifiers.add(String(match[1] || '').trim());
    }
  }
  return Array.from(specifiers);
};

const tryResolveModulePath = (root, importerPath, specifier, knownFiles) => {
  if (!specifier || specifier.startsWith('node:') || /^[a-z]+:/i.test(specifier)) {
    return null;
  }
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }
  const importerDir = path.dirname(path.join(root, importerPath));
  const basePath = specifier.startsWith('/')
    ? path.resolve(root, specifier.slice(1))
    : path.resolve(importerDir, specifier);
  const candidates = [basePath];
  for (const ext of MODULE_EXTENSIONS) {
    candidates.push(`${basePath}${ext}`);
  }
  for (const ext of MODULE_EXTENSIONS) {
    candidates.push(path.join(basePath, `index${ext}`));
  }
  for (const candidate of candidates) {
    const relCandidate = toPosix(path.relative(root, candidate));
    if (knownFiles.has(relCandidate)) {
      return relCandidate;
    }
  }
  return null;
};

const collectConsumerMap = async (root, sharedFiles, codeFiles) => {
  const knownFiles = new Set([...sharedFiles, ...codeFiles]);
  const bySharedFile = Object.fromEntries(sharedFiles.map((file) => [file, []]));
  const byConsumer = {};
  for (const consumerPath of codeFiles) {
    const absolutePath = path.join(root, consumerPath);
    let contents = '';
    try {
      contents = await fsPromises.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const resolvedSharedImports = [];
    for (const specifier of extractModuleSpecifiers(contents)) {
      const resolved = tryResolveModulePath(root, consumerPath, specifier, knownFiles);
      if (!resolved || !bySharedFile[resolved]) continue;
      resolvedSharedImports.push(resolved);
    }
    const uniqueImports = uniqueSorted(resolvedSharedImports);
    if (!uniqueImports.length) continue;
    byConsumer[consumerPath] = uniqueImports;
    for (const sharedFile of uniqueImports) {
      bySharedFile[sharedFile].push(consumerPath);
    }
  }
  for (const sharedFile of Object.keys(bySharedFile)) {
    bySharedFile[sharedFile] = uniqueSorted(bySharedFile[sharedFile]);
  }
  return {
    bySharedFile,
    byConsumer: Object.fromEntries(
      Object.entries(byConsumer).sort((a, b) => a[0].localeCompare(b[0]))
    )
  };
};

const scanRootsForIssue = async (root, issueConfig) => {
  const files = [];
  for (const relativeDir of issueConfig.roots || []) {
    try {
      files.push(...(await listFiles(root, relativeDir)).filter(isCodeLikeFile));
    } catch {}
  }
  for (const relativeFile of issueConfig.files || []) {
    try {
      await fsPromises.access(path.join(root, relativeFile));
      if (isCodeLikeFile(relativeFile)) files.push(toPosix(relativeFile));
    } catch {}
  }
  return uniqueSorted(files);
};

const buildScanLedger = async (root, issueMap) => {
  const issues = [];
  const scopeGaps = [];
  for (const [issueId, issueConfig] of Object.entries(issueMap)) {
    const files = await scanRootsForIssue(root, issueConfig);
    const emptyRoots = [];
    for (const relativeDir of issueConfig.roots || []) {
      const matched = files.some((file) => matchesRoot(file, relativeDir));
      if (!matched) emptyRoots.push(relativeDir);
    }
    for (const relativeFile of issueConfig.files || []) {
      if (!files.includes(relativeFile)) emptyRoots.push(relativeFile);
    }
    if (emptyRoots.length) {
      scopeGaps.push({ issueId, emptyRoots });
    }
    issues.push({
      issueId,
      title: issueConfig.title,
      umbrella: issueConfig.umbrella,
      scopeRoots: issueConfig.roots || [],
      scopeFiles: issueConfig.files || [],
      matchedFiles: issueConfig.includeMatchedFiles === false ? undefined : files,
      sampleFiles: issueConfig.includeMatchedFiles === false ? files.slice(0, 25) : undefined,
      fileCount: files.length
    });
  }
  return { issues, scopeGaps };
};

const collectDuplicateSeeds = (codeFiles, sharedFiles, h31PrimaryByFile) => {
  const sharedSet = new Set(sharedFiles);
  const clusters = new Map();
  for (const relPath of codeFiles) {
    if (sharedSet.has(relPath)) continue;
    const stem = path.posix.basename(relPath, path.posix.extname(relPath)).toLowerCase();
    if (stem.length < 4 || DUPLICATE_STEM_STOP_WORDS.has(stem)) continue;
    const list = clusters.get(stem) || [];
    list.push(relPath);
    clusters.set(stem, list);
  }
  return Array.from(clusters.entries())
    .map(([stem, paths]) => ({ stem, paths: uniqueSorted(paths) }))
    .filter((entry) => entry.paths.length >= 2)
    .map((entry) => ({
      stem: entry.stem,
      paths: entry.paths,
      count: entry.paths.length,
      issueHints: uniqueSorted(entry.paths
        .map((file) => h31PrimaryByFile[file])
        .filter(Boolean)
        .map((issueId) => `#${issueId}`))
    }))
    .sort((a, b) => b.count - a.count || a.stem.localeCompare(b.stem))
    .slice(0, 100);
};

const toMarkdownTable = (headers, rows) => {
  const headerLine = `| ${headers.join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [headerLine, dividerLine, ...body].join('\n');
};

const renderMarkdown = (report) => {
  const lines = [
    '# Shared Module Ledger',
    '',
    'This file is generated by `node tools/docs/shared-module-ledger.js`.',
    '',
    '## Overview',
    '',
    `- Shared files inventoried: ${report.census.sharedFiles.length}`,
    `- Shared files with H30 ownership: ${report.census.sharedFiles.length - report.gaps.unownedSharedFiles.length}`,
    `- Shared consumer edges: ${report.consumerMap.edgeCount}`,
    `- H31 code-scan files covered: ${report.scanLedger.h31.repoCoverage.scannedFiles.length}`,
    `- H31 code-scan files uncovered: ${report.gaps.unscannedH31Files.length}`,
    `- H32 scope roots without matches: ${report.gaps.emptyH32Scopes.length}`,
    '',
    '## H30 Ownership',
    '',
    toMarkdownTable(
      ['Issue', 'Title', 'Owned files'],
      report.reviewLedger.issues.map((issue) => [
        `#${issue.issueId}`,
        issue.title,
        String(issue.fileCount)
      ])
    ),
    '',
    '## Gap Report',
    ''
  ];

  if (!report.gaps.unownedSharedFiles.length
    && !report.gaps.unscannedH31Files.length
    && !report.gaps.emptyH31Scopes.length
    && !report.gaps.emptyH32Scopes.length) {
    lines.push('- No current ownership or scan gaps detected in the generated ledger.');
  } else {
    if (report.gaps.unownedSharedFiles.length) {
      lines.push(`- Unowned shared files: ${report.gaps.unownedSharedFiles.join(', ')}`);
    }
    if (report.gaps.unscannedH31Files.length) {
      lines.push(`- Unscanned H31 files: ${report.gaps.unscannedH31Files.slice(0, 20).join(', ')}`);
    }
    if (report.gaps.emptyH31Scopes.length) {
      lines.push(`- Empty H31 scopes: ${report.gaps.emptyH31Scopes.map((gap) => `#${gap.issueId}`).join(', ')}`);
    }
    if (report.gaps.emptyH32Scopes.length) {
      lines.push(`- Empty H32 scopes: ${report.gaps.emptyH32Scopes.map((gap) => `#${gap.issueId}`).join(', ')}`);
    }
  }

  lines.push('', '## Top Shared Consumers', '');
  const topConsumers = report.census.sharedFiles
    .filter((entry) => entry.consumerCount > 0)
    .sort((a, b) => b.consumerCount - a.consumerCount || a.path.localeCompare(b.path))
    .slice(0, 20)
    .map((entry) => [entry.path, `#${entry.primaryIssue.issueId}`, String(entry.consumerCount)]);
  lines.push(toMarkdownTable(['Shared file', 'H30 owner', 'Consumers'], topConsumers.length ? topConsumers : [['(none)', '-', '0']]));

  lines.push('', '## Duplicate Seed Clusters', '');
  const duplicateRows = report.duplicateSeeds.basenameClusters.slice(0, 20).map((cluster) => [
    cluster.stem,
    String(cluster.count),
    cluster.issueHints.join(', ') || '-',
    cluster.paths.slice(0, 3).join('<br>')
  ]);
  lines.push(toMarkdownTable(['Stem', 'Count', 'Issue hints', 'Example paths'], duplicateRows.length ? duplicateRows : [['(none)', '0', '-', '-']]));

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || process.cwd());
  const outputJsonPath = path.resolve(root, argv.json);
  const outputMarkdownPath = path.resolve(root, argv.markdown);

  const sharedFiles = uniqueSorted((await Promise.all(SHARED_ROOTS.map((relativeDir) => listFiles(root, relativeDir)))).flat());
  const coverageFiles = await collectFilesForExtensions(root, CODE_SCAN_EXTENSIONS);
  for (const relativeFile of BENCHMARK_SCAN_FILES) {
    if (!coverageFiles.includes(relativeFile)) {
      coverageFiles.push(relativeFile);
    }
  }
  coverageFiles.sort((a, b) => a.localeCompare(b));
  const moduleFiles = await collectFilesForExtensions(root, MODULE_SCAN_EXTENSIONS, CONSUMER_SCAN_ROOTS);
  const consumerScanFiles = uniqueSorted([
    ...moduleFiles,
    ...sharedFiles.filter((file) => MODULE_EXTENSIONS.includes(path.extname(file).toLowerCase()))
  ]);

  const sharedOwnership = sharedFiles.map((file) => ({
    path: file,
    primaryIssueId: classifyH30Issue(file)
  }));
  const unownedSharedFiles = sharedOwnership.filter((entry) => !entry.primaryIssueId).map((entry) => entry.path);
  const duplicateSharedOwnership = [];

  const consumerMap = await collectConsumerMap(root, sharedFiles, consumerScanFiles);
  const h31Ledger = await buildScanLedger(root, H31_ISSUES);
  const h32Ledger = await buildScanLedger(root, H32_ISSUES);
  const h31CoverageIssue = h31Ledger.issues.find((issue) => issue.issueId === '421');
  const scanCoverageFiles = h31CoverageIssue?.sampleFiles
    ? coverageFiles
    : (h31CoverageIssue?.matchedFiles || []);
  const unscannedH31Files = coverageFiles.filter((file) => !scanCoverageFiles.includes(file));

  const h31PrimaryByFile = {};
  for (const issue of h31Ledger.issues) {
    if (issue.issueId === '421') continue;
    for (const file of issue.matchedFiles || []) {
      if (!h31PrimaryByFile[file]) h31PrimaryByFile[file] = issue.issueId;
    }
  }
  for (const file of scanCoverageFiles) {
    if (!h31PrimaryByFile[file]) h31PrimaryByFile[file] = '421';
  }

  const censusEntries = sharedOwnership.map((entry) => {
    const owner = entry.primaryIssueId ? H30_ISSUES[entry.primaryIssueId] : null;
    const importers = consumerMap.bySharedFile[entry.path] || [];
    return {
      path: entry.path,
      family: entry.path.startsWith('src/shared/')
        ? (entry.path.split('/').length > 3 ? entry.path.split('/').slice(0, 3).join('/') : 'src/shared/root')
        : 'tools/shared',
      primaryIssue: owner ? { issueId: entry.primaryIssueId, title: owner.title, umbrella: owner.umbrella } : null,
      consumerCount: importers.length,
      importers
    };
  });

  const reviewIssues = Object.entries(H30_ISSUES).map(([issueId, issue]) => {
    const files = censusEntries
      .filter((entry) => entry.primaryIssue?.issueId === issueId)
      .map((entry) => entry.path)
      .sort((a, b) => a.localeCompare(b));
    return {
      issueId,
      title: issue.title,
      umbrella: issue.umbrella,
      files,
      fileCount: files.length,
      entries: files.map((file) => ({
        path: file,
        status: 'pending-review',
        classification: null,
        notes: ''
      }))
    };
  });

  const duplicateSeeds = {
    basenameClusters: collectDuplicateSeeds(moduleFiles, sharedFiles, h31PrimaryByFile)
  };

  const report = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    generatedBy: 'node tools/docs/shared-module-ledger.js',
    root: toPosix(root),
    census: {
      sharedRoots: SHARED_ROOTS,
      sharedFiles: censusEntries
    },
    consumerMap: {
      edgeCount: Object.values(consumerMap.bySharedFile).reduce((sum, importers) => sum + importers.length, 0),
      bySharedFile: Object.fromEntries(
        Object.entries(consumerMap.bySharedFile).map(([file, importers]) => [file, {
          importers,
          importerCount: importers.length
        }])
      ),
      byConsumer: Object.fromEntries(
        Object.entries(consumerMap.byConsumer).map(([file, imports]) => [file, {
          sharedImports: imports,
          sharedImportCount: imports.length
        }])
      )
    },
    reviewLedger: {
      issues: reviewIssues,
      duplicateOwnership: duplicateSharedOwnership,
      unownedFiles: unownedSharedFiles
    },
    scanLedger: {
      h31: {
        issues: h31Ledger.issues,
        repoCoverage: {
          roots: CODE_SCAN_ROOTS,
          scannedFiles: scanCoverageFiles,
          unscannedFiles: unscannedH31Files
        }
      },
      h32: {
        issues: h32Ledger.issues
      }
    },
    duplicateSeeds,
    gaps: {
      unownedSharedFiles,
      duplicateSharedOwnership,
      unscannedH31Files,
      emptyH31Scopes: h31Ledger.scopeGaps,
      emptyH32Scopes: h32Ledger.scopeGaps
    }
  };

  const markdown = renderMarkdown(report);

  await fsPromises.mkdir(path.dirname(outputJsonPath), { recursive: true });
  await fsPromises.mkdir(path.dirname(outputMarkdownPath), { recursive: true });
  await fsPromises.writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fsPromises.writeFile(outputMarkdownPath, markdown);
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
