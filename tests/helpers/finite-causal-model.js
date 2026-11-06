import { createRepositoryAnswerInput } from './repository-answer-input.js';

export const causalValue = value => ({ type: typeof value === 'number' ? 'integer' : typeof value, value });
export const causalBinding = (variableId, value) => ({ variableId, value: causalValue(value) });
export const causalVariable = (id, kind, values = [false, true]) => ({ id, kind, domain: values.map(causalValue),
  operationalDefinitionId: '1'.repeat(64), sourceBindings: [] });
export const causalEquation = (output, orderedParents, rows) => ({ output, orderedParents,
  rows: rows.map(([parentValues, value]) => ({ parentValues: parentValues.map(causalValue), value: causalValue(value) })) });
export const finiteCausalInput = () => ({ schemaVersion: 1, questionId: '2'.repeat(64),
  worldRef: { source: createRepositoryAnswerInput().queryReceipt.world, buildId: '3'.repeat(64), runtimeId: '4'.repeat(64),
    traceRunId: null, traceSchemaId: null, phaseId: 'finite-fixture', unitDefinitionId: '5'.repeat(64),
    coverageId: '6'.repeat(64), coverage: 'complete', observationContractId: '7'.repeat(64) },
  variables: [causalVariable('U', 'exogenous'), causalVariable('X', 'endogenous'), causalVariable('Y', 'endogenous')],
  equations: [causalEquation('X', ['U'], [[[false], false], [[true], true]]),
    causalEquation('Y', ['X'], [[[false], false], [[true], true]])],
  exogenousSupport: { state: 'complete', weighting: 'none', assignments: [false, true].map(value => ({ values: [causalBinding('U', value)], weight: null })) },
  admissibleInterventionVariables: ['X', 'Y'], assumptions: [{ id: 'stable-mechanisms', description: 'Fixture equations remain fixed under the admitted interventions.',
    status: 'declared', supportReceiptIds: [] }], evidencePartition: { sourceEvidenceIds: [], observationEvidenceIds: [], modelEvidenceIds: [] } });
