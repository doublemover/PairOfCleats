#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArtifactSchemaIndex } from '../../../src/contracts/artifact-schema-index.js';
import { USR_REPORT_SCHEMA_DEFS, USR_SCHEMA_DEFS } from '../../../src/contracts/schemas/usr.js';
import { loadRunRules } from '../../runner/run-config.js';
import {
  applyFilters,
  assignLane,
  buildTags,
  compileMatchers,
  discoverTests,
  resolveLanes
} from '../../runner/run-discovery.js';

const root = process.cwd();
const CURRENT_READINESS_GATE_LOG = 'temp/validation/readiness-gate-current-technical-validation-20260522.log';
const LATEST_EVIDENCE_CITATION_LOG = 'temp/validation/readiness-evidence-citation-final-20260522.log';
const CURRENT_ROADMAP_AUDIT_DATE = '2026-05-22';

const splitMarkdownRow = (line) => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map((cell) => cell.trim());

const checkboxState = (text, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^- \\[([ xX])\\] ${escaped}$`, 'm'));
  assert.ok(match, `missing checklist row: ${label}`);
  return match[1].toLowerCase();
};

const assertChecked = (text, label) => {
  assert.equal(checkboxState(text, label), 'x', `expected checked row: ${label}`);
};

const readMarkdownTableAfterHeading = (text, heading) => {
  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  assert.notEqual(headingIndex, -1, `missing markdown heading ${heading}`);

  const headerIndex = lines.findIndex((line, index) => index > headingIndex && line.trim().startsWith('|'));
  assert.notEqual(headerIndex, -1, `missing markdown table after ${heading}`);
  const header = splitMarkdownRow(lines[headerIndex]);
  const separator = splitMarkdownRow(lines[headerIndex + 1] || '');
  assert.equal(separator.length, header.length, `markdown table after ${heading} has malformed separator`);
  assert.ok(separator.every((cell) => /^:?-{3,}:?$/.test(cell)), `markdown table after ${heading} has invalid separator`);

  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) break;
    const cells = splitMarkdownRow(line);
    assert.equal(cells.length, header.length, `markdown table row after ${heading} has wrong cell count`);
    rows.push(Object.fromEntries(header.map((name, cellIndex) => [name, cells[cellIndex]])));
  }
  return { header, rows };
};

const durationToMs = (duration) => {
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === 's' ? value * 1000 : value;
};

const extractTimedTestDurations = (logText) => [...logText.matchAll(/\b(?:PASS|FAIL|TIME(?:OUT)?)\s+\[\s*([0-9.]+(?:ms|s))\]/g)]
  .map((match) => durationToMs(match[1]))
  .filter((value) => value !== null);

const parseReleasePlanRunnerCommand = (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('node tests/run.js ')) return null;
  if (trimmed.includes('<test-id-or-substring>')) return null;
  const tokens = trimmed
    .slice('node tests/run.js '.length)
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const selectors = [];
  const lanes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') break;
    if (token === '--lane') {
      if (tokens[index + 1]) lanes.push(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith('--lane=')) {
      lanes.push(token.slice('--lane='.length));
      continue;
    }
    if (token.startsWith('--')) {
      if (!token.includes('=') && tokens[index + 1] && !tokens[index + 1].startsWith('--')) index += 1;
      continue;
    }
    selectors.push(token);
  }
  return { line: trimmed, selectors, lanes };
};

const selectTestsForCommand = ({ command, selector = null, tests, runRules }) => {
  const requestedLanes = command.lanes.length ? command.lanes : ['ci'];
  const resolvedLanes = resolveLanes(requestedLanes, runRules.knownLanes);
  const includeMatchers = compileMatchers(selector ? [selector] : command.selectors, 'release-plan-selector');
  const { selected, skipped } = applyFilters({
    tests,
    lanes: resolvedLanes,
    includeMatchers,
    excludeMatchers: [],
    tagInclude: [],
    tagExclude: []
  });
  return { selected, skipped };
};

assert.deepEqual(
  extractTimedTestDurations('PASS [ 12ms] a\nTIME [ 30.2s] b\nTIMEOUT [ 31s] c\nFAIL [ 1.5s] d'),
  [12, 30200, 31000, 1500],
  'release evidence parser must count PASS, FAIL, TIME, and TIMEOUT duration rows'
);

const walkMarkdownAndJsonDocs = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'archived') continue;
      walkMarkdownAndJsonDocs(abs, out);
      continue;
    }
    if (entry.isFile() && /\.(md|json)$/i.test(entry.name)) out.push(abs);
  }
  return out;
};

const backtickReferenceValuesByLine = (text) => {
  const refs = [];
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      refs.push({
        value: match[1].trim(),
        line,
        lineNumber: lineIndex + 1
      });
    }
  }
  return refs;
};

const expandSimpleBraceAlternates = (value) => {
  const match = value.match(/^(.*?)\{([^{}]+)\}(.*)$/);
  if (!match || !match[2].includes(',')) return [value];
  const [, prefix, body, suffix] = match;
  return body
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => expandSimpleBraceAlternates(`${prefix}${part}${suffix}`));
};

{
  const allowedHistoricalReferenceFiles = new Set([
    path.join(root, 'docs', 'roadmap.md'),
    path.join(root, 'docs', 'roadmap-release-validation-plan.md'),
    path.join(root, 'docs', 'tooling', 'repo-inventory.json')
  ]);
  const staleRoadmapPatterns = [
    /\bAINTKNOWMAP\.md\b/i,
    /\bFUTUREROADMAP\b/i,
    /\bGIGAMAP\b/i,
    /\bGIGAROADMAP(?:_2)?(?:\.md)?\b/i,
    /\bLEXI\.md\b/i,
    /\bSTAGE1_ORDERED_THROUGHPUT_REDESIGN\b/i,
    /\bTES_LAYN_(?:ROADMAP|EXECUTION_PACKS|GOVERNANCE)(?:\.md)?\b/i
  ];
  const issues = [];
  for (const abs of walkMarkdownAndJsonDocs(path.join(root, 'docs'))) {
    if (allowedHistoricalReferenceFiles.has(abs)) continue;
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const text = fs.readFileSync(abs, 'utf8');
    for (const pattern of staleRoadmapPatterns) {
      if (pattern.test(text)) issues.push(`${rel} references stale roadmap name ${pattern}`);
    }
  }
  assert.deepEqual(issues, [], 'active docs must use docs/roadmap.md instead of stale root roadmap names');
}

{
  const activeStatusDocs = [
    'docs/roadmap.md',
    'docs/roadmap-release-validation-plan.md',
    'docs/roadmap-release-validation-evidence-20260521.md',
    'docs/archived/usr-rollout-approval-lock.md',
    'docs/tooling/duplication-reduction-status.md'
  ];
  const filesystemPrefixes = [
    'docs/',
    'src/',
    'tests/',
    'tools/',
    'bin/',
    'extensions/',
    'sublime/',
    'assets/',
    'benchmarks/',
    'rules/',
    'temp/',
    '.testLogs/',
    '.github/'
  ];
  const historicalLineMarkers = [
    'deleted',
    'removed',
    'archived',
    'deprecated',
    'historical',
    'former ',
    'old ',
    'superseded',
    'moved ',
    'moved from',
    'has been removed',
    'has been deleted'
  ];
  const missing = [];
  for (const rel of activeStatusDocs) {
    const abs = path.join(root, rel.replace(/\//g, path.sep));
    const text = fs.readFileSync(abs, 'utf8');
    for (const ref of backtickReferenceValuesByLine(text)) {
      const token = ref.value;
      if (!/[\\/]/.test(token)) continue;
      if (/\s/.test(token)) continue;
      if (/[*?<>]/.test(token)) continue;
      if (/\.\.\./.test(token)) continue;
      if (token.startsWith('/') || token.startsWith('--')) continue;
      const candidates = expandSimpleBraceAlternates(token)
        .map((candidate) => candidate.replace(/[.,;:]$/u, ''));
      for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, '/');
        if (!filesystemPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;
        const candidatePath = path.join(root, candidate.replace(/\//g, path.sep));
        if (fs.existsSync(candidatePath)) continue;
        const lineLower = ref.line.toLowerCase();
        if (historicalLineMarkers.some((marker) => lineLower.includes(marker))) continue;
        missing.push(`${rel}:${ref.lineNumber} references missing active path ${candidate}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'active roadmap/status docs must not reference missing concrete file paths');
}

