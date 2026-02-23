import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from '../flow.js';
import { SQL_CONTROL_FLOW, SQL_FLOW_SKIP } from './constants.js';
import { stripSqlComments } from './scanner.js';

const SQL_THROW_RE = /\b(?:raise|signal)\b\s+([A-Za-z_][A-Za-z0-9_]*)/gi;

/**
 * Heuristic control-flow/dataflow extraction for SQL chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeSqlFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  if (chunk.end <= chunk.start) return null;

  const cleaned = stripSqlComments(text.slice(chunk.start, chunk.end));
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
      skip: SQL_FLOW_SKIP,
      memberOperators: ['.', '::']
    });
    out.returnsValue = hasReturnValue(cleaned);

    const throws = new Set();
    SQL_THROW_RE.lastIndex = 0;
    let match = SQL_THROW_RE.exec(cleaned);
    while (match !== null) {
      if (match[1]) throws.add(match[1]);
      match = SQL_THROW_RE.exec(cleaned);
    }
    out.throws = Array.from(throws);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, SQL_CONTROL_FLOW);
  }

  return out;
}
