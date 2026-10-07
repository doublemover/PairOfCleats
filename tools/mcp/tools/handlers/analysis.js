import { resolveIndexDir } from '../../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../../src/retrieval/cli/index-loader.js';
import { buildRiskDeltaPayload } from '../../../../src/context-pack/risk-delta.js';
import { projectRiskDeltaRequest, projectRiskExplainRequest } from '../../../analysis/risk-request.js';
import { createError, ERROR_CODES } from '../../../../src/shared/error-codes.js';
import { buildContextPackRequestInput } from '../../../../src/shared/context-pack-request.js';
import { attachObservability, buildChildObservability } from '../../../../src/shared/observability.js';
import { createProgressReporter } from '../../../../src/shared/progress-events.js';
import { buildCompositeContextPackPayload } from '../../../../src/integrations/tooling/context-pack.js';
import { buildRiskExplainPayload } from '../../../analysis/explain-risk.js';
import { resolveMcpRepoContext } from '../helpers.js';

const buildAnalysisObservability = (context, operation, analysisContext = {}) => buildChildObservability(
  context.observability,
  {
    surface: 'analysis',
    operation,
    context: analysisContext
  }
);

const throwIfRequestCancelled = (context = {}) => {
  if (context.signal?.aborted) {
    throw createError(ERROR_CODES.CANCELLED, 'Request cancelled.');
  }
};

const throwIfInvalidRiskFilters = (filterValidation) => {
  if (!filterValidation?.ok) {
    const errors = Array.isArray(filterValidation?.errors) ? filterValidation.errors : ['unknown validation error'];
    throw createError(ERROR_CODES.INVALID_REQUEST, `Invalid risk filters: ${errors.join('; ')}`, {
      reason: 'invalid_risk_filters'
    });
  }
};

const runObservedAnalysisOperation = async (context, {
  operation,
  analysisContext = {},
  startMessage,
  doneMessage,
  execute
}) => {
  const reporter = createProgressReporter(context);
  const observability = buildAnalysisObservability(context, operation, analysisContext);
  reporter?.start(startMessage, { observability });
  const result = await execute();
  reporter?.done(doneMessage, { observability });
  return attachObservability(result, observability);
};

export async function runRiskExplain(args = {}, context = {}) {
  throwIfRequestCancelled(context);
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoPath, {
    includeRuntimeEnv: false
  });
  const riskRequest = projectRiskExplainRequest(args);
  const chunkUid = riskRequest.chunkUid;
  if (!chunkUid) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'chunk is required.');
  }
  const indexDir = resolveIndexDir(repoPath, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw createError(ERROR_CODES.NO_INDEX, `Code index not found at ${indexDir}.`);
  }
  throwIfInvalidRiskFilters(riskRequest.filterValidation);
  try {
    return await runObservedAnalysisOperation(context, {
      operation: 'risk_explain',
      analysisContext: {
        repoRoot: repoPath,
        chunkUid
      },
      startMessage: 'Building risk explanation.',
      doneMessage: 'Risk explanation ready.',
      execute: () => buildRiskExplainPayload({
        indexDir,
        chunkUid,
        max: riskRequest.max,
        filters: riskRequest.filters,
        includePartialFlows: riskRequest.includePartialFlows,
        maxPartialFlows: riskRequest.maxPartialFlows
      })
    });
  } catch (err) {
    const message = err?.message || 'Failed to build risk explanation.';
    const isUnknownChunk = (
      err?.code === ERROR_CODES.INVALID_REQUEST && err?.reason === 'unknown_chunk_uid'
    ) || /Unknown chunkUid/i.test(message);
    if (isUnknownChunk) {
      throw createError(ERROR_CODES.INVALID_REQUEST, message, {
        reason: 'unknown_chunk_uid'
      });
    }
    throw err;
  }
}

export async function runContextPack(args = {}, context = {}) {
  throwIfRequestCancelled(context);
  const { repoPath } = resolveMcpRepoContext(args.repoPath, {
    includeRuntimeEnv: false,
    includeUserConfig: false
  });
  try {
    return await runObservedAnalysisOperation(context, {
      operation: 'context_pack',
      analysisContext: {
        repoRoot: repoPath
      },
      startMessage: 'Building context pack.',
      doneMessage: 'Context pack ready.',
      execute: () => buildCompositeContextPackPayload(
        buildContextPackRequestInput(args, {
          repoRoot: repoPath,
          riskFilters: args.filters || null
        }),
        context
      )
    });
  } catch (err) {
    if (
      err?.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST'
      || err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID'
      || err?.code === 'ERR_CONTEXT_PACK_STRICT_EVIDENCE'
    ) {
      throw createError(ERROR_CODES.INVALID_REQUEST, err.message, {
        ...(err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID'
          ? { reason: 'invalid_risk_filters' }
          : err?.code === 'ERR_CONTEXT_PACK_STRICT_EVIDENCE'
            ? { reason: 'strict_evidence_incomplete', evidence: err?.evidence || null }
            : {})
      });
    }
    if (err?.code === 'ERR_CONTEXT_PACK_NO_INDEX') {
      throw createError(ERROR_CODES.NO_INDEX, err.message);
    }
    throw err;
  }
}

export async function runRiskDelta(args = {}, context = {}) {
  throwIfRequestCancelled(context);
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoPath, {
    includeRuntimeEnv: false
  });
  const riskRequest = projectRiskDeltaRequest(args);
  const fromRef = riskRequest.fromRef;
  const toRef = riskRequest.toRef;
  const seed = riskRequest.seed;
  if (!fromRef || !toRef || !seed) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'seed, from, and to are required.');
  }
  throwIfInvalidRiskFilters(riskRequest.filterValidation);
  try {
    return await runObservedAnalysisOperation(context, {
      operation: 'risk_delta',
      analysisContext: {
        repoRoot: repoPath,
        from: fromRef,
        to: toRef
      },
      startMessage: 'Building risk delta.',
      doneMessage: 'Risk delta ready.',
      execute: () => buildRiskDeltaPayload({
        repoRoot: repoPath,
        userConfig,
        from: fromRef,
        to: toRef,
        seed,
        filters: riskRequest.filters,
        includePartialFlows: riskRequest.includePartialFlows
      })
    });
  } catch (err) {
    if (err?.code === ERROR_CODES.INVALID_REQUEST) {
      throw createError(ERROR_CODES.INVALID_REQUEST, err.message, {
        ...(err?.reason ? { reason: err.reason } : {})
      });
    }
    throw err;
  }
}
