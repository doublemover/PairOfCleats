import { summarizeControlFlow } from '../../lang/flow.js';

export const JS_CONTROL_FLOW = {
  branchKeywords: ['if', 'else', 'switch', 'case', 'catch', 'try'],
  loopKeywords: ['for', 'while', 'do']
};

export const PY_CONTROL_FLOW = {
  branchKeywords: ['if', 'elif', 'else', 'try', 'except', 'finally', 'match', 'case'],
  loopKeywords: ['for', 'while']
};

export const buildControlFlowOnly = (text, chunk, options, keywords) => {
  if (!options.controlFlowEnabled || !chunk) return null;
  const slice = text.slice(chunk.start, chunk.end);
  return {
    dataflow: null,
    controlFlow: summarizeControlFlow(slice, keywords),
    throws: [],
    awaits: [],
    yields: false,
    returnsValue: false
  };
};
