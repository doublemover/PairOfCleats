import { parseQueryInput } from '../../src/retrieval/query.js';
import { BENCH_QUERY_WORKLOAD_VERSION } from '../../src/contracts/benchmark-query-workload.js';

export const QUERY_GENERATION_SEMANTICS_VERSION = BENCH_QUERY_WORKLOAD_VERSION;
const invalid = message => Object.assign(new Error(message), { code: 'ERR_BENCH_QUERY_LITERAL' });
const structural = message => Object.assign(new Error(message), { code: 'ERR_BENCH_QUERY_STRUCTURE' });

export const queryLiteral = (input, { phrase = false } = {}) => {
  if (typeof input !== 'string') throw invalid('Generated query literals must be strings.');
  const value = input.replace(/\s+/g, ' ').trim();
  if (!value) throw invalid('Generated query literals cannot be blank.');
  if (value.includes('"') && value.includes("'")) throw invalid('The public query grammar cannot quote a literal containing both quote delimiters.');
  const needsPhrase = phrase || /[\s()"'!\\]/.test(value) || value.startsWith('-') || /^(and|or|not)$/i.test(value);
  return Object.freeze({ type: needsPhrase ? 'phrase' : 'term', value });
};
export const queryAnd = (left, right) => Object.freeze({ type: 'and', left, right });
export const queryOr = (left, right) => Object.freeze({ type: 'or', left, right });
export const queryNot = child => {
  if (!['term', 'phrase'].includes(child?.type)) throw structural('Generated negation requires a literal leaf under the public grammar.');
  return Object.freeze({ type: 'not', child });
};

const canonical = node => {
  if (node?.type === 'term' || node?.type === 'phrase') return { type: node.type, value: node.value };
  if (node?.type === 'not') return { type: 'not', child: canonical(node.child) };
  if (node?.type === 'and' || node?.type === 'or') return { type: node.type, left: canonical(node.left), right: canonical(node.right) };
  throw structural('Unsupported generated query expression.');
};
const serialize = node => {
  if (node.type === 'term') return node.value;
  if (node.type === 'phrase') {
    const quote = node.value.includes('"') ? "'" : '"';
    return `${quote}${node.value}${quote}`;
  }
  if (node.type === 'not') return `NOT ${serialize(node.child)}`;
  return `(${serialize(node.left)} ${node.type.toUpperCase()} ${serialize(node.right)})`;
};
export const serializeGeneratedQuery = expression => serialize(canonical(expression));
const shape = node => {
  const counts = { term: 0, phrase: 0, and: 0, or: 0, not: 0 };
  const visit = entry => { counts[entry.type]++; if (entry.child) visit(entry.child);
    if (entry.left) visit(entry.left); if (entry.right) visit(entry.right); };
  visit(node);
  return { class: counts.not && node.type !== 'not' ? `${node.type}-not` : node.type, counts };
};

/** Validate exact operators, leaf kind and literal contents through the actual
 * public parser. No heuristic fallback or invented backslash escaping. */
export const admitGeneratedQuery = expression => {
  const intended = canonical(expression), query = serialize(intended);
  let observed;
  try { observed = canonical(parseQueryInput(query).ast); }
  catch (cause) { throw Object.assign(structural('Generated query did not parse with its intended grammar.'), { cause }); }
  if (JSON.stringify(intended) !== JSON.stringify(observed)) throw structural('Generated query grammar changed its intended meaning.');
  const expectedShape = shape(intended), observedShape = shape(observed);
  return { query, queryShape: { schemaVersion: QUERY_GENERATION_SEMANTICS_VERSION,
    intendedClass: expectedShape.class, observedClass: observedShape.class, counts: observedShape.counts } };
};
