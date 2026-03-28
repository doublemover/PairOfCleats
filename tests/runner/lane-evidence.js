import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { discoverTests } from './run-discovery.js';
import { loadRunRules } from './run-config.js';
import { loadLaneManifestConfig } from './lane-manifests.js';

const DEFAULT_HISTORICAL_TIMINGS_PATH = 'tools/test_times/TEST_TIMES.md';

const HOTSPOT_RULES = [
  { kind: 'lsp-bootstrap', match: /^tooling\/lsp\//u, note: 'Dedicated/configured provider bootstrap and session reuse.' },
  { kind: 'api-server-boot', match: /^services\/api\//u, note: 'HTTP server startup, routing, and streaming harness reuse.' },
  { kind: 'cli-cold-start', match: /^cli\//u, note: 'CLI process startup and argument-routing overlap.' },
  { kind: 'index-build-heavy', match: /^(indexing\/|tooling\/triage\/|storage\/sqlite\/build)/u, note: 'Index construction, replay, and build-heavy setup overlap.' }
];

const toPosix = (value) => String(value || '').replace(/\\/g, '/');
const stripTestsPrefix = (value) => toPosix(value).replace(/^tests\//u, '');

const parseOrderFile = async (filePath) => {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

const toRoundedMs = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Number(numeric.toFixed(3)));
};

const familyFromId = (id) => {
  const parts = String(id || '').split('/').filter(Boolean);
  return parts.slice(0, Math.min(2, parts.length)).join('/');
};

const hotspotKindForId = (id) => {
  for (const rule of HOTSPOT_RULES) {
    if (rule.match.test(String(id || ''))) {
      return rule.kind;
    }
  }
  return 'other';
};

export const parseHistoricalTestTimes = (raw) => {
  const lines = String(raw || '').split(/\r?\n/u);
  const byPath = new Map();
  for (const line of lines) {
    const match = line.match(/^- ([0-9-]{10} [0-9:]{8}) \| `([^`]+)` \| ([0-9.]+)s \| (.+)$/u);
    if (!match) continue;
    const recordedAt = `${match[1]}Z`;
    const relPath = toPosix(match[2]);
    const durationMs = Math.round(Number(match[3]) * 1000);
    if (!Number.isFinite(durationMs)) continue;
    const normalizedPaths = new Set([relPath, stripTestsPrefix(relPath)]);
    for (const normalizedPath of normalizedPaths) {
      if (!normalizedPath) continue;
      const existing = byPath.get(normalizedPath);
      if (existing && String(existing.recordedAt) >= recordedAt) continue;
      byPath.set(normalizedPath, {
        path: normalizedPath,
        durationMs,
        recordedAt,
        status: match[4]
      });
    }
  }
  return byPath;
};

const loadHistoricalTestTimes = async (filePath) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return parseHistoricalTestTimes(raw);
  } catch {
    return new Map();
  }
};

const parseLogTimesArtifact = async (filePath) => {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  const byId = new Map();
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)ms\t(.+)$/u);
    if (!match) continue;
    const id = String(match[2] || '').trim();
    const durationMs = Number(match[1]);
    if (!id || !Number.isFinite(durationMs)) continue;
    if (!byId.has(id)) byId.set(id, durationMs);
  }
  return byId;
};

const parseJsonTimingsArtifact = async (filePath) => {
  const parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
  const byId = new Map();
  const tests = Array.isArray(parsed?.tests) ? parsed.tests : [];
  for (const row of tests) {
    const id = String(row?.id || '').trim();
    const durationMs = Number(row?.durationMs);
    if (!id || !Number.isFinite(durationMs)) continue;
    if (!byId.has(id)) byId.set(id, durationMs);
  }
  return byId;
};

const loadTimingArtifacts = async ({ root, timingArtifactPaths = [] }) => {
  const maps = [];
  const resolvedPaths = [];
  for (const rawPath of timingArtifactPaths) {
    const trimmed = String(rawPath || '').trim();
    if (!trimmed) continue;
    const absolutePath = path.resolve(root, trimmed);
    try {
      await fsPromises.access(absolutePath);
    } catch {
      continue;
    }
    const parser = absolutePath.endsWith('.json')
      ? parseJsonTimingsArtifact
      : parseLogTimesArtifact;
    try {
      maps.push(await parser(absolutePath));
      resolvedPaths.push(absolutePath);
    } catch {}
  }
  return { maps, resolvedPaths };
};

const getDurationFromTimingMaps = (maps, id) => {
  for (const map of maps) {
    if (map.has(id)) {
      return map.get(id);
    }
  }
  return null;
};

const buildPathById = async (root) => {
  const runRules = loadRunRules({ root });
  const testsDir = path.join(root, 'tests');
  const discovered = await discoverTests({
    testsDir,
    excludedDirs: runRules.excludedDirs,
    excludedFiles: runRules.excludedFiles
  });
  return new Map(discovered.map((entry) => [entry.id, toPosix(entry.relPath)]));
};

const summarizeRows = (rows, keyFn) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const current = map.get(key) || {
      key,
      count: 0,
      knownDurationMs: 0,
      unknownDurationCount: 0
    };
    current.count += 1;
    if (Number.isFinite(row.durationMs)) {
      current.knownDurationMs += Number(row.durationMs);
    } else {
      current.unknownDurationCount += 1;
    }
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => (
    (b.knownDurationMs - a.knownDurationMs)
    || (b.count - a.count)
    || String(a.key).localeCompare(String(b.key))
  ));
};

export const buildLaneEvidenceReport = ({ laneRows = [] } = {}) => {
  const allRows = laneRows.flatMap((lane) => lane.rows || []);
  const duplicates = new Map();
  for (const lane of laneRows) {
    for (const row of lane.rows || []) {
      const existing = duplicates.get(row.id) || {
        id: row.id,
        path: row.path || '',
        lanes: [],
        durationsByLane: {}
      };
      existing.lanes.push(lane.lane);
      if (Number.isFinite(row.durationMs)) {
        existing.durationsByLane[lane.lane] = row.durationMs;
      }
      duplicates.set(row.id, existing);
    }
  }

  const exactDuplicates = Array.from(duplicates.values())
    .filter((entry) => entry.lanes.length > 1)
    .sort((a, b) => (
      (b.lanes.length - a.lanes.length)
      || String(a.id).localeCompare(String(b.id))
    ));

  const families = summarizeRows(allRows, (row) => familyFromId(row.id));
  const hotspots = summarizeRows(
    allRows.filter((row) => hotspotKindForId(row.id) !== 'other'),
    (row) => hotspotKindForId(row.id)
  ).map((entry) => ({
    ...entry,
    note: HOTSPOT_RULES.find((rule) => rule.kind === entry.key)?.note || ''
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      lanes: laneRows.length,
      tests: allRows.length,
      exactDuplicates: exactDuplicates.length,
      hotspotKinds: hotspots.length,
      families: families.length,
      timingCoverage: {
        freshArtifactTests: allRows.filter((row) => row.timingSource === 'timing-artifact').length,
        historicalFallbackTests: allRows.filter((row) => row.timingSource === 'historical-test-times').length,
        missingTests: allRows.filter((row) => row.timingSource === 'missing').length
      }
    },
    lanes: laneRows.map((lane) => ({
      lane: lane.lane,
      targetMaxDurationSeconds: lane.targetMaxDurationSeconds,
      orderFile: lane.orderFile,
      timingArtifactPath: lane.timingArtifactPath,
      totalTests: lane.rows.length,
      knownDurationTests: lane.rows.filter((row) => Number.isFinite(row.durationMs)).length,
      knownDurationMs: toRoundedMs(
        lane.rows.reduce((sum, row) => sum + (Number.isFinite(row.durationMs) ? Number(row.durationMs) : 0), 0)
      ),
      resolvedTimingArtifactPaths: Array.isArray(lane.resolvedTimingArtifactPaths)
        ? lane.resolvedTimingArtifactPaths
        : [],
      timingSources: Object.fromEntries(
        summarizeRows(lane.rows, (row) => row.timingSource)
          .map((entry) => [entry.key, entry.count])
      )
    })),
    exactDuplicates,
    families,
    hotspots
  };
};

const renderMarkdown = ({ report, root, historicalTimingsPath }) => {
  const lines = [
    '# Lane Evidence',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## How To Use',
    '',
    '- Use this report before deleting or merging tests; cite the family, duplicate, and hotspot rows you relied on.',
    '- Prefer consolidating repeated setup families before deleting deep-path edge cases.',
    '- When a standalone test is removed, name the surviving owner suite that now covers the behavior.',
    '- Prefer fresh lane timing artifacts when available; historical fallback rows are a stopgap, not a replacement for current lane measurements.',
    `- Historical timing fallback source: \`${toPosix(path.relative(root, historicalTimingsPath))}\`.`,
    '',
    '## Lane Summary',
    ''
  ];
  for (const lane of report.lanes) {
    lines.push(
      `- \`${lane.lane}\`: ${lane.totalTests} tests, ${lane.knownDurationTests} with timings, `
      + `${lane.knownDurationMs ?? 0} ms known duration, target ${lane.targetMaxDurationSeconds}s`
    );
    if (lane.resolvedTimingArtifactPaths?.length) {
      lines.push(`  fresh artifacts: ${lane.resolvedTimingArtifactPaths.map((item) => `\`${item}\``).join(', ')}`);
    }
  }
  lines.push('', '## Exact Cross-Lane Duplicates', '');
  if (!report.exactDuplicates.length) {
    lines.push('- None');
  } else {
    for (const entry of report.exactDuplicates) {
      lines.push(`- \`${entry.id}\` in ${entry.lanes.join(', ')}`);
    }
  }
  lines.push('', '## Top Families', '');
  for (const entry of report.families.slice(0, 15)) {
    lines.push(`- \`${entry.key}\`: ${entry.count} tests, ${entry.knownDurationMs} ms known duration`);
  }
  lines.push('', '## Setup Hotspots', '');
  for (const entry of report.hotspots) {
    lines.push(`- \`${entry.key}\`: ${entry.count} tests, ${entry.knownDurationMs} ms known duration`);
    if (entry.note) lines.push(`  ${entry.note}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
};

export const generateLaneEvidence = async ({
  root = process.cwd(),
  historicalTimingsPath = path.join(process.cwd(), DEFAULT_HISTORICAL_TIMINGS_PATH),
  outputJsonPath = path.join(process.cwd(), 'docs', 'testing', 'lane-evidence.json'),
  outputMarkdownPath = path.join(process.cwd(), 'docs', 'testing', 'lane-evidence.md'),
  writeTimingArtifacts = true
} = {}) => {
  const config = await loadLaneManifestConfig({ root });
  const pathById = await buildPathById(root);
  const historicalByPath = await loadHistoricalTestTimes(historicalTimingsPath);
  const laneRows = [];

  for (const laneConfig of config.orderedLanes.values()) {
    const ids = await parseOrderFile(laneConfig.orderFilePath);
    const { maps: timingMaps, resolvedPaths } = await loadTimingArtifacts({
      root,
      timingArtifactPaths: laneConfig.timingArtifactPaths
    });
    const timingArtifactPath = laneConfig.timingArtifactPaths[0]
      ? path.resolve(root, laneConfig.timingArtifactPaths[0])
      : '';
    const rows = ids.map((id) => {
      const relPath = pathById.get(id) || '';
      const durationFromArtifact = getDurationFromTimingMaps(timingMaps, id);
      const historical = relPath ? historicalByPath.get(relPath) : null;
      const durationMs = Number.isFinite(durationFromArtifact)
        ? Number(durationFromArtifact)
        : (historical?.durationMs ?? null);
      return {
        id,
        path: relPath,
        durationMs,
        timingSource: Number.isFinite(durationFromArtifact)
          ? 'timing-artifact'
          : (historical ? 'historical-test-times' : 'missing')
      };
    });
    laneRows.push({
      lane: laneConfig.lane,
      orderFile: toPosix(path.relative(root, laneConfig.orderFilePath)),
      timingArtifactPath: timingArtifactPath ? toPosix(path.relative(root, timingArtifactPath)) : '',
      resolvedTimingArtifactPaths: resolvedPaths.map((item) => toPosix(path.relative(root, item))),
      targetMaxDurationSeconds: laneConfig.targetMaxDurationSeconds,
      rows
    });
    if (writeTimingArtifacts && timingArtifactPath) {
      await fsPromises.mkdir(path.dirname(timingArtifactPath), { recursive: true });
      const timingLines = rows
        .filter((row) => Number.isFinite(row.durationMs))
        .map((row) => `${Math.round(Number(row.durationMs))}ms\t${row.id}`);
      await fsPromises.writeFile(timingArtifactPath, `${timingLines.join('\n')}\n`, 'utf8');
    }
  }

  const report = buildLaneEvidenceReport({ laneRows });
  await fsPromises.mkdir(path.dirname(outputJsonPath), { recursive: true });
  await fsPromises.writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fsPromises.mkdir(path.dirname(outputMarkdownPath), { recursive: true });
  await fsPromises.writeFile(
    outputMarkdownPath,
    renderMarkdown({ report, root, historicalTimingsPath }),
    'utf8'
  );
  return {
    report,
    outputJsonPath,
    outputMarkdownPath,
    laneRows
  };
};