{
  const guidePath = path.join(root, 'docs', 'guides', 'perfplan-execution.md');
  const text = await fsPromises.readFile(guidePath, 'utf8');
  assert.ok(text.includes('# PERFPLAN Execution Guide'));
  assert.ok(/ROADMAP\.md|roadmap/i.test(text));
  assert.ok(text.includes('docs/guides/roadmap-checklists.md'));
  assert.ok(text.includes('docs/guides/jsdoc-standards.md'));
}

{
  const docPath = path.join(root, 'docs', 'guides', 'jsdoc-standards.md');
  const text = await fsPromises.readFile(docPath, 'utf8');
  assert.ok(text.includes('# JSDoc Standards'));
  assert.ok(text.includes('## Required sections'));
  assert.ok(text.includes('Performance'));
  assert.ok(text.includes('## Examples'));
}

{
  const docPath = path.join(root, 'docs', 'specs', 'embeddings-cache.md');
  const text = await fsPromises.readFile(docPath, 'utf8');
  assert.ok(text.includes('# Embeddings Cache'));
  assert.ok(text.includes('## Layout'));
  assert.ok(/##\s+Cache entry format/i.test(text));
  assert.ok(text.includes('## Invalidation'));
  assert.ok(text.includes('## Pruning'));
  assert.ok(text.includes('## Configuration'));
}

{
  const requiredDocs = [
    'docs/specs/vfs-manifest-artifact.md',
    'docs/specs/vfs-index.md',
    'docs/specs/vfs-hash-routing.md',
    'docs/specs/vfs-token-uris.md',
    'docs/specs/vfs-io-batching.md',
    'docs/specs/vfs-segment-hash-cache.md',
    'docs/specs/vfs-cdc-segmentation.md',
    'docs/specs/vfs-cold-start-cache.md',
    'docs/specs/tooling-provider-registry.md',
    'docs/specs/tooling-vfs-and-segment-routing.md',
    'docs/specs/map-artifact.md',
    'docs/perf/map-pipeline.md'
  ];
  for (const rel of requiredDocs) {
    const abs = path.join(root, rel);
    await fsPromises.access(abs);
  }
}

{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const targetPath = path.join(path.resolve(__dirname, '../../..'), 'docs', 'contracts', 'artifact-schema-index.json');
  const expected = buildArtifactSchemaIndex();
  const raw = await fsPromises.readFile(targetPath, 'utf8');
  const actual = JSON.parse(raw);
  assert.deepStrictEqual(actual, expected);
}

{
  const tablePath = path.join(root, 'docs', 'testing', 'truth-table.md');
  const raw = fs.readFileSync(tablePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const claims = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('- Claim:')) {
      if (current) claims.push(current);
      current = { line: i + 1, lines: [line] };
      continue;
    }
    if (current) {
      if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        claims.push(current);
        current = null;
        continue;
      }
      current.lines.push(line);
    }
  }
  if (current) claims.push(current);
  assert.ok(claims.length > 0, 'Truth table validation failed: no claims found.');

  const requiredLabels = ['Implementation:', 'Config:', 'Tests:', 'Limitations:'];
  const issues = [];
  const findLabelLine = (blockLines, label) => blockLines.find((line) => line.includes(label)) || null;
  for (const claim of claims) {
    const blockText = claim.lines.join('\n');
    for (const label of requiredLabels) {
      const line = findLabelLine(claim.lines, label);
      if (!line) {
        issues.push(`Claim at line ${claim.line} missing ${label}`);
        continue;
      }
      const content = line.split(label)[1];
      if (!content || !content.trim()) {
        issues.push(`Claim at line ${claim.line} has empty ${label}`);
      }
    }
    const testsLine = findLabelLine(claim.lines, 'Tests:');
    if (testsLine && !/tests\//.test(testsLine)) {
      issues.push(`Claim at line ${claim.line} Tests line missing tests/ reference`);
    }
    if (!testsLine && /Tests:/.test(blockText)) {
      issues.push(`Claim at line ${claim.line} has malformed Tests line`);
    }
  }
  assert.deepEqual(issues, []);
}

{
  const contractPath = path.join(root, 'docs', 'config', 'contract.md');
  const text = await fsPromises.readFile(contractPath, 'utf8');
  assert.ok(text.includes('indexing.embeddings.cache.scope'));
  assert.ok(text.includes('tooling.vfs'));
}

