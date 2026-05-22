import {
  handleContextPackRoute,
  handleRiskDeltaRoute,
  handleRiskExplainRoute
} from '../../../tools/api/router/analysis.js';
import {
  createContextPackValidator,
  createRiskDeltaValidator,
  createRiskExplainValidator
} from '../../../tools/api/validation.js';
import { createResponseCapture } from './response-capture.js';

const validateContextPackPayload = createContextPackValidator();
const validateRiskDeltaPayload = createRiskDeltaValidator();
const validateRiskExplainPayload = createRiskExplainValidator();

export const analysisErrorRoutes = {
  contextPack: {
    handler: handleContextPackRoute,
    routeArgs: {
      validateContextPackPayload,
      ensureWorkspaceAllowlist: async () => null
    }
  },
  riskDelta: {
    handler: handleRiskDeltaRoute,
    routeArgs: {
      validateRiskDeltaPayload
    }
  },
  riskExplain: {
    handler: handleRiskExplainRoute,
    routeArgs: {
      validateRiskExplainPayload
    }
  }
};

export const createAnalysisErrorResponseCapture = createResponseCapture;
