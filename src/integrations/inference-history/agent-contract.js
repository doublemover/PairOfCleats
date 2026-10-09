// Versioned transport contract; does not grant archive or filesystem authority.
import { parseHistoryQuery } from './query.js';
import { HISTORY_AGENT_REQUESTS } from '../../contracts/schemas/inference-history-agent.js';
export const HISTORY_AGENT_VERSION = 'history-agent.v1';
export { HISTORY_AGENT_REQUESTS } from '../../contracts/schemas/inference-history-agent.js';

export function historyAgentHelp({ full = false } = {}) {
  return {
    version: HISTORY_AGENT_VERSION,
    capabilities: { lexical: true, boundedRelaxation: true, context: true, dense: 'trusted_host_optional', rerank: 'trusted_host_optional_unavailable_in_persistent_adapter', metadataHybrid: true, originalSourceDiversity: true },
    interface: 'Trusted host: reader.execute(command, request, options). CLI discovery: pairofcleats history help --json',
    commands: Object.keys(HISTORY_AGENT_REQUESTS),
    semantics: {
      search: 'Default auto first tries literal Unicode-word AND, then one bounded OR pass only after complete strict absence. Quoted phrases and -word exclusions remain required; OR is a literal word, not an operator. Explicit strict/relaxed controls remain available.',
      filters: 'All supplied filters are ANDed. role omitted searches all admissible roles, including artifact units when present.',
      dates: 'Inclusive UTC bounds. YYYY-MM-DD spans the whole day; unknown dates do not satisfy a date filter.',
      history: 'includeHistory=false selects the latest imported revision per record; pathState=all includes alternative branches.',
      timeline: 'Exact conversation branch, oldest/newest visible messages, optional role and inclusive UTC bounds. Correction-language signals are not verified changes of preference; assistant advice is not user acceptance.',
      provenance: 'Occurrences are locations, not a count of independent conversations. Artifacts are references with unknown availability.',
      coverage: 'Empty results do not establish absence from full history. Coverage and candidate completeness are separate.',
      continuation: 'Execute page.next exactly; it preserves query, filters, scope and budgets, using the returned offset or generation-bound ranked cursor. Exact totals remain null when the full candidate enumeration is unavailable.',
      citations: 'Short citation labels are display handles. Reuse the full IDs in actions; labels never grant access.'
    },
    defaults: Object.fromEntries(Object.entries(HISTORY_AGENT_REQUESTS).map(([command, schema]) => [
      command, Object.fromEntries(Object.entries(schema.properties)
        .filter(([, field]) => Object.hasOwn(field, 'default')).map(([name, field]) => [name, field.default]))
    ])),
    examples: [
      { intent: 'Find an unfamiliar topic; start with its distinctive name', command: 'search', request: { query: 'BlackShark' } },
      { intent: 'Find requirements stated by the user', command: 'search', request: { query: 'MIDI', role: 'user', top: 2 } },
      { intent: 'Restrict user evidence to inclusive UTC dates', command: 'search', request: {
        query: 'headphones', role: 'user', dateFrom: '2026-09-01', dateTo: '2026-10-07'
      } },
      { intent: 'Recover conversation around a hit', instruction: 'Copy evidence[0].actions.context exactly.' },
      { intent: 'Get the next page without changing the search', instruction: 'Copy page.next exactly; do not rebuild filters.' },
      { intent: 'Inspect all exact occurrence locations', instruction: 'Copy evidence[0].actions.references.' }
    ],
    output: {
      detail: ['summary', 'full'], defaultDetail: 'summary', defaultMaxOutputBytes: 65536,
      maxOutputBytes: [4096, 2097152],
      textTruncation: 'Evidence retains snippet/projection truncation metadata. Full detail preserves the service result.',
      byteBudget: 'Oversized responses return OUTPUT_BUDGET with no partial evidence; reduce top/text length or explicitly increase the budget.'
    },
    safety: 'Read-only facade. Trusted host supplies authentication and partition; no CLI vault path, imports, deletion or policy defaults.',
    ...(full ? { requests: structuredClone(HISTORY_AGENT_REQUESTS) } : {
      required: Object.fromEntries(Object.entries(HISTORY_AGENT_REQUESTS).map(([name, schema]) => [name, schema.required])),
      more: 'historyAgentHelp({full:true}) or pairofcleats history help --all --json for every field and bound.'
    })
  };
}

export function validateHistoryAgentRequest(command, request) {
  const schema = HISTORY_AGENT_REQUESTS[command];
  const fail = (field, hint) => { const error = new Error('Invalid archive-reader request.');
    Object.assign(error, { code: 'INVALID_REQUEST', field, hint }); throw error; };
  if (!schema) fail('command', 'Use help to choose search, context, timeline, references, original or member.');
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('request', 'Supply a JSON object.');
  for (const name of Object.keys(request)) if (!Object.hasOwn(schema.properties, name)) fail(name, 'Unknown field. Inspect help --all; code-search flags are not archive fields.');
  const result = { ...request };
  for (const [name, field] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(result, name) && Object.hasOwn(field, 'default')) result[name] = field.default;
    const value = result[name];
    if (value === undefined) { if (schema.required.includes(name)) fail(name, 'Supply the required field using returned exact IDs.'); continue; }
    if (field.enum && !field.enum.includes(value)) fail(name, 'Choose a documented enum value.');
    if (field.type === 'integer' && (!Number.isSafeInteger(value) || value < field.minimum || value > field.maximum)) fail(name, 'Use an integer within the documented bounds.');
    if (field.type === 'boolean' && typeof value !== 'boolean') fail(name, 'Use a JSON boolean.');
    if (field.type === 'string' && (typeof value !== 'string' || value.length < (field.minLength ?? 0)
      || value.length > (field.maxLength ?? Infinity) || (field.pattern && !new RegExp(field.pattern).test(value)))) fail(name, 'Use the documented string or full 64-character reference.');
    if ((name === 'dateFrom' || name === 'dateTo') && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10))) fail(name, 'Use a real YYYY-MM-DD or UTC ISO timestamp ending in Z.');
  }
  if (command === 'search') {
    try { parseHistoryQuery(result.query); } catch {
      fail('query', 'Use 1 to 32 words, balanced quoted phrases, and optional -word exclusions. Start with a distinctive term.');
    }
    const bound = (value, end) => value?.length === 10 ? value + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z') : value;
    if (result.dateFrom && result.dateTo && bound(result.dateFrom, false) > bound(result.dateTo, true)) fail('dateTo', 'The inclusive end must be on or after the start.');
  }
  return result;
}
