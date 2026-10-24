import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import picomatch from 'picomatch';
import { toPosix } from '../../../src/shared/file-paths.js';
import { writeJsonFileResolved } from '../../../src/shared/json-file.js';
import { writeTextIfChanged } from '../../shared/generated-report.js';

const POLICY_VERSION = '2.0.0';

export const CRITICAL_TEST_COVERAGE_SURFACES = Object.freeze([
  {
    id: 'cli',
    label: 'CLI',
    patterns: [
      'bin/**',
      'build_index.js',
      'search.js',
      'src/shared/cli.js',
      'src/shared/cli-options.js',
      'src/shared/dispatch/**'
    ]
  },
  {
    id: 'api',
    label: 'API',
    patterns: [
      'tools/api/**',
      'src/shared/runtime-capability-manifest.js'
    ]
  },
  {
    id: 'mcp',
    label: 'MCP',
    patterns: [
      'tools/mcp/**'
    ]
  },
  {
    id: 'indexing-runtime',
    label: 'Indexing / Runtime',
    patterns: [
      'build_index.js',
      'src/index/**',
      'tools/index/**'
    ]
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    patterns: [
      'search.js',
      'src/retrieval/**'
    ]
  },
  {
    id: 'tui',
    label: 'TUI',
    patterns: [
      'bin/pairofcleats-tui.js',
      'src/tui/**',
      'tools/tui/**',
      'crates/pairofcleats-tui/**'
    ]
  },
  {
    id: 'release-packaging',
    label: 'Release / Packaging',
    patterns: [
      'tools/release/**',
      'tools/package-sublime.js',
      'tools/package-vscode.js',
      'tools/setup/postinstall.js'
    ]
  }
]);

const runGit = (root, args) => spawnSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

export const parseGitPathList = value => new Set(String(value || '').split('\0').filter(Boolean));

const toCoverageFraction = (coveredRanges, totalRanges) => {
  const total = Number(totalRanges);
  const covered = Number(coveredRanges);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(covered) || covered <= 0) return 0;
  return Number((Math.min(covered, total) / total).toFixed(4));
};

const summarizeCoverageEntries = (entries) => {
  const normalized = Array.isArray(entries) ? entries : [];
  const summary = normalized.reduce((acc, entry) => {
    acc.files += 1;
    acc.coveredRanges += Number(entry?.coveredRanges || 0);
    acc.totalRanges += Number(entry?.totalRanges || 0);
    return acc;
  }, {
    files: 0,
    coveredRanges: 0,
    totalRanges: 0
  });
  summary.coveredRanges = Number(summary.coveredRanges.toFixed(3));
  summary.totalRanges = Number(summary.totalRanges.toFixed(3));
  summary.coverageFraction = toCoverageFraction(summary.coveredRanges, summary.totalRanges);
  return summary;
};

const normalizeCoverageEntries = (entries) => (Array.isArray(entries) ? entries : [])
  .map((entry) => ({
    path: process.platform === 'win32' ? toPosix(String(entry?.path || '')) : String(entry?.path || ''),
    coveredRanges: Number(entry?.coveredRanges || 0),
    totalRanges: Number(entry?.totalRanges || 0)
  }))
  .filter((entry) => entry.path)
  .sort((a, b) => a.path.localeCompare(b.path));

const buildEntryRows = (entries) => normalizeCoverageEntries(entries).map((entry) => ({
  ...entry,
  coverageFraction: toCoverageFraction(entry.coveredRanges, entry.totalRanges)
}));

const resolveGitRangeFromEvent = (root, env = process.env) => {
  const eventPath = String(env.GITHUB_EVENT_PATH || '').trim();
  if (!eventPath) return null;
  try {
    const payload = JSON.parse(requireText(eventPath));
    const baseSha = String(payload?.pull_request?.base?.sha || '').trim();
    const headSha = String(payload?.pull_request?.head?.sha || '').trim();
    if (!baseSha || !headSha) return null;
    const probe = runGit(root, ['diff', '--name-only', '-z', `${baseSha}...${headSha}`]);
    if (probe.status !== 0) return null;
    return {
      strategy: 'github-pull-request-range',
      baseRef: baseSha,
      headRef: headSha,
      paths: Array.from(parseGitPathList(probe.stdout)).sort()
    };
  } catch {
    return null;
  }
};