{
  const phase8Specs = [
    {
      rel: path.join('docs', 'specs', 'lsp-provider-hardening.md'),
      labels: [
        'Provider can return hover/signature results for `.poc-vfs/...` virtual paths.',
        'Provider outputs are keyed by `chunkUid`.',
        'Restart races do not corrupt active sessions (generation token test).',
        'Failure counts reflect per-target failures, not per-attempt.'
      ]
    },
    {
      rel: path.join('docs', 'specs', 'tooling-vfs-and-segment-routing.md'),
      labels: [
        'Embedded TS/JS segments inside `.md/.vue/.svelte/.astro` are routed to the correct provider.',
        'All tool outputs can be joined back to chunks by `chunkUid`.',
        'Offset mapping is validated and fails closed in strict mode.'
      ]
    }
  ];
  for (const spec of phase8Specs) {
    const text = await fsPromises.readFile(path.join(root, spec.rel), 'utf8');
    assert.match(
      text,
      /Status: Implemented for the required acceptance criteria.*temp\/validation\/lsp-vfs-focused-spec-acceptance-20260521\.log/,
      `${spec.rel} must record current implemented status and focused evidence`
    );
    for (const label of spec.labels) {
      assertChecked(text, label);
    }
  }
}

{
  const toolingApiSpec = await fsPromises.readFile(
    path.join(root, 'docs', 'specs', 'tooling-and-api-contract.md'),
    'utf8'
  );
  assert.match(
    toolingApiSpec,
    /\*\*Status:\*\* Active implemented public tooling\/API contract; current MCP schema version is `1\.4\.1`\./,
    'tooling/API contract spec must record active implemented status and current MCP schema version'
  );
  assert.doesNotMatch(
    toolingApiSpec,
    /Proposed \(Codex-ready\)|Explicit required code fix|src\/shared\/schema-version\.js|MCP Streamable HTTP transport is not implemented here/,
    'tooling/API contract spec must not retain stale draft or pre-fix implementation language'
  );

  const httpApiSpec = await fsPromises.readFile(path.join(root, 'docs', 'specs', 'http-api.md'), 'utf8');
  assert.match(
    httpApiSpec,
    /\*\*Implementation status:\*\* active implemented contract.*workspacePath-based federated search/,
    'HTTP API spec must record current implemented snapshot/diff/as-of/federated surface status'
  );
  assert.match(
    httpApiSpec,
    /`workspacePath` \(required, allowlisted\)[\s\S]*`workspaceId` \(optional cross-check against the resolved workspace\)/,
    'HTTP API spec must document workspacePath as required and workspaceId as a cross-check'
  );
  assert.doesNotMatch(
    httpApiSpec,
    /federation pending|pending Phase 14\.6|\(new\)/,
    'HTTP API spec must not retain stale pending/new route language for implemented surfaces'
  );
}

{
  const dispatcherSpec = await fsPromises.readFile(
    path.join(root, 'docs', 'specs', 'dispatcher-rewrite-and-search-reconciliation.md'),
    'utf8'
  );
  assert.match(
    dispatcherSpec,
    /## 3\. Completed reconciliation[\s\S]*tests\/dispatch\/search-flag-passthrough\.test\.js/,
    'dispatcher reconciliation spec must record search pass-through as completed with regression coverage'
  );
  assert.match(
    dispatcherSpec,
    /Optional strict validation mode \(future extension\)/,
    'dispatcher strict-mode work must be classified as future extension, not active immediate work'
  );
  assert.doesNotMatch(
    dispatcherSpec,
    /Problem statement \(current repo state\)|Required changes \(immediate reconciliation\)|Correctness tests to add immediately/,
    'dispatcher reconciliation spec must not retain stale current/immediate pre-fix wording'
  );

  const spillMergeSpec = await fsPromises.readFile(path.join(root, 'docs', 'specs', 'spill-merge-framework.md'), 'utf8');
  assert.match(
    spillMergeSpec,
    /Status: Active implemented shared spill\/merge contract\./,
    'spill/merge spec must record active implemented status'
  );
  assert.match(
    spillMergeSpec,
    /mergeRunsWithPlanner[\s\S]*createRowSpillCollector[\s\S]*createSpillSorter/,
    'spill/merge spec must name the live shared merge, row-spill, and map-sorter APIs'
  );
  assert.match(
    spillMergeSpec,
    /tests\/shared\/merge\/contract-matrix\.test\.js/,
    'spill/merge spec must cite current shared merge contract coverage'
  );
  assert.doesNotMatch(
    spillMergeSpec,
    /^- createSpillWriter\(config\)$/m,
    'spill/merge spec must not present old conceptual API names as live exports'
  );

  const architectureGuide = await fsPromises.readFile(path.join(root, 'docs', 'guides', 'architecture.md'), 'utf8');
  assert.match(
    architectureGuide,
    /docs\/specs\/json-stream-atomic-replace\.md[\s\S]*Historical context only: docs\/archived\/watch-atomicity\.md/,
    'architecture guide must pair active atomic replacement docs with archived watch-atomicity as historical context'
  );

  const usrUmbrella = await fsPromises.readFile(path.join(root, 'docs', 'specs', 'unified-syntax-representation.md'), 'utf8');
  assert.match(
    usrUmbrella,
    /Status: Active USR umbrella contract v1\.6; current branch technical rollout evidence is green\./,
    'USR umbrella must record active umbrella status with local technical evidence green'
  );
  assert.match(
    usrUmbrella,
    /## 21\. Integration Checkpoint[\s\S]*Remaining movement is not another local implementation task list/,
    'USR umbrella must classify former immediate tasks as checkpointed local technical coverage'
  );
  assert.doesNotMatch(
    usrUmbrella,
    /Status: Draft v1\.6|## 21\. Immediate Integration Tasks/,
    'USR umbrella must not retain stale draft/immediate-task status'
  );
}

