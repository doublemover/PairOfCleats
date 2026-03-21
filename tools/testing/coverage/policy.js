import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import picomatch from 'picomatch';
import { toPosix } from '../../../src/shared/files.js';

const POLICY_VERSION = '1.0.0';

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

const parseGitPathList = (value) => new Set(
  String(value || '')
    .split(/\r?\n/)
    .map((entry) => toPosix(entry.trim()))
    .filter(Boolean)
);

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
    path: toPosix(String(entry?.path || '')),
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
    const probe = runGit(root, ['diff', '--name-only', `${baseSha}...${headSha}`]);
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
    const result = runGit(root, ['diff', '--name-only', `${explicitBase}...${explicitHead}`]);
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
    const result = runGit(root, ['diff', '--name-only', 'HEAD^...HEAD']);
    if (result.status === 0) {
      const paths = Array.from(parseGitPathList(result.stdout)).sort();
      const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard']);
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

  const diff = runGit(root, ['diff', '--name-only', 'HEAD']);
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard']);
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

const filterEntriesToPaths = (entries, changedPaths) => {
  const wanted = new Set((Array.isArray(changedPaths) ? changedPaths : []).map((entry) => toPosix(entry)));
  return normalizeCoverageEntries(entries).filter((entry) => wanted.has(entry.path));
};

const buildCriticalSurfaceSummary = (entries) => {
  const normalizedEntries = normalizeCoverageEntries(entries);
  return CRITICAL_TEST_COVERAGE_SURFACES.map((surface) => {
    const isMatch = picomatch(surface.patterns, { dot: true });
    const matchedEntries = normalizedEntries.filter((entry) => isMatch(entry.path));
    return {
      id: surface.id,
      label: surface.label,
      patterns: surface.patterns.slice(),
      summary: summarizeCoverageEntries(matchedEntries),
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
  const changedEntries = changed.available ? filterEntriesToPaths(entries, changed.paths) : [];
  const changedRows = buildEntryRows(changedEntries)
    .sort((a, b) => {
      if ((a.coverageFraction ?? 1) !== (b.coverageFraction ?? 1)) {
        return (a.coverageFraction ?? 1) - (b.coverageFraction ?? 1);
      }
      return a.path.localeCompare(b.path);
    });

  return {
    schemaVersion: 1,
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
      files: changedRows
    },
    criticalSurfaces: buildCriticalSurfaceSummary(entries),
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
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  let resolvedMarkdown = '';
  if (String(markdownPath || '').trim()) {
    resolvedMarkdown = path.resolve(markdownPath);
    await fs.mkdir(path.dirname(resolvedMarkdown), { recursive: true });
    await fs.writeFile(resolvedMarkdown, renderCoveragePolicyMarkdown(report), 'utf8');
  }
  return {
    outputPath: resolvedOutput,
    markdownPath: resolvedMarkdown
  };
};