const requireText = (filePath) => fsSync.readFileSync(path.resolve(filePath), 'utf8');

const resolveChangedFilesFromGit = ({ root, baseRef = '', headRef = '', env = process.env }) => {
  const explicitBase = String(baseRef || '').trim();
  const explicitHead = String(headRef || '').trim();
  if (explicitBase && explicitHead) {
    const result = runGit(root, ['diff', '--name-only', '-z', `${explicitBase}...${explicitHead}`]);
    if (result.status === 0) {
      return {
        available: true,
        strategy: 'explicit-git-range',
        baseRef: explicitBase,
        headRef: explicitHead,
        reason: null,
        paths: Array.from(parseGitPathList(result.stdout)).sort()
      };
    }
  }

  const fromEvent = resolveGitRangeFromEvent(root, env);
  if (fromEvent) {
    return {
      available: true,
      ...fromEvent,
      reason: null
    };
  }

  const parentRange = runGit(root, ['rev-parse', '--verify', 'HEAD^']);
  if (parentRange.status === 0) {
    const result = runGit(root, ['diff', '--name-only', '-z', 'HEAD^...HEAD']);
    if (result.status === 0) {
      const paths = Array.from(parseGitPathList(result.stdout)).sort();
      const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
      const merged = new Set(paths);
      if (untracked.status === 0) {
        for (const entry of parseGitPathList(untracked.stdout)) merged.add(entry);
      }
      return {
        available: true,
        strategy: 'head-parent-range',
        baseRef: 'HEAD^',
        headRef: 'HEAD',
        reason: null,
        paths: Array.from(merged).sort()
      };
    }
  }

  const diff = runGit(root, ['diff', '--name-only', '-z', 'HEAD']);
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (diff.status === 0 && untracked.status === 0) {
    const merged = new Set([
      ...parseGitPathList(diff.stdout),
      ...parseGitPathList(untracked.stdout)
    ]);
    return {
      available: true,
      strategy: 'working-tree',
      baseRef: null,
      headRef: 'WORKTREE',
      reason: null,
      paths: Array.from(merged).sort()
    };
  }

  return {
    available: false,
    strategy: 'unavailable',
    baseRef: explicitBase || null,
    headRef: explicitHead || null,
    reason: 'git diff resolution failed',
    paths: []
  };
};

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const coveragePath = value => process.platform === 'win32' ? toPosix(value) : String(value);

