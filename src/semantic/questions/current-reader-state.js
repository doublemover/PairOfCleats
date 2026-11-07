import { createSemanticCoverageQualification } from '../coverage-qualification.js';
export const QUESTION_BASE_STATE_BYTES = 65536;
export const createQuestionSeed = ref => ({ ref, phase: 'admit', operandOffset: 0, edgeOffset: 0, occurrenceOffset: 0,
  occurrence: null, occurrenceDone: false, sawOperand: false, source: null, targets: [], literals: [], outer: 0, inner: 0 });
export const createQuestionReaderState = () => ({ path: null, pathAfter: null, pathIndex: 0, pathDone: false, sourcesDone: false, after: null,
  seed: null, retainedBytes: QUESTION_BASE_STATE_BYTES, emitted: 0, unknown: false, unresolved: 0, done: false,
  lastCoverageSourceUnit: null, qualification: createSemanticCoverageQualification() });
