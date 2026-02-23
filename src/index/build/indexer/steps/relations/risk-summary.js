import { log } from '../../../../../shared/progress.js';
import { buildRiskSummaries } from '../../../../risk-interprocedural/summaries.js';

/**
 * Determine whether risk summary rows should be generated for this pass.
 *
 * @param {{mode:string,riskInterproceduralEnabled:boolean,riskInterproceduralEmitArtifacts:string|null}} input
 * @returns {boolean}
 */
export const shouldBuildRiskSummaries = ({
  mode,
  riskInterproceduralEnabled,
  riskInterproceduralEmitArtifacts
}) => (
  mode === 'code'
  && (riskInterproceduralEnabled || riskInterproceduralEmitArtifacts === 'jsonl')
);

/**
 * Build risk summaries and attach them to the shared stage state.
 *
 * @param {{runtime:object,mode:string,state:object,crashLogger:object}} input
 * @returns {{rows:Array<object>,stats:object|null,durationMs:number}}
 */
export const buildAndStoreRiskSummaries = ({ runtime, mode, state, crashLogger }) => {
  crashLogger.updatePhase('risk-summaries');
  const summaryStart = Date.now();
  const { rows, stats } = buildRiskSummaries({
    chunks: state.chunks,
    runtime,
    mode,
    log
  });
  const durationMs = Date.now() - summaryStart;
  state.riskSummaryTimingMs = durationMs;
  state.riskSummaries = rows;
  state.riskSummaryStats = stats;
  if (stats?.emitted && Number.isFinite(stats.emitted)) {
    log(`Risk summaries: ${stats.emitted.toLocaleString()} rows`);
  }
  return { rows, stats, durationMs };
};
