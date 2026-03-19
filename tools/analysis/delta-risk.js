#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { buildRiskDeltaPayload } from '../../src/context-pack/risk-delta.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';
import { emitCliError, emitCliOutput, resolveFormat } from '../../src/integrations/tooling/cli-helpers.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../src/shared/risk-filters.js';

const RISK_DELTA_OPTIONS = Object.freeze({
  repo: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  seed: { type: 'string' },
  includePartialFlows: { type: 'boolean', default: false },
  rule: { type: 'string' },
  category: { type: 'string' },
  severity: { type: 'string' },
  tag: { type: 'string' },
  source: { type: 'string' },
  sink: { type: 'string' },
  'flow-id': { type: 'string' },
  'source-rule': { type: 'string' },
  'sink-rule': { type: 'string' },
  format: { type: 'string' },
  json: { type: 'boolean', default: false }
});

const buildRiskDeltaFilters = (argv) => normalizeRiskFilters({
  rule: argv.rule,
  category: argv.category,
  severity: argv.severity,
  tag: argv.tag,
  source: argv.source,
  sink: argv.sink,
  flowId: argv['flow-id'],
  sourceRule: argv['source-rule'],
  sinkRule: argv['sink-rule']
});

const renderRiskDeltaMarkdown = (payload) => {
  const lines = [
    '# Risk Delta',
    '',
    `Seed: ${payload.seed?.type || 'unknown'} ${payload.seed?.chunkUid || payload.seed?.symbolId || payload.seed?.path || ''}`.trim(),
    `From: ${payload.from?.canonical || payload.from?.requestedRef || '<unknown>'}`,
    `To: ${payload.to?.canonical || payload.to?.requestedRef || '<unknown>'}`,
    '',
    '## Summary',
    `- flows: +${payload.summary?.flowCounts?.added || 0} / -${payload.summary?.flowCounts?.removed || 0} / ~${payload.summary?.flowCounts?.changed || 0}`,
    `- partial flows: +${payload.summary?.partialFlowCounts?.added || 0} / -${payload.summary?.partialFlowCounts?.removed || 0} / ~${payload.summary?.partialFlowCounts?.changed || 0}`
  ];
  if (payload.from?.seedStatus !== 'resolved' || payload.to?.seedStatus !== 'resolved') {
    lines.push('', '## Seed Resolution');
    lines.push(`- from: ${payload.from?.seedStatus || 'unknown'}`);
    lines.push(`- to: ${payload.to?.seedStatus || 'unknown'}`);
  }
  const renderEntryList = (title, entries, idField) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    lines.push('', `## ${title}`);
    for (const entry of entries) {
      lines.push(`- ${entry?.[idField] || '<unknown>'}`);
    }
  };
  renderEntryList('Added Flows', payload.deltas?.flows?.added, 'flowId');
  renderEntryList('Removed Flows', payload.deltas?.flows?.removed, 'flowId');
  if (Array.isArray(payload.deltas?.flows?.changed) && payload.deltas.flows.changed.length > 0) {
    lines.push('', '## Changed Flows');
    for (const entry of payload.deltas.flows.changed) {
      lines.push(`- ${entry?.flowId || '<unknown>'}: ${(entry?.changedFields || []).join(', ') || '<unknown>'}`);
    }
  }
  if (payload.includePartialFlows === true) {
    renderEntryList('Added Partial Flows', payload.deltas?.partialFlows?.added, 'partialFlowId');
    renderEntryList('Removed Partial Flows', payload.deltas?.partialFlows?.removed, 'partialFlowId');
    if (Array.isArray(payload.deltas?.partialFlows?.changed) && payload.deltas.partialFlows.changed.length > 0) {
      lines.push('', '## Changed Partial Flows');
      for (const entry of payload.deltas.partialFlows.changed) {
        lines.push(`- ${entry?.partialFlowId || '<unknown>'}: ${(entry?.changedFields || []).join(', ') || '<unknown>'}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
};

export async function runRiskDeltaCli(rawArgs = process.argv.slice(2)) {
  const argv = createCli({
    scriptName: 'risk delta',
    options: RISK_DELTA_OPTIONS,
    aliases: {
      'include-partial-flows': 'includePartialFlows'
    }
  }).parse(rawArgs);
  const format = resolveFormat(argv);
  const repoArg = typeof argv.repo === 'string' ? argv.repo.trim() : '';
  const fromArg = typeof argv.from === 'string' ? argv.from.trim() : '';
  const toArg = typeof argv.to === 'string' ? argv.to.trim() : '';
  const seedArg = typeof argv.seed === 'string' ? argv.seed.trim() : '';
  if (!repoArg || !fromArg || !toArg || !seedArg) {
    return emitCliError({
      format,
      code: ERROR_CODES.INVALID_REQUEST,
      message: 'Usage: pairofcleats risk delta --repo <dir> --from <ref> --to <ref> --seed <seedRef>'
    });
  }

  const filters = buildRiskDeltaFilters(argv);
  const validation = validateRiskFilters(filters);
  if (!validation.ok) {
    return emitCliError({
      format,
      code: ERROR_CODES.INVALID_REQUEST,
      message: `Invalid risk filters: ${validation.errors.join('; ')}`,
      details: {
        canonicalCode: ERROR_CODES.INVALID_REQUEST,
        reason: 'invalid_risk_filters'
      }
    });
  }

  try {
    const { repoRoot, userConfig } = resolveRepoConfig(repoArg);
    const payload = await buildRiskDeltaPayload({
      repoRoot,
      userConfig,
      from: fromArg,
      to: toArg,
      seed: seedArg,
      filters,
      includePartialFlows: argv.includePartialFlows === true
    });
    return emitCliOutput({
      format,
      payload,
      renderMarkdown: renderRiskDeltaMarkdown
    });
  } catch (err) {
    return emitCliError({
      format,
      code: err?.code || ERROR_CODES.INTERNAL,
      message: err?.message || 'Failed to build risk delta.',
      details: err?.reason ? { canonicalCode: err?.code || ERROR_CODES.INTERNAL, reason: err.reason } : undefined
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runRiskDeltaCli();
  if (result?.ok === false) process.exitCode = 1;
}
