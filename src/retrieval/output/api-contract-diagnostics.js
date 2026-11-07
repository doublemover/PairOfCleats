import { stableStringify } from '../../shared/stable-json.js';
import { sha1 } from '../../shared/hash.js';

export const API_HUMAN_DIAGNOSTIC_LIMIT = 100;
export const displayApiValue = value => {
  const text = typeof value === 'string' && value ? value.replace(/\r\n|\r|\n/gu, ' ↵ ') : 'unavailable';
  return text.length > 1024 ? text.slice(0, 1024) + '… [truncated]' : text;
};
export const formatApiCallLocation = call => {
  const file = displayApiValue(call?.file);
  const line = Number.isSafeInteger(call?.startLine) && call.startLine >= 1 ? call.startLine : null;
  const column = Number.isSafeInteger(call?.startCol) && call.startCol >= 0 ? call.startCol : null;
  return line === null ? `${file} (line unavailable${column === null ? '; column unavailable' : `; reported column ${column}`})`
    : column === null ? `${file}:${line} (column unavailable)` : `${file}:${line}:${column}`;
};
const key = (symbolId, callSiteId) => JSON.stringify([symbolId || null, callSiteId || null]);
const qualifiedKey = (symbolId, callSiteId, target, generation) => JSON.stringify([symbolId || null, callSiteId || null, target || null, generation || null]);

/** One linear projection over retained arrays. Human limits do not change report
 * evidence, warning caps, call arity or policy outcomes. Global/entry copies of
 * the same diagnostic share an identity; missing/ambiguous joins stay unknown.
 */
export const projectApiContractDiagnostics = report => {
  const seen = new Set(), retained = [], symbols = Array.isArray(report?.symbols) ? report.symbols : [];
  const add = warning => {
    if (!warning || typeof warning !== 'object') return;
    const identity = sha1(stableStringify(warning));
    if (seen.has(identity)) return;
    seen.add(identity);
    if (retained.length < API_HUMAN_DIAGNOSTIC_LIMIT) retained.push(warning);
  };
  for (const warning of report?.warnings || []) add(warning);
  for (const entry of symbols) for (const warning of entry.warnings || []) add(warning);
  const interested = new Set(retained.filter(warning => warning.data?.callSiteId)
    .map(warning => key(warning.data?.symbolId, warning.data.callSiteId)));
  const exact = new Map(), fallback = new Map();
  const remember = (map, id, call) => {
    if (!map.has(id)) map.set(id, call);
    else if (map.get(id) !== call) map.set(id, null);
  };
  for (const entry of symbols) for (const call of entry.observedCalls || []) {
    const id = key(entry.symbol?.symbolId, call.callSiteId);
    if (!interested.has(id)) continue;
    remember(fallback, id, call);
    remember(exact, qualifiedKey(entry.symbol?.symbolId, call.callSiteId, call.targetChunkUid, call.join?.indexSignature), call);
  }
  return { total: seen.size, omitted: seen.size - retained.length, details: retained.map(warning => {
    const data = warning.data || {};
    const precise = qualifiedKey(data.symbolId, data.callSiteId, data.targetChunkUid, data.indexSignature);
    const candidate = exact.has(precise) ? exact.get(precise) : fallback.get(key(data.symbolId, data.callSiteId));
    const call = candidate && (!data.targetChunkUid || candidate.targetChunkUid === data.targetChunkUid)
      && (!data.indexSignature || candidate.join?.indexSignature === data.indexSignature) ? candidate : null;
    return { code: displayApiValue(warning.code), message: displayApiValue(warning.message),
      symbolId: displayApiValue(data.symbolId), callSiteId: displayApiValue(data.callSiteId),
      location: formatApiCallLocation(call), target: displayApiValue(data.targetChunkUid || call?.targetChunkUid),
      qualification: displayApiValue(call?.join?.qualification),
      generation: displayApiValue(data.indexSignature || call?.join?.indexSignature || report?.provenance?.indexSignature) };
  }) };
};
