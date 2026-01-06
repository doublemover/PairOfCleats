import { findCLikeBodyBounds } from '../clike.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from '../flow.js';
import { TS_USAGE_SKIP } from './constants.js';
import { stripTypeScriptComments } from './parser.js';

/**
 * Heuristic control-flow/dataflow extraction for TypeScript chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeTypeScriptFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripTypeScriptComments(slice);
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  const out = {
    dataflow: null,
    controlFlow: null,
    throws: [],
    awaits: [],
    yields: false,
    returnsValue: false
  };

  if (dataflowEnabled) {
    out.dataflow = buildHeuristicDataflow(cleaned, {
      skip: TS_USAGE_SKIP,
      memberOperators: ['.']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    for (const match of cleaned.matchAll(/\bthrow\b\s+(?:new\s+)?([A-Za-z_$][A-Za-z0-9_$.]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) throws.add(name);
    }
    out.throws = Array.from(throws);
    const awaits = new Set();
    for (const match of cleaned.matchAll(/\bawait\b\s+([A-Za-z_$][A-Za-z0-9_$.]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) awaits.add(name);
    }
    out.awaits = Array.from(awaits);
    out.yields = /\byield\b/.test(cleaned);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'switch', 'case', 'catch', 'try'],
      loopKeywords: ['for', 'while', 'do']
    });
  }

  return out;
}
