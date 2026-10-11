import { projectOutput, VIEW_LIMITS } from './projection.js';
import { authorProjection, createCompileController } from './reladraw.js';
import { createRequestController, OPERATIONS } from './request.js';
import { mountDiagram } from './svg.js';
import { inspectValue, button, download } from './inspect.js';
const $ = id => document.getElementById(id);
const compiler = createCompileController(), requests = createRequestController();
let output = null, projection = null, story = null, compiled = null, diagram = null;
let diagramMode = true, validSource = '', zoom = 1;
const expanded = new Set();
let selected = null, page = 0, loadId = 0, history = [], historyAt = -1, activeRequest = null;
const notice = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
function selection(id, remember = true) {
  const node = projection?.nodes.find(item => item.id === id);
  if (!node) { notice('Selected identity is unavailable in this admitted page.'); return; }
  selected = id;
  if (remember && history[historyAt] !== id) { history = history.slice(0, historyAt + 1); history.push(id); if (history.length > 100) history.shift(); historyAt = history.length - 1; }
  $('back').disabled = historyAt < 1; $('forward').disabled = historyAt >= history.length - 1;
  $('selection').textContent = node.label; $('detail').replaceChildren(entityOverview(node));
  const heading = document.createElement('h2'); heading.textContent = 'Directed relationships in this page'; $('detail').append(heading);
  const related = projection.edges.filter(edge => edge.from === id || edge.to === id);
  if (node.detail?.ref?.partitionId && node.detail?.generation) {
    $('detail').prepend(button('Load semantic detail', async () => {
      const input = { repoRoot: activeRequest?.input?.repoRoot || '.', generation: node.detail.generation,
        refs: [node.detail.ref], include: ['operands', 'names', 'ownership'], limits: { records: 128, rows: 512, bytes: 65536, workMs: 250 } };
      try { const data = await requests.request('detail', input, { token: $('token').value, expectedGeneration: input.generation });
        accept(data, 'semantic detail'); activeRequest = { operation: 'detail', input }; $('next-response').disabled = !projection.cursor;
      } catch (error) { notice(error.message, true); }
    }));
  }
  for (const edge of related) {
    const other = projection.nodes.find(item => item.id === (edge.from === id ? edge.to : edge.from));
    $('detail').append(button(`${edge.from === id ? '→' : '←'} ${edge.kind} · ${other?.label ?? 'unloaded'}`, () => {
      $('selection').textContent = `${edge.kind} · source evidence`;
      $('detail').replaceChildren(inspectValue(edge.detail), button('Go to source', () => selection(edge.from)), button('Go to target', () => selection(edge.to)));
    }));
  }
  if (!related.length) $('detail').append(document.createTextNode('No admitted relationship. This does not establish absence from the index.'));
  if (projection.family === 'artifacts' && node.detail?.available && node.detail?.name) {
    $('detail').prepend(button('Inspect this artifact', async () => {
      try { const input = { repoRoot: activeRequest?.input?.repoRoot || '.', name: node.detail.name, generation: projection.generation };
        const data = await requests.request('artifact', input, { token: $('token').value, expectedGeneration: projection.generation });
        accept(data, node.detail.name); activeRequest = { operation: 'artifact', input }; $('next-response').disabled = !projection.cursor;
      } catch (error) { notice(error.message, true); }
    }));
  }
  diagram?.select(id); renderTree();
}
function entityOverview(node) {
  const host = document.createElement('div'), values = node.detail;
  const overview = document.createElement('dl'); overview.className = 'overview';
  const rows = [['Identity', node.id], ['Kind', node.kind], ['File', values.file ?? values.path ?? values.source?.path],
    ['Source range', values.range ? `${values.range.startLine ?? '?'}–${values.range.endLine ?? '?'} (1-based lines)`
      : values.span ? `${values.span[0]}–${values.span[1]} (UTF-16 offsets)` : null],
    ['Signature', values.signature], ['Certainty', values.certainty ?? values.evidenceClass ?? values.data?.status],
    ['Score', values.score], ['Original rank', values.originalRank], ['State', values.state ?? values.status],
    ['Available groups', values.availableFieldGroups?.join(', ')], ['Omitted groups', values.omittedFieldGroups?.join(', ')]];
  for (const [name, value] of rows) {
    if (value == null && !['File', 'Source range', 'Certainty'].includes(name)) continue;
    const term = document.createElement('dt'), definition = document.createElement('dd');
    term.textContent = name; definition.textContent = value == null ? 'Unknown / not supplied' : String(value);
    overview.append(term, definition);
  }
  host.append(overview);
  const all = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'All original fields'; all.append(summary);
  let loaded = false; all.addEventListener('toggle', () => { if (all.open && !loaded) { loaded = true; all.append(inspectValue(values)); } }); host.append(all);
  return host;
}
function renderTree() {
  const filter = $('filter').value.toLocaleLowerCase(); $('tree').replaceChildren();
  const nodes = projection?.nodes ?? [], byId = new Map(nodes.map(node => [node.id, node])), children = new Map();
  for (const node of nodes) {
    const parent = byId.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
    if (!children.has(parent)) children.set(parent, []); children.get(parent).push(node);
  }
  let ancestor = byId.get(selected)?.parentId; const ancestors = new Set();
  while (ancestor && !ancestors.has(ancestor)) { ancestors.add(ancestor); ancestor = byId.get(ancestor)?.parentId; }
  const visited = new Set();
  const add = (node, host) => {
    if (visited.has(node.id)) return; visited.add(node.id);
    const row = button(node.label, () => selection(node.id), node.id === selected ? 'selected' : '');
    const kind = document.createElement('small'); kind.textContent = node.kind; row.append(kind);
    const descendants = children.get(node.id);
    if (!filter && descendants?.length) {
      const group = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = `${node.label} · ${descendants.length} loaded children`;
      group.open = expanded.has(node.id) || ancestors.has(node.id); group.append(summary, row);
      group.addEventListener('toggle', () => { if (group.open) expanded.add(node.id); else expanded.delete(node.id); });
      descendants.forEach(child => add(child, group)); host.append(group);
    } else host.append(row);
  };
  if (filter) nodes.filter(node => `${node.label} ${node.kind} ${node.id}`.toLocaleLowerCase().includes(filter)).forEach(node => add(node, $('tree')));
  else { (children.get(null) || []).forEach(node => add(node, $('tree'))); nodes.filter(node => !visited.has(node.id)).forEach(node => add(node, $('tree'))); }
}
function renderEvidenceList() {
  const host = $('diagram'); host.replaceChildren();
  const title = document.createElement('h1'); title.textContent = `${projection.family} · admitted evidence`; host.append(title);
  for (const node of projection.nodes) {
    const card = button(node.label, () => selection(node.id), 'evidence-card');
    const detail = document.createElement('small');
    detail.textContent = projection.family === 'artifacts' ? `${node.detail.family || node.kind} · ${node.detail.available === false ? 'absent' : node.detail.mode || 'source record'}` : node.kind;
    card.append(detail); host.append(card);
  }
  if (!projection.nodes.length) host.append(document.createTextNode('No projected entities. Open the evidence surfaces for values, coverage and unavailable-state reasons.'));
}
async function compileSource() {
  const current = loadId;
  $('compile-status').textContent = 'Compiling bounded story…';
  try {
    const result = await compiler.compile($('source').value);
    if (current !== loadId) return;
    if (!diagramMode) return;
    validSource = $('source').value; compiled = result; diagram = mountDiagram($('diagram'), compiled, story.bindings, selection);
    if (selected) diagram.select(selected);
    $('compile-status').textContent = `${compiled.layout.nodes.length} shapes · Reladraw 0.16.0`;
    $('export-svg').disabled = false; $('export-story').disabled = false;
  } catch (error) {
    if (error.name !== 'AbortError') { $('compile-status').textContent = error.message; notice(error.message, true); }
  }
}
function rebuild() {
  loadId++; compiler.cancel(); compiled = null; diagram = null; $('export-svg').disabled = true; $('export-story').disabled = true;
  projection = projectOutput(output, { page, relation: $('relation').value });
  for (const id of expanded) if (!projection.nodes.some(node => node.id === id)) expanded.delete(id);
  story = authorProjection(projection); $('source').value = story.source;
  $('family').textContent = projection.family;
  $('generation').textContent = projection.generation ? `Pinned generation · ${typeof projection.generation === 'string' ? projection.generation : JSON.stringify(projection.generation)}` : 'Generation not supplied · identity cannot be verified';
  $('page').textContent = `${page + 1}`; $('previous').disabled = page === 0; $('next').disabled = !projection.hasNext;
  const c = projection.coverage;
  $('coverage').textContent = `Source total unknown · response ${c.responseEntities} entities / ${c.responseRelations} relations · admitted ${c.admittedEntities} / ${c.admittedRelations} · outside page ${c.omittedEntities} / ${c.omittedRelations} · source/query gaps retained in evidence`;
  $('sections').replaceChildren();
  projection.sections.forEach(section => $('sections').append(button(section.title, () => {
    $('selection').textContent = section.title; $('detail').replaceChildren(inspectValue(section.value));
  })));
  renderTree(); if (diagramMode) { $('diagram').replaceChildren(document.createTextNode('Compiling this admitted page…')); compileSource(); } else renderEvidenceList();
  if (selected && !projection.nodes.some(node => node.id === selected)) { $('selection').textContent = 'Selected identity is outside this page'; $('detail').replaceChildren(document.createTextNode(selected)); }
}
function accept(data, name) {
  // Validate projection before replacing any usable state.
  const next = projectOutput(data);
  diagramMode = ['map', 'graph', 'semantic', 'context', 'symbolic'].includes(next.family);
  expanded.clear(); output = data; projection = next; page = 0; selected = null; history = []; historyAt = -1;
  $('detail').replaceChildren(); $('selection').textContent = 'Select an entity or evidence surface';
  const kinds = [...new Set(next.edges.map(edge => edge.kind))].sort();
  $('relation').replaceChildren(new Option('All types', ''), ...kinds.map(kind => new Option(kind, kind)));
  $('export-evidence').disabled = false; $('back').disabled = true; $('forward').disabled = true;
  notice(`${name} · ${next.family === 'unknown' ? 'No recognized semantic schema. Evidence inspection only.' : 'Source values retained without reinterpretation.'}`);
  rebuild();
}
$('open-button').onclick = () => $('open').click();
$('open').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  requests.cancel(); activeRequest = null; $('next-response').disabled = true;
  const id = ++loadId;
  try { if (file.size > VIEW_LIMITS.bytes) throw new Error('File exceeds 2 MiB. Use a bounded query/export rather than a complete index.');
    const data = JSON.parse(await file.text()); if (id !== loadId) return; accept(data, file.name);
  } catch (error) { notice(error.message, true); } finally { event.target.value = ''; }
};
for (const name of Object.keys(OPERATIONS)) $('operation').append(new Option(name, name));
$('query-toggle').onclick = () => { $('query').hidden = !$('query').hidden; };
$('editor-toggle').onclick = () => { $('editor').hidden = !$('editor').hidden; if (output && !diagramMode) { diagramMode = true; compileSource(); } };
$('data-view').onclick = () => { if (projection) { diagramMode = !diagramMode; if (diagramMode) compileSource(); else { compiler.cancel(); renderEvidenceList(); } } };
async function runQuery(continuation = false) {
  try {
    const input = continuation ? structuredClone(activeRequest.input) : JSON.parse($('request').value);
    const operation = continuation ? activeRequest.operation : $('operation').value;
    const cursor = projection?.cursor;
    if (continuation) { if (!cursor) return; if (input.request) input.request.cursor = cursor; else input.cursor = cursor; }
    const expected = input.generation ?? input.request?.generation ?? null;
    notice('Loading a bounded response…');
    const data = await requests.request(operation, input, { token: $('token').value, expectedGeneration: expected });
    accept(data, `${operation} response`); activeRequest = { operation, input };
    $('next-response').disabled = !projection.cursor;
  } catch (error) { if (error.name !== 'AbortError') notice(error.message, true); }
}
$('run').onclick = () => runQuery(); $('next-response').onclick = () => runQuery(true);
$('cancel').onclick = () => { requests.cancel(); notice('Request cancelled. Previous admitted view retained.'); };
$('previous').onclick = () => { if (page > 0) { page--; rebuild(); } };
$('next').onclick = () => { if (projection?.hasNext) { page++; rebuild(); } };
$('relation').onchange = () => { if (output) rebuild(); };
$('filter').oninput = renderTree;
$('compile').onclick = () => { diagramMode = true; compileSource(); };
$('reset-source').onclick = () => { if (story) { $('source').value = story.source; compileSource(); } };
$('zoom-in').onclick = () => { zoom = Math.min(3, zoom * 1.25); diagram?.zoom(zoom); };
$('zoom-out').onclick = () => { zoom = Math.max(0.2, zoom / 1.25); diagram?.zoom(zoom); };
$('fit').onclick = () => { $('diagram').scrollTo({ top: 0, left: 0 }); if (diagram) { diagram.svg.style.width = '100%'; diagram.svg.style.height = '100%'; } };
$('close-detail').onclick = () => { $('detail').replaceChildren(); $('selection').textContent = 'Inspector closed · selection retained'; };
$('back').onclick = () => { if (historyAt > 0) selection(history[--historyAt], false); };
$('forward').onclick = () => { if (historyAt < history.length - 1) selection(history[++historyAt], false); };
$('export-svg').onclick = () => { if (diagram) download('pairofcleats-story.svg', new XMLSerializer().serializeToString(diagram.svg), 'image/svg+xml'); };
$('export-story').onclick = () => download('pairofcleats-story.json', JSON.stringify({ ...story, source: validSource, coverage: projection.coverage }, null, 2));
$('export-evidence').onclick = () => download('pairofcleats-output.json', JSON.stringify(output, null, 2));
window.addEventListener('pagehide', () => { compiler.cancel(); requests.cancel(); });
// Served reports can hand in one bounded initial model; API workspace starts empty.
const initial = document.getElementById('map-data');
if (initial) { try { accept(JSON.parse(initial.textContent), 'Code map report'); } catch (error) { notice(error.message, true); } }