export const joinChangedCoverageInventory = ({ root, paths, entries, deletedPaths = [], exclusions = [] }) => {
  const observed = new Map(normalizeCoverageEntries(entries).map(row => [row.path, row]));
  const deleted = new Set(deletedPaths);
  const excluded = new Map(exclusions.map(row => [row.path, row.reason]));
  return [...new Set(paths)].sort().map(label => {
    const row = { path: label, status: 'unobserved', reason: 'no-v8-observation',
      coveredRanges: null, totalRanges: null, coverageFraction: null };
    if (deleted.has(label)) return { ...row, status: 'deleted', reason: 'git-target-deletion' };
    if (excluded.has(label)) return { ...row, status: 'excluded', reason: excluded.get(label) || 'declared-exclusion' };
    const target = path.resolve(root, label);
    const relative = path.relative(path.resolve(root), target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { ...row, status: 'unsupported', reason: 'outside-source-root' };
    let stat;
    try { stat = fsSync.lstatSync(target); }
    catch (error) { return { ...row, status: error.code === 'ENOENT' ? 'absent' : 'unavailable', reason: error.code || 'source-stat-failed' }; }
    if (!stat.isFile() || stat.isSymbolicLink()) return { ...row, status: 'unsupported', reason: 'not-an-instrumentable-regular-file' };
    const measurement = observed.get(coveragePath(label));
    if (measurement && Number.isFinite(measurement.totalRanges) && measurement.totalRanges > 0
      && Number.isFinite(measurement.coveredRanges) && measurement.coveredRanges >= 0) return { ...row, ...measurement, status: 'observed', reason: null,
      coverageFraction: toCoverageFraction(measurement.coveredRanges, measurement.totalRanges) };
    if (!SOURCE_EXTENSIONS.has(path.extname(label).toLowerCase())) return { ...row, status: 'unsupported', reason: 'no-supported-v8-source-instrumentation' };
    return row;
  });
};

const summarizeMeasurement = (inventory, available = true) => {
  const counts = Object.fromEntries(['observed', 'unobserved', 'deleted', 'absent', 'unsupported', 'excluded', 'unavailable']
    .map(status => [status, inventory.filter(row => row.status === status).length]));
  const eligibleFiles = counts.observed + counts.unobserved + counts.unavailable + counts.absent;
  return { changedFiles: inventory.length, eligibleFiles, measuredFiles: counts.observed, counts,
    status: !available ? 'unavailable' : !eligibleFiles ? 'not-applicable'
      : counts.unobserved + counts.unavailable + counts.absent > 0 ? 'partial' : 'complete',
    denominator: 'observed-ranges-only' };
};

const buildCriticalSurfaceSummary = (entries, changedInventory, available) => {
  const normalizedEntries = normalizeCoverageEntries(entries);
  return CRITICAL_TEST_COVERAGE_SURFACES.map((surface) => {
    const isMatch = picomatch(surface.patterns, { dot: true });
    const matchedEntries = normalizedEntries.filter((entry) => isMatch(entry.path));
    return {
      id: surface.id,
      label: surface.label,
      patterns: surface.patterns.slice(),
      summary: summarizeCoverageEntries(matchedEntries),
      changedInventory: changedInventory.filter(row => isMatch(row.path)),
      measurement: summarizeMeasurement(changedInventory.filter(row => isMatch(row.path)), available),
      topUncoveredFiles: buildEntryRows(matchedEntries)
        .filter((entry) => entry.coverageFraction !== null && entry.coverageFraction < 1)
        .sort((a, b) => {
          if ((a.coverageFraction ?? 1) !== (b.coverageFraction ?? 1)) {
            return (a.coverageFraction ?? 1) - (b.coverageFraction ?? 1);
          }
          return a.path.localeCompare(b.path);
        })
        .slice(0, 5)
    };
  });
};

export const buildCoveragePolicyReport = ({
  coverageArtifact,
  root,
  mode = '',
  baseRef = '',
  headRef = '',
  env = process.env
}) => {
  const entries = normalizeCoverageEntries(coverageArtifact?.entries);
  const changed = resolveChangedFilesFromGit({ root, baseRef, headRef, env });
  let deletedPaths = [];
  if (changed.available) {
    const range = changed.strategy === 'working-tree' ? ['HEAD'] : [`${changed.baseRef}...${changed.headRef}`];
    const deleted = runGit(root, ['diff', '--diff-filter=D', '--name-only', '-z', ...range]);
    if (deleted.status === 0) deletedPaths = [...parseGitPathList(deleted.stdout)];
  }
  const inventory = joinChangedCoverageInventory({ root, paths: changed.paths, entries, deletedPaths,
    exclusions: coverageArtifact?.exclusions || [] });
  const changedEntries = inventory.filter(row => row.status === 'observed');
  const changedRows = buildEntryRows(changedEntries)
    .sort((a, b) => {
      if ((a.coverageFraction ?? 1) !== (b.coverageFraction ?? 1)) {
        return (a.coverageFraction ?? 1) - (b.coverageFraction ?? 1);
      }
      return a.path.localeCompare(b.path);
    });

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    kind: 'test-coverage-policy-report',
    policyVersion: POLICY_VERSION,
    mode: String(mode || ''),
    sourceCoverageKind: String(coverageArtifact?.kind || ''),
    sourceCoverageRunId: String(coverageArtifact?.runId || ''),
    overall: summarizeCoverageEntries(entries),
    changedFiles: {
      available: changed.available,
      strategy: changed.strategy,
      baseRef: changed.baseRef,
      headRef: changed.headRef,
      reason: changed.reason,
      summary: summarizeCoverageEntries(changedEntries),
      files: changedRows,
      inventory,
      measurement: summarizeMeasurement(inventory, changed.available)
    },
    criticalSurfaces: buildCriticalSurfaceSummary(entries, inventory, changed.available),
    policy: {
      phase: 'report-only',
      progression: [
        'report changed-file and critical-surface coverage in CI artifacts',
        'require changed-file coverage visibility on pull requests',
        'gate only after signal quality is stable and trusted'
      ]
    }
  };
};