{
  const roadmapPath = path.join(root, 'docs', 'roadmap.md');
  const roadmapText = await fsPromises.readFile(roadmapPath, 'utf8');
  assert.ok(
    roadmapText.includes(`Last audited: ${CURRENT_ROADMAP_AUDIT_DATE}`),
    'roadmap header must reflect the latest current evidence-citation audit date'
  );
  assert.ok(
    roadmapText.includes(`Current reconciliation, ${CURRENT_ROADMAP_AUDIT_DATE}:`),
    'roadmap USR reconciliation heading must reflect the latest current evidence-citation audit date'
  );
  const initiativesTable = readMarkdownTableAfterHeading(roadmapText, '## Current Initiatives');
  assert.deepEqual(
    initiativesTable.header,
    ['Initiative', 'Status', 'Done now', 'Remaining / next'],
    'roadmap current initiatives table must keep the canonical status shape'
  );
  const initiativeRows = initiativesTable.rows;
  const initiativeByName = new Map(initiativeRows.map((row) => [row.Initiative, row]));
  assert.deepEqual([...initiativeByName.keys()], [
    'Stage1 ordered throughput cutover',
    'Phase 10 interprocedural risk flows',
    'Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval',
    'Lexicon, relation boosts, chargram enrichment, and ANN candidate safety',
    'USR consolidated contract and rollout program',
    'Shared-module reduction',
    'Duplicate-code reduction',
    'Production readiness',
    'Phase 0.5 language/framework execution contract',
    'Worklogs and benchmark JSON under `docs/worklogs/**`'
  ], 'roadmap current initiatives table must preserve the consolidated initiative set and order');
  assert.deepEqual(
    initiativeRows
      .filter((row) => /`remaining`|`blocked\/unverifiable`/.test(row.Status))
      .map((row) => row.Initiative),
    [],
    'roadmap must not leave local top-level initiatives in remaining or blocked/unverifiable status'
  );
  assert.deepEqual(
    initiativeRows
      .filter((row) => row.Status === '`in progress`')
      .map((row) => row.Initiative),
    [],
    'roadmap must not leave approval-only top-level initiatives in progress'
  );
  assert.match(
    initiativeByName.get('USR consolidated contract and rollout program')?.['Remaining / next'] || '',
    /former approval-lock process is archived.*not a release blocker/,
    'USR top-level remaining status must archive approval paperwork instead of blocking on it'
  );
  assert.match(
    initiativeByName.get('Shared-module reduction')?.['Remaining / next'] || '',
    /No known shared-module implementation batch remains open/,
    'shared-module top-level row must not imply a hidden local implementation batch'
  );
  assert.match(
    initiativeByName.get('Duplicate-code reduction')?.['Remaining / next'] || '',
    /future intentional full audit refresh, not ad hoc rework of stale saved-report entries/,
    'duplicate-code top-level row must preserve the saved-report checkpoint policy'
  );
  assert.match(
    initiativeByName.get('Production readiness')?.['Remaining / next'] || '',
    /Keep production verification and release-readiness evidence green/,
    'production readiness row must tie release status to technical validation'
  );
  assert.ok(
    (initiativeByName.get('Production readiness')?.['Done now'] || '').includes(LATEST_EVIDENCE_CITATION_LOG),
    'production readiness top-level row must cite the final current evidence-citation validation log'
  );
  assert.match(
    roadmapText,
    new RegExp(`Keep release validation evidence current[\\s\\S]*${LATEST_EVIDENCE_CITATION_LOG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    'roadmap current release-evidence checklist must cite the final current evidence-citation validation log'
  );
  assert.match(
    initiativeByName.get('Stage1 ordered throughput cutover')?.['Done now'] || '',
    /Contiguous window planning.*commit cursor ordering.*no-gap-recovery assertions.*targeted Stage1 tests/,
    'Stage1 row must keep concrete implementation/test evidence anchors'
  );
  assert.match(
    initiativeByName.get('Stage1 ordered throughput cutover')?.['Remaining / next'] || '',
    /perf and memory budget tests in the release gate/,
    'Stage1 row must keep its release-gate perf/memory proof anchor'
  );
  assert.match(
    initiativeByName.get('Phase 10 interprocedural risk flows')?.['Done now'] || '',
    /risk summaries\/flows\/call-sites artifacts.*risk-interprocedural validator.*perf-quality proof/,
    'Phase 10 row must keep risk artifact implementation and release evidence anchors'
  );
  assert.match(
    initiativeByName.get('Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval')?.['Done now'] || '',
    /`src\/index\/index-ref\.js`.*`tools\/index-snapshot\.js`.*API routes.*api-search-asof-release-proof-fix/,
    'Phase 14 row must keep snapshot/diff/as-of implementation and proof anchors'
  );
  assert.match(
    initiativeByName.get('Lexicon, relation boosts, chargram enrichment, and ANN candidate safety')?.['Done now'] || '',
    /lexicon loader\/wordlists.*relation boost scoring.*chargram field\/stopword config.*ANN candidate policy.*tests are present/,
    'lexicon/retrieval row must keep implementation/test anchors'
  );
  assert.match(
    roadmapText,
    /those TUI build smoke files are explicit no-adopt\/local-wrapper owners.*not an open shared-module batch/,
    'roadmap must classify the abandoned TUI build-smoke wrapper migration as historical/no-adopt, not open work'
  );
  assert.match(
    roadmapText,
    /tooling\/install\/detect-and-plan-contract-matrix.*historical evidence for an intentionally abandoned wrapper migration, not as an open roadmap task/,
    'roadmap must classify the abandoned detect-and-plan wrapper migration as historical, not open work'
  );

  const validationSection = roadmapText.match(/## Validation Commands\r?\n([\s\S]*?)$/);
  assert.ok(validationSection, 'roadmap must define a Validation Commands section');
  const validationCommandBlock = validationSection[1].match(/```powershell\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(validationCommandBlock, 'roadmap validation section must include a PowerShell command block');
  assert.doesNotMatch(
    validationCommandBlock[1],
    /npm run audit:duplicates/,
    'generic roadmap validation must not rerun jscpd for ordinary doc/status changes'
  );
  assert.match(
    validationCommandBlock[1],
    /ci\/markdown-link-check/,
    'generic roadmap validation must include markdown link checking'
  );
  assert.match(
    validationCommandBlock[1],
    /tooling\/docs\/contract-matrix/,
    'generic roadmap validation must include the docs contract matrix guard'
  );
  assert.match(
    validationCommandBlock[1],
    /tooling\/docs\/usr-contract-checklists/,
    'generic roadmap validation must include the USR technical checklist guard'
  );
  assert.match(
    validationCommandBlock[1],
    /node tools\/docs\/generated-surfaces\.js --check-freshness/,
    'generic roadmap validation must check generated-surface freshness'
  );
  assert.match(
    validationCommandBlock[1],
    /git diff --check/,
    'generic roadmap validation must include whitespace validation'
  );
  const duplicateLane = roadmapText.match(/### Lane 2: Duplicate-Code Reduction\r?\n([\s\S]*?)(?:\r?\n### Lane 3:|$)/);
  assert.ok(duplicateLane, 'roadmap must keep a duplicate-code reduction lane');
  assert.match(
    duplicateLane[1],
    /future intentional full (?:duplicate )?audit refresh|future intentional full duplicate baseline refresh/,
    'duplicate lane must describe audit reruns as future intentional baseline refreshes'
  );
  assert.match(
    duplicateLane[1],
    /Do not rerun `jscpd` for this checkpoint/,
    'duplicate lane must preserve the no-repeat-jscpd checkpoint policy'
  );

  const duplicateStatusPath = path.join(root, 'docs', 'tooling', 'duplication-reduction-status.md');
  const duplicateStatusText = await fsPromises.readFile(duplicateStatusPath, 'utf8');
  assert.match(
    duplicateStatusText,
    /Older completed-slice notes below may preserve then-current instructions to rerun `npm run audit:duplicates`; those are historical records/,
    'duplication status must mark older rerun instructions as historical under the current checkpoint policy'
  );
  assert.match(
    duplicateStatusText,
    /Completed-slice `Acceptance tests` and `Future constraints` sections are retained as implementation evidence and safety guidance only; do not treat them as reopened work unless a future intentional audit or live regression supplies current proof\./,
    'duplication status must prevent completed-slice notes from being read as active reopened work'
  );
  assert.doesNotMatch(
    duplicateStatusText,
    /^\| P[23] \|/m,
    'duplication status must not present saved-baseline residual categories as open P2/P3 implementation work'
  );
  assert.doesNotMatch(
    duplicateStatusText,
    /^### P[23]:/m,
    'duplication status must not present saved-baseline residual sections as active P2/P3 work'
  );
  assert.doesNotMatch(
    duplicateStatusText,
    /^Current signal:/m,
    'duplication status must not describe historical saved-baseline details as current signals'
  );
  assert.doesNotMatch(
    duplicateStatusText,
    /^- Rerun `npm run audit:duplicates`/m,
    'duplication status must not keep active per-family rerun instructions outside future baseline policy'
  );
  assert.match(
    duplicateStatusText,
    /## Historical Saved-Baseline Candidate Details/,
    'duplication status must label stale detailed candidate sections as historical saved-baseline detail'
  );
  assert.doesNotMatch(
    duplicateStatusText,
    /Current production hits include/,
    'duplication status must not describe stale saved-report language residuals as current production hits'
  );
  assert.doesNotMatch(
    duplicateStatusText,
    /Remaining current hotspot counts/,
    'duplication status must not describe historical saved-baseline hotspot counts as current remaining work'
  );
  assert.doesNotMatch(
    duplicateStatusText,
    /remain separate follow-up work|remaining duplicate hits|Remaining duplicate hits|remaining hits in those files|Remaining `[^`]+` duplicate hits|Remaining [A-Za-z].*duplicate signal/,
    'duplication status must not describe saved-baseline duplicate residuals as active remaining work'
  );
  assert.match(
    duplicateStatusText,
    /saved-report exact-current refresh found 0 still-current fragments/,
    'duplication status must preserve the checkpoint-clean exact-current duplicate evidence'
  );
  assert.match(
    duplicateStatusText,
    /historical\/intermediate.*not current checkpoint proof/i,
    'duplication status must mark preserved timeout/failure logs as historical rather than current checkpoint proof'
  );
}

{
  const releasePlanPath = path.join(root, 'docs', 'roadmap-release-validation-plan.md');
  const text = await fsPromises.readFile(releasePlanPath, 'utf8');
  const runRules = loadRunRules({ root });
  const discoveredTests = await discoverTests({
    testsDir: path.join(root, 'tests'),
    excludedDirs: runRules.excludedDirs,
    excludedFiles: runRules.excludedFiles
  });
  const testsWithMetadata = discoveredTests.map((test) => {
    const lane = assignLane(test.id, runRules.laneRules);
    return {
      ...test,
      lane,
      tags: buildTags(test.id, lane, runRules.tagRules)
    };
  });

  const runnerCommands = text
    .split(/\r?\n/)
    .map(parseReleasePlanRunnerCommand)
    .filter(Boolean);
  assert.ok(runnerCommands.length > 0, 'release validation plan must include runnable tests/run.js commands');
  assert.match(
    text,
    /Runner-recorded timeouts are blocking timeout failures/,
    'release validation plan must align timeout classification with the current test runner'
  );
  assert.match(
    text,
    /node tests\/run\.js ci\/markdown-link-check tooling\/docs\/contract-matrix tooling\/docs\/usr-contract-checklists --lane=all --timeout-ms 30000/,
    'docs-and-governance lane must include the USR technical checklist guard'
  );
  assert.match(
    text,
    /node tools\/docs\/generated-surfaces\.js --check-freshness/,
    'docs-and-governance lane must check generated-surface freshness'
  );
  assert.match(
    text,
    /node tools\/docs\/repo-inventory\.js --root \. --json docs\/tooling\/repo-inventory\.json/,
    'docs-and-governance lane must include the repo-inventory refresh command cited by evidence'
  );
  assert.match(
    text,
    /git diff --check/,
    'docs-and-governance lane must include whitespace validation'
  );
  assert.doesNotMatch(
    text,
    /\.testLogs\/bench-sweet16\.json/,
    'optional advisory benchmark examples must not cite absent .testLogs artifacts as current evidence'
  );
  for (const command of runnerCommands) {
    assert.match(command.line, /--timeout-ms\s+30000|--timeout-ms=30000/, `release plan command must enforce 30s timeout: ${command.line}`);
    assert.ok(command.lanes.length > 0, `release plan command must specify an explicit lane: ${command.line}`);
    for (const lane of command.lanes.flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean))) {
      assert.ok(lane === 'all' || runRules.knownLanes.has(lane), `release plan command uses unknown lane ${lane}: ${command.line}`);
    }
    const { selected, skipped } = selectTestsForCommand({ command, tests: testsWithMetadata, runRules });
    assert.ok(
      selected.length + skipped.length > 0,
      `release plan command does not match any current runner tests: ${command.line}`
    );
    for (const selector of command.selectors) {
      const { selected: selectorSelected } = selectTestsForCommand({ command, selector, tests: testsWithMetadata, runRules });
      assert.ok(
        selectorSelected.length > 0,
        `release plan selector does not select any current non-skipped runner tests: ${selector} in ${command.line}`
      );
    }
  }

  const line = text.split(/\r?\n/)
    .find((candidate) => candidate.includes('Required release artifacts are named and schema-backed'));
  assert.ok(line, 'release validation plan must list required schema-backed USR artifacts');

  const knownReportIds = new Set(Object.keys(USR_REPORT_SCHEMA_DEFS));
  const artifactNames = [...line.matchAll(/`([^`]+\.json)`/g)]
    .map((match) => match[1].replace(/\.json$/, ''));
  assert.ok(artifactNames.length > 0, 'release validation plan schema-backed artifact list is empty');

  const unknownArtifacts = artifactNames.filter((artifactId) => !knownReportIds.has(artifactId));
  const missingArtifacts = [...knownReportIds].filter((artifactId) => !artifactNames.includes(artifactId));
  assert.deepEqual(
    unknownArtifacts,
    [],
    'release validation plan lists schema-backed USR artifacts that are not in src/contracts/schemas/usr.js'
  );
  assert.deepEqual(
    missingArtifacts,
    [],
    'release validation plan must list every schema-backed USR report artifact'
  );
}

{
  const evidencePath = path.join(root, 'docs', 'roadmap-release-validation-evidence-20260521.md');
  const evidenceText = await fsPromises.readFile(evidencePath, 'utf8');
  for (const requiredField of [
    'Branch:',
    'Commit:',
    'Worktree state:',
    'Date:',
    'Captured at:',
    'Node:',
    'npm:',
    'OS:',
    'Native optional deps:'
  ]) {
    assert.ok(evidenceText.includes(requiredField), `release evidence bundle missing ${requiredField}`);
  }
  assert.match(
    evidenceText,
    /Worktree state: .*(?:clean|uncommitted|dirty|branch-local)/,
    'release evidence bundle must classify clean versus uncommitted worktree state'
  );
  assert.match(
    evidenceText,
    /Captured at: `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z`/,
    'release evidence bundle must record an ISO UTC capture timestamp'
  );
  assert.match(
    evidenceText,
    /temp\/validation\/roadmap-final-current-status-validation-20260521\.log/,
    'release evidence bundle must cite the current roadmap/docs status validation log'
  );
  assert.match(
    evidenceText,
    /temp\/validation\/usr-framework-c4-policy-lane-guard-validation-20260521\.log/,
    'release evidence bundle must cite the framework C4 policy lane guard validation log'
  );
  assert.match(
    evidenceText,
    /temp\/validation\/usr-current-evidence-handoff-validation-20260522\.log/,
    'release evidence bundle must cite the current USR evidence handoff validation log'
  );
  assert.match(
    evidenceText,
    /temp\/validation\/roadmap-dup-ledger-brace-guard-final-20260522\.log/,
    'release evidence bundle must cite the duplicate ledger and brace-path guard validation log'
  );
  assert.ok(
    evidenceText.includes(CURRENT_READINESS_GATE_LOG),
    'release evidence bundle must cite the current readiness-gate validation log'
  );
  assert.ok(
    evidenceText.includes(LATEST_EVIDENCE_CITATION_LOG),
    'release evidence bundle must cite the final current evidence-citation validation log'
  );

  const releasePlanPathForTemplate = path.join(root, 'docs', 'roadmap-release-validation-plan.md');
  const releasePlanTemplateText = await fsPromises.readFile(releasePlanPathForTemplate, 'utf8');
  assert.ok(
    releasePlanTemplateText.includes(`Latest branch evidence as of ${CURRENT_ROADMAP_AUDIT_DATE}:`),
    'release validation plan current evidence snapshot must reflect the latest current evidence-citation audit date'
  );
  assert.ok(
    releasePlanTemplateText.includes(CURRENT_READINESS_GATE_LOG),
    'release validation plan must cite the current readiness-gate validation log'
  );
  assert.ok(
    releasePlanTemplateText.includes(LATEST_EVIDENCE_CITATION_LOG),
    'release validation plan must cite the final current evidence-citation validation log'
  );
  const reportingTemplate = releasePlanTemplateText.match(/## Reporting Template\r?\n[\s\S]*?```markdown\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(reportingTemplate, 'release validation plan must keep a markdown reporting template');
  for (const templateField of [
    'Branch:',
    'Commit:',
    'Worktree state:',
    'Date:',
    'Captured at:',
    'Node:',
    'npm:',
    'OS:',
    'Native optional deps:'
  ]) {
    assert.ok(
      reportingTemplate[1].includes(`- ${templateField}`),
      `release validation reporting template missing ${templateField}`
    );
  }

  const laneTable = readMarkdownTableAfterHeading(evidenceText, '## Lane Evidence');
  assert.deepEqual(laneTable.header, [
    'Lane',
    'Command',
    'Result',
    'Exit',
    'Elapsed',
    'Evidence',
    'Checked artifacts',
    'Blocker?',
    'Blocker owner/severity/action',
    'Waiver'
  ], 'release evidence bundle lane table must preserve the release-plan evidence shape plus owner/waiver detail');
  const laneRows = laneTable.rows;
  assert.equal(laneRows.length, 8, 'release evidence bundle must have exactly 8 lane rows');
  const seenLanes = new Set();
  for (const row of laneRows) {
    const lane = row.Lane;
    for (const column of laneTable.header) {
      assert.ok(row[column], `release evidence row has empty ${column} cell: ${lane}`);
    }
    assert.match(lane, /^`[^`]+`$/, `release evidence lane cell must use backtick lane id: ${lane}`);
    seenLanes.add(lane);
    assert.match(row.Command, /(?:node tests\/run\.js|npm run verify:production)/, `release evidence command must cite runner or production verify command: ${lane}`);
    assert.doesNotMatch(
      row.Command,
      /node tests\/(?!run\.js\b)/,
      `release evidence test commands must use tests/run.js rather than direct test entrypoints: ${lane}`
    );
    assert.match(row.Result, /pass/, `release evidence row must classify passing local proof: ${lane}`);
    assert.match(row.Exit, /^0$/, `release evidence row must record exit code 0 for local proof: ${lane}`);
    assert.match(row.Elapsed, /\b\d+(?:\.\d+)?(?:ms|s)\b/, `release evidence row must record elapsed time: ${lane}`);
    const elapsedDurations = [...row.Elapsed.matchAll(/\b([0-9.]+(?:ms|s))\b/g)]
      .map((match) => durationToMs(match[1]))
      .filter((value) => value !== null);
    if (elapsedDurations.some((durationMs) => durationMs > 30000)) {
      assert.match(
        row.Elapsed,
        /command (?:exits|total)|lane log|perf lane/i,
        `release evidence elapsed values over 30s must be labeled as command/lane totals, not per-test proof: ${lane}`
      );
    }
    assert.match(row.Evidence, /temp\/validation\/[^`]+\.log/, `release evidence row must cite validation log evidence: ${lane}`);
    const testLogRefs = [...row['Checked artifacts'].matchAll(/\.testLogs\/run-[A-Za-z0-9-]+/g)]
      .map((match) => match[0]);
    assert.ok(testLogRefs.length > 0, `release evidence row must cite .testLogs timing artifacts: ${lane}`);
    for (const rel of testLogRefs) {
      assert.ok(
        fs.existsSync(path.join(root, rel)),
        `release evidence row cites missing .testLogs timing artifact: ${lane} ${rel}`
      );
    }
    assert.match(row['Blocker?'], /^(?:yes|no)$/, `release evidence blocker cell must be yes or no: ${lane}`);
    assert.equal(row.Waiver, 'none', `release evidence row must not cite unrecorded waivers: ${lane}`);
    if (lane === '`docs-and-governance`') {
      assert.match(
        row.Command,
        /tooling\/docs\/usr-contract-checklists/,
        'docs-and-governance evidence row must include the USR technical checklist guard'
      );
      assert.match(
        row.Command,
        /node tools\/docs\/generated-surfaces\.js --check-freshness/,
        'docs-and-governance evidence row must include generated-surface freshness'
      );
      assert.match(
        row.Command,
        /node tools\/docs\/repo-inventory\.js --root \. --json docs\/tooling\/repo-inventory\.json/,
        'docs-and-governance evidence row must include repo-inventory refresh evidence'
      );
      assert.match(
        row.Command,
        /git diff --check/,
        'docs-and-governance evidence row must include whitespace validation'
      );
      assert.match(
        row.Evidence,
        /temp\/validation\/roadmap-validation-recipe-guard-final-20260521\.log/,
        'docs-and-governance evidence row must cite the final validation recipe guard'
      );
      assert.match(
        row.Evidence,
        /temp\/validation\/roadmap-dup-ledger-brace-guard-final-20260522\.log/,
        'docs-and-governance evidence row must cite the duplicate ledger and brace-path guard'
      );
      assert.ok(
        row.Evidence.includes(LATEST_EVIDENCE_CITATION_LOG),
        'docs-and-governance evidence row must cite the final current evidence-citation validation log'
      );
    }
    if (lane === '`production-readiness`') {
      assert.match(
        row.Command,
        /tooling\/release\/readiness-gate/,
        'production-readiness evidence row must include the release readiness-gate selector'
      );
      assert.ok(
        row.Evidence.includes(CURRENT_READINESS_GATE_LOG),
        'production-readiness evidence row must cite the current readiness-gate validation log'
      );
      assert.ok(
        row.Evidence.includes(LATEST_EVIDENCE_CITATION_LOG),
        'production-readiness evidence row must cite the final current evidence-citation validation log'
      );
      assert.match(
        row['Checked artifacts'],
        /\.testLogs\/run-1779415726577-0jr2cp/,
        'production-readiness evidence row must cite the current readiness-gate timing artifact'
      );
      assert.match(
        row['Checked artifacts'],
        /\.testLogs\/run-1779415736438-zs5bxc/,
        'production-readiness evidence row must cite the current docs guard timing artifact'
      );
    }
    assert.equal(row['Blocker?'], 'no', `release evidence lane must not be blocked by archived approval paperwork: ${lane}`);
    assert.equal(row['Blocker owner/severity/action'], 'none', `unblocked lane must not carry blocker action text: ${lane}`);

    const citedLogs = [...row.Evidence.matchAll(/temp\/validation\/[A-Za-z0-9._/-]+\.log/g)]
      .map((match) => match[0]);
    assert.ok(citedLogs.length > 0, `release evidence row must cite at least one validation log: ${lane}`);

    let hasPassingProof = false;
    for (const rel of citedLogs) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      const logText = fs.readFileSync(abs, 'utf8');
      if (/\b(?:FAIL|TIME(?:OUT)?)\s+\[|Summary\s*:\s*\d+ Passed \| [1-9]\d* Failed|Summary\s*:\s*\d+ Passed \| \d+ Failed \| [1-9]\d* Timeouts/.test(logText)) {
        assert.match(
          `${row.Evidence} ${row['Checked artifacts']}`,
          /final passing block|final pass/i,
          `evidence log with historical failures must identify final passing proof: ${lane}`
        );
      }
      if (/Summary\s*:\s*\d+ Passed \| 0 Failed \| 0 Timeouts \| 0 Skipped/.test(logText)
        || /\[exit-code\]\s*0/.test(logText)
        || /\bexit 0\b/.test(logText)
        || /\bexit=0\b/.test(logText)
        || /passed without command failures/.test(logText)
        || /deterministic release validation passed/.test(logText)) {
        hasPassingProof = true;
      }

      const timedTestDurations = extractTimedTestDurations(logText);
      const overBudgetDurations = timedTestDurations.filter((durationMs) => durationMs > 30000);
      assert.deepEqual(overBudgetDurations, [], `required release evidence has per-test durations over 30s: ${lane} ${rel}`);
    }
    assert.equal(hasPassingProof, true, `release evidence row must cite a log with explicit passing proof: ${lane}`);
  }
  assert.deepEqual([...seenLanes].sort(), [
    '`docs-and-governance`',
    '`lexicon-retrieval`',
    '`perf-quality-final`',
    '`production-readiness`',
    '`snapshot-diff-asof`',
    '`risk-artifacts`',
    '`stage1-contract`',
    '`usr-gates`'
  ].sort(), 'release evidence bundle must contain exactly the eight release lanes');
  const blockedLaneIds = laneRows
    .filter((row) => row['Blocker?'] === 'yes')
    .map((row) => row.Lane)
    .sort();
  assert.deepEqual(blockedLaneIds, [], 'release evidence bundle must leave no lanes blocked by archived approval paperwork');
  assert.doesNotMatch(
    evidenceText,
    /Approval state: pending|usrApproval\.pending|USR-GATE-C-APPROVAL/,
    'release evidence must not preserve active approval blocker wording'
  );
  assert.match(evidenceText, /No roadmap status is advanced/, 'release evidence bundle must document roadmap status handling');

  const tempValidationDir = path.join(root, 'temp', 'validation');
  if (fs.existsSync(tempValidationDir)) {
    const missingEvidenceLogs = [...evidenceText.matchAll(/temp\/validation\/[A-Za-z0-9._/-]+\.log/g)]
      .map((match) => match[0])
      .filter((rel) => !fs.existsSync(path.join(root, rel)));
    assert.deepEqual(missingEvidenceLogs, [], 'release evidence bundle must not cite missing local validation logs');
  }

  const skipsTable = readMarkdownTableAfterHeading(evidenceText, '## Skips And Timeouts');
  assert.deepEqual(skipsTable.header, ['Command', 'Classification', 'Reason', 'Follow-up']);
  assert.ok(skipsTable.rows.length > 0, 'release evidence bundle must include a skips/timeouts table');
  assert.ok(
    skipsTable.rows.some((row) => row.Classification === 'none'),
    'release evidence bundle must classify final cited skips/timeouts'
  );

  const blockersTable = readMarkdownTableAfterHeading(evidenceText, '## Blockers');
  assert.deepEqual(blockersTable.header, ['ID', 'Severity', 'Contract/spec', 'Owner', 'Required action']);
  assert.deepEqual(blockersTable.rows, [], 'release evidence bundle must leave no active approval blocker rows');

  const waiversTable = readMarkdownTableAfterHeading(evidenceText, '## Waivers');
  assert.deepEqual(waiversTable.header, ['Waiver', 'Scope', 'Expiry', 'Approver', 'Residual risk']);
  assert.ok(
    waiversTable.rows.some((row) => row.Waiver === 'none' && row.Expiry === 'none'),
    'release evidence bundle must explicitly record that no waiver is active'
  );
}

{
  const knownReportIds = new Set(Object.keys(USR_REPORT_SCHEMA_DEFS));
  const schemaDir = path.join(root, 'docs', 'schemas', 'usr');
  const docsSchemaIds = fs.readdirSync(schemaDir)
    .filter((name) => name.endsWith('.schema.json') && name !== 'evidence-envelope.schema.json')
    .map((name) => name.replace(/\.schema\.json$/, ''))
    .filter((artifactId) => knownReportIds.has(artifactId))
    .sort((left, right) => left.localeCompare(right));
  const registryIds = [...knownReportIds].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(docsSchemaIds, registryIds, 'docs/schemas/usr report schemas must match src/contracts/schemas/usr.js');
  for (const artifactId of docsSchemaIds) {
    const schemaPath = path.join(schemaDir, `${artifactId}.schema.json`);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.equal(schema.$id, `usr/${artifactId}.schema.json`, `${artifactId} schema must use canonical $id`);
    assert.equal(schema.properties?.artifactId?.const, artifactId, `${artifactId} schema artifactId const must match file name`);
    assert.ok((schema.required || []).includes('summary'), `${artifactId} schema must require summary`);
    assert.ok((schema.required || []).includes('rows'), `${artifactId} schema must require rows`);
  }

  for (const schemaId of ['usr-evidence-envelope', 'usr-capability-transition']) {
    assert.ok(USR_SCHEMA_DEFS[schemaId], `${schemaId} must exist in USR schema registry`);
    const schemaPath = path.join(schemaDir, `${schemaId}.schema.json`);
    assert.equal(fs.existsSync(schemaPath), true, `${schemaId} must have docs schema coverage`);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.equal(schema.$id, `usr/${schemaId}.schema.json`, `${schemaId} schema must use canonical $id`);
  }

  const catalogPath = path.join(root, 'docs', 'specs', 'usr-core-artifact-schema-catalog.md');
  const catalogText = await fsPromises.readFile(catalogPath, 'utf8');
  const catalogArtifactIds = new Set(
    [...catalogText.matchAll(/^\| `([^`]+)` \| `docs\/schemas\/usr\/[^`]+\.schema\.json` \|/gm)]
      .map((match) => match[1])
  );
  const missingCatalogRows = [...knownReportIds].filter((artifactId) => !catalogArtifactIds.has(artifactId));
  assert.deepEqual(missingCatalogRows, [], 'USR artifact schema catalog must list every report schema');
}

{
  const requiredOutputDocs = [
    'docs/specs/usr-core-evidence-gates-waivers.md',
    'docs/specs/usr-core-artifact-schema-catalog.md',
    'docs/specs/usr-core-governance-change.md'
  ];
  const knownReportIds = new Set(Object.keys(USR_REPORT_SCHEMA_DEFS));
  const missingSchemas = [];
  const missingSchemaFiles = [];
  for (const rel of requiredOutputDocs) {
    const text = await fsPromises.readFile(path.join(root, rel), 'utf8');
    const match = text.match(/## Required outputs\r?\n\r?\n([\s\S]*?)(?:\r?\n## |\r?\n### |$)/);
    assert.ok(match, `${rel} must define a Required outputs section`);
    const outputIds = [...match[1].matchAll(/`([^`]+\.json)`/g)]
      .map((outputMatch) => outputMatch[1].replace(/\.json$/, ''));
    assert.ok(outputIds.length > 0, `${rel} required outputs section must list JSON artifacts`);
    for (const outputId of outputIds) {
      if (!knownReportIds.has(outputId)) missingSchemas.push(`${rel}: ${outputId}`);
      const schemaPath = path.join(root, 'docs', 'schemas', 'usr', `${outputId}.schema.json`);
      if (!fs.existsSync(schemaPath)) missingSchemaFiles.push(`${rel}: ${outputId}`);
    }
  }
  assert.deepEqual(missingSchemas, [], 'USR required outputs must be schema-backed in src/contracts/schemas/usr.js');
  assert.deepEqual(missingSchemaFiles, [], 'USR required outputs must have docs/schemas/usr schema files');
}

console.log('tooling docs contract matrix test passed');
