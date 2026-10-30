import { projectOutput, VIEW_LIMITS } from './projection.js';

export const FIND_PREVIEW_LIMIT = 50;
export const entityFindText = node => `${node.label} ${node.kind} ${node.id}`.toLocaleLowerCase();
const yieldBrowserTask = () => new Promise(resolve => setTimeout(resolve, 0));

/** Index labels and locators once per loaded response. Never retain materialized
 * entity details, reorder evidence, render extra pages or fetch continuation. */
export const createResponseFindController = ({ yieldTask = yieldBrowserTask } = {}) => {
  let epoch = 0, request = 0, identity = null, entities = [], pages = new Map(), disposed = false;
  const replace = (output, responseIdentity) => {
    if (disposed) throw new Error('Response find controller is closed.');
    const next = [], nextPages = new Map();
    let currentPage = -1;
    const pageIds = new Set();
    projectOutput(output, { metadataOnly: true, onEntity: node => {
      const page = Math.floor(node.ordinal / VIEW_LIMITS.nodes);
      if (page !== currentPage) { pageIds.clear(); currentPage = page; }
      // Match projection's same-page duplicate admission, keeping its ordinal
      // holes rather than changing later page boundaries or original ranking.
      if (pageIds.has(node.id)) return;
      pageIds.add(node.id);
      const entity = { ...node, page };
      if (!nextPages.has(page)) nextPages.set(page, { start: next.length, end: next.length });
      next.push({ entity, text: entityFindText(entity) });
      nextPages.get(page).end = next.length;
    } });
    epoch++; request++; identity = responseIdentity; entities = next; pages = nextPages;
    return entities.length;
  };
  const find = async (query, { scope = 'page', page = 0 } = {}) => {
    const startedEpoch = epoch, startedRequest = ++request, responseIdentity = identity;
    const needle = String(query).toLocaleLowerCase();
    if (disposed || !needle) return null;
    if (!['page', 'loaded'].includes(scope) || !Number.isSafeInteger(page) || page < 0) throw new TypeError('Invalid find scope.');
    const rows = entities;
    const range = scope === 'loaded' ? { start: 0, end: rows.length } : (pages.get(page) || { start: 0, end: 0 });
    const matches = new Uint32Array(range.end - range.start);
    let count = 0, visited = 0;
    const current = () => !disposed && startedEpoch === epoch && startedRequest === request;
    for (let index = range.start; index < range.end; index++) {
      if (!current()) return null;
      const row = rows[index]; visited++;
      if ((scope === 'loaded' || row.entity.page === page) && row.text.includes(needle)) matches[count++] = index;
      if (visited % 256 === 0) { await yieldTask(); if (!current()) return null; }
    }
    const at = position => current() && Number.isSafeInteger(position) && position >= 0 && position < count
      ? rows[matches[position]].entity : null;
    return { responseIdentity, scope, query, count, visited, isCurrent: current, at,
      preview: Array.from({ length: Math.min(count, FIND_PREVIEW_LIMIT) }, (_, index) => at(index)) };
  };
  return { replace, find, cancel() { request++; }, dispose() { disposed = true; epoch++; request++; entities = []; pages = new Map(); identity = null; } };
};