const formatPercent = (value) => (
  value == null ? 'n/a' : `${(Number(value) * 100).toFixed(1)}%`
);

export const renderCoveragePolicyMarkdown = (report) => {
  const lines = [
    '# Coverage Policy Report',
    '',
    `- mode: \`${report.mode || 'unknown'}\``,
    `- source run: \`${report.sourceCoverageRunId || 'unknown'}\``,
    `- overall coverage: ${formatPercent(report.overall.coverageFraction)} `
      + `(${report.overall.coveredRanges}/${report.overall.totalRanges} ranges across ${report.overall.files} files)`,
    `- policy phase: \`${report.policy.phase}\``,
    ''
  ];

  lines.push('## Changed files');
  lines.push('');
  lines.push(`- available: ${report.changedFiles.available ? 'yes' : 'no'}`);
  lines.push(`- strategy: ${report.changedFiles.strategy}`);
  const measurement = report.changedFiles.measurement;
  lines.push(`- measurement: ${measurement.status}; ${measurement.measuredFiles}/${measurement.eligibleFiles} eligible changed files observed (${measurement.changedFiles} changed paths)`);
  lines.push('- range percentages use observed ranges only; unknown denominators remain unknown.');
  if (report.changedFiles.baseRef || report.changedFiles.headRef) {
    lines.push(`- range: \`${report.changedFiles.baseRef || 'n/a'} -> ${report.changedFiles.headRef || 'n/a'}\``);
  }
  if (report.changedFiles.reason) {
    lines.push(`- reason: ${report.changedFiles.reason}`);
  }
  lines.push(
    `- summary: ${formatPercent(report.changedFiles.summary.coverageFraction)} `
    + `(${report.changedFiles.summary.coveredRanges}/${report.changedFiles.summary.totalRanges} ranges `
    + `across ${report.changedFiles.summary.files} files)`
  );
  for (const entry of report.changedFiles.files.slice(0, 10)) {
    lines.push(
      `- \`${entry.path}\`: ${formatPercent(entry.coverageFraction)} `
      + `(${entry.coveredRanges}/${entry.totalRanges})`
    );
  }
  for (const row of report.changedFiles.inventory.filter(row => row.status !== 'observed')) {
    lines.push(`- ${JSON.stringify(row.path)}: ${row.status} (${row.reason || 'unknown'}; ranges unknown)`);
  }
  if (!report.changedFiles.files.length) {
    lines.push('- (no changed-file coverage rows)');
  }
  lines.push('');

  lines.push('## Critical surfaces');
  lines.push('');
  for (const surface of report.criticalSurfaces) {
    lines.push(
      `- ${surface.label}: ${formatPercent(surface.summary.coverageFraction)} `
      + `(${surface.summary.coveredRanges}/${surface.summary.totalRanges} ranges across ${surface.summary.files} files)`
    );
    lines.push(`  - changed measurement: ${surface.measurement.status}; ${surface.measurement.measuredFiles}/${surface.measurement.eligibleFiles} eligible paths observed`);
    for (const row of surface.changedInventory.filter(row => row.status !== 'observed')) lines.push(`  - ${JSON.stringify(row.path)}: ${row.status}; ranges unknown`);
    for (const entry of surface.topUncoveredFiles.slice(0, 3)) {
      lines.push(`  - \`${entry.path}\`: ${formatPercent(entry.coverageFraction)}`);
    }
  }
  lines.push('');
  lines.push('## Policy progression');
  lines.push('');
  for (const step of report.policy.progression) {
    lines.push(`- ${step}`);
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
};

export const writeCoveragePolicyReport = async ({
  report,
  outputPath,
  markdownPath = ''
}) => {
  const resolvedOutput = path.resolve(outputPath);
  await writeJsonFileResolved(resolvedOutput, report, { trailingNewline: true });
  let resolvedMarkdown = '';
  if (String(markdownPath || '').trim()) {
    resolvedMarkdown = path.resolve(markdownPath);
    await writeTextIfChanged(resolvedMarkdown, renderCoveragePolicyMarkdown(report), { encoding: 'utf8' });
  }
  return {
    outputPath: resolvedOutput,
    markdownPath: resolvedMarkdown
  };
};
