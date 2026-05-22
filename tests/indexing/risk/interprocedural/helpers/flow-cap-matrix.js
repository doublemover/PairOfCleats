import {
  computeRiskScenario,
  createRiskRuntime,
  createRiskSinkChunk,
  createRiskSourceChunk
} from './risk-flow-fixtures.js';

const CHUNKS = [createRiskSourceChunk(), createRiskSinkChunk()];

export const runFlowCapScenario = ({
  caps = null,
  nowStepMs = null
} = {}) => {
  const runtime = createRiskRuntime({ caps });
  return computeRiskScenario({
    chunks: CHUNKS,
    runtime,
    nowStepMs
  });
};
