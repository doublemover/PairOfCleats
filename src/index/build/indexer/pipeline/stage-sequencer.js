import { showProgress } from '../../../../shared/progress.js';

export const INDEX_STAGE_PLAN = Object.freeze([
  Object.freeze({ id: 'discover', label: 'discovery' }),
  Object.freeze({ id: 'imports', label: 'imports' }),
  Object.freeze({ id: 'processing', label: 'processing' }),
  Object.freeze({ id: 'relations', label: 'relations' }),
  Object.freeze({ id: 'postings', label: 'postings' }),
  Object.freeze({ id: 'write', label: 'write' })
]);

export const HEAVY_UTILIZATION_STAGES = new Set(['processing', 'relations', 'postings', 'write']);

/**
 * Create the visible stage advancer that keeps scheduler telemetry and the
 * user-facing progress bar in lockstep with the stage plan.
 *
 * @param {{
 *  mode:string,
 *  runtime:object,
 *  stagePlan?:Array<{id:string,label:string}>,
 *  setSchedulerTelemetryStage:Function,
 *  getSchedulerStats:Function
 * }} input
 * @returns {(stage:{id:string,label:string})=>void}
 */
export const createPipelineStageAdvancer = ({
  mode,
  runtime,
  stagePlan = INDEX_STAGE_PLAN,
  setSchedulerTelemetryStage,
  getSchedulerStats
}) => {
  const safeStagePlan = Array.isArray(stagePlan) ? stagePlan : INDEX_STAGE_PLAN;
  const stageTotal = safeStagePlan.length;
  let stageIndex = 0;
  return (stage) => {
    if (runtime?.overallProgress?.advance && stageIndex > 0) {
      const prevStage = safeStagePlan[stageIndex - 1];
      runtime.overallProgress.advance({ message: `${mode} ${prevStage.label}` });
    }
    stageIndex += 1;
    setSchedulerTelemetryStage(stage.id);
    showProgress('Stage', stageIndex, stageTotal, {
      taskId: `stage:${mode}`,
      stage: stage.id,
      mode,
      message: stage.label,
      scheduler: getSchedulerStats()
    });
  };
};
