import { projectOutput, createPageIdentityLookup, VIEW_LIMITS } from './projection.js';
import { authorProjection, createCompileController } from './reladraw.js';
import { createRequestController, semanticDetailInput, captureWorkspaceFailure, OPERATIONS } from './request.js';
import { mountDiagram } from './svg.js';
import { inspectValue, button, download } from './inspect.js';
import { createResponseFindController, entityFindText, FIND_PREVIEW_LIMIT } from './find.js';
const $ = id => document.getElementById(id);
const compiler = createCompileController(), requests = createRequestController();
const finder = createResponseFindController();
let output = null, projection = null, pageLookup = null, story = null, compiled = null, diagram = null;
let diagramMode = true, validSource = '', zoom = 1;
const expanded = new Set();
let selected = null, page = 0, loadId = 0, compileEpoch = 0, history = [], historyAt = -1, activeRequest = null;
let responseIdentity = 0, found = null, findAt = -1;
let actionEpoch = 0;
let selectionPublication = null;
const notice = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
const superseded = () => Object.freeze({ ok: false, reason: 'superseded' });
const reportActionFailure = (primary, current) => {
  if (!current()) return Object.freeze({ ok: false, reason: 'superseded', primaryError: primary });
  const captured = captureWorkspaceFailure(primary);
  if (current() && captured.name !== 'AbortError') notice(captured.message, true);
  return Object.freeze({ ok: false, primaryError: primary, inspectionErrors: captured.inspectionErrors });
};
function selection(id, remember = true) {
  const node = pageLookup?.get(id);
  if (!node) { notice('Selected identity is unavailable in this admitted page.'); return; }
  const originalPublication = {}; selectionPublication = originalPublication;
  selected = id;
  if (remember && (history[historyAt]?.id !== id || history[historyAt]?.page !== page)) { history = history.slice(0, historyAt + 1); history.push({ id, page }); if (history.length > 100) history.shift(); historyAt = history.length - 1; }
  $('back').disabled = historyAt < 1; $('forward').disabled = historyAt >= history.length - 1;
  $('selection').textContent = node.label; $('detail').replaceChildren(entityOverview(node));
  const heading = document.createElement('h2'); heading.textContent = 'Directed relationships in this page'; $('detail').append(heading);
  const related = projection.edges.filter(edge => edge.from === id || edge.to === id);
  const detailInput = semanticDetailInput(node, projection, activeRequest?.input?.repoRoot || '.');
  const originalPage = projection;
  const originalSelection = () => selectionPublication === originalPublication && projection === originalPage && pageLookup?.get(id) === node;
  if (detailInput) {
    $('detail').prepend(button('Load semantic detail', async () => {
      if (!originalSelection()) return superseded();
      const epoch = ++actionEpoch, current = () => epoch === actionEpoch && originalSelection();
      const input = detailInput;
      try { const data = await requests.request('detail', input, { token: $('token').value, expectedGeneration: input.generation });
        if (!current()) return superseded();
        accept(data, 'semantic detail'); if (epoch !== actionEpoch) return superseded();
        activeRequest = { operation: 'detail', input }; $('next-response').disabled = !projection.cursor;
      } catch (error) { return reportActionFailure(error, current); }
    }));
  }
  for (const edge of related) {
    const other = pageLookup.get(edge.from === id ? edge.to : edge.from);
    $('detail').append(button(`${edge.from === id ? '→' : '←'} ${edge.kind} · ${other?.label ?? 'unloaded'}`, () => {
      if (!originalSelection()) return superseded();
      $('selection').textContent = `${edge.kind} · source evidence`;
      $('detail').replaceChildren(inspectValue(edge.detail), button('Go to source', () => { if (originalSelection()) selection(edge.from); }), button('Go to target', () => { if (originalSelection()) selection(edge.to); }));
    }));
  }
  if (!related.length) $('detail').append(document.createTextNode('No admitted relationship. This does not establish absence from the index.'));
  if (projection.family === 'artifacts' && node.detail?.available && node.detail?.name) {
    $('detail').prepend(button('Inspect this artifact', async () => {
      if (!originalSelection()) return superseded();
      const epoch = ++actionEpoch, current = () => epoch === actionEpoch && originalSelection();
      try { const input = { repoRoot: activeRequest?.input?.repoRoot || '.', name: node.detail.name, generation: originalPage.generation };
        const data = await requests.request('artifact', input, { token: $('token').value, expectedGeneration: originalPage.generation });
        if (!current()) return superseded();
        accept(data, node.detail.name); if (epoch !== actionEpoch) return superseded();
        activeRequest = { operation: 'artifact', input }; $('next-response').disabled = !projection.cursor;
      } catch (error) { return reportActionFailure(error, current); }
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
  const nodes = projection?.nodes ?? [], byId = pageLookup, children = new Map();
  for (const node of nodes) {
    const parent = byId.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
    if (!children.has(parent)) children.set(parent, []); children.get(parent).push(node);
  }
  let ancestor = byId?.get(selected)?.parentId; const ancestors = new Set();
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
  if (filter) nodes.filter(node => entityFindText(node).includes(filter)).forEach(node => add(node, $('tree')));
  else { (children.get(null) || []).forEach(node => add(node, $('tree'))); nodes.filter(node => !visited.has(node.id)).forEach(node => add(node, $('tree'))); }
}
function findStatus() {
  const scope = $('find-scope').value === 'loaded' ? 'loaded response' : 'this admitted page';
  const count = found?.isCurrent() ? found.count : 0;
  const position = findAt >= 0 && count ? `Match ${findAt + 1} of ${count}. ` : '';
  $('find-status').textContent = `${position}${count} matches in ${scope} only. Index matches are unknown.${count > FIND_PREVIEW_LIMIT ? ` First ${FIND_PREVIEW_LIMIT} previews shown; next/previous navigate all matches.` : ''}${projection?.cursor ? ' Unloaded server pages are not searched; Next response page is a separate action.' : ''}`;
  $('find-next').disabled = !count; $('find-previous').disabled = !count;
}
function goToMatch(position) {
  if (!found?.isCurrent() || found.responseIdentity !== responseIdentity) return;
  const target = found.at(position); if (!target) return;
  findAt = position;
  if (page !== target.page) { page = target.page; rebuild(); }
  selection(target.id); findStatus();
}
async function updateFind() {
  finder.cancel(); found = null; findAt = -1; $('find-matches').replaceChildren();
  const query = $('filter').value;
  renderTree();
  if (!output || !query) { $('find-status').textContent = 'Find searches loaded evidence only.'; $('find-next').disabled = true; $('find-previous').disabled = true; return; }
  $('find-status').textContent = 'Finding within loaded evidence…';
  const result = await finder.find(query, { scope: $('find-scope').value, page });
  if (!result?.isCurrent() || result.responseIdentity !== responseIdentity) return;
  found = result;
  result.preview.forEach((node, index) => {
    const preview = button(node.label, () => goToMatch(index), 'find-match');
    const detail = document.createElement('small');
    detail.textContent = `${node.kind} · ${node.id} · ${node.file || 'file not supplied'}${node.mode ? ` · ${node.mode}` : ''} · page ${node.page + 1}${node.originalRank ? ` · original rank ${node.originalRank}` : ''}`;
    preview.append(detail); $('find-matches').append(preview);
  });
  findStatus();
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
  const requestEpoch = ++compileEpoch;
  const submittedSource = $('source').value;
  $('compile-status').textContent = 'Compiling bounded story…';
  try {
    const result = await compiler.compile(submittedSource);
    if (current !== loadId || requestEpoch !== compileEpoch) return;
    if (!diagramMode) return;
    const mounted = mountDiagram($('diagram'), result, story.bindings, selection);
    validSource = submittedSource; compiled = result; diagram = mounted;
    if (selected) diagram.select(selected);
    $('compile-status').textContent = `${compiled.layout.nodes.length} shapes · ${compiled.layout.nodes.filter(node => story.bindings[node.name]).length} bound identities · Reladraw 0.16.0`;
    $('export-svg').disabled = false; $('export-story').disabled = false;
  } catch (error) {
    if (current !== loadId || requestEpoch !== compileEpoch) return;
    const captured = captureWorkspaceFailure(error);
    if (current !== loadId || requestEpoch !== compileEpoch) return;
    if (captured.name !== 'AbortError') { $('compile-status').textContent = captured.message; notice(captured.message, true); }
  }
}
function rebuild(initialProjection = null) {
  loadId++; compiler.cancel(); compiled = null; diagram = null; $('export-svg').disabled = true; $('export-story').disabled = true;
  projection = initialProjection || projectOutput(output, { page, relation: $('relation').value });
  pageLookup = createPageIdentityLookup(projection);
  const relation = $('relation').value;
  $('relation').replaceChildren(new Option('All types', ''), ...projection.relationKinds.map(kind => new Option(kind, kind)));
  $('relation').value = projection.relationKinds.includes(relation) ? relation : '';
  for (const id of expanded) if (!pageLookup.has(id)) expanded.delete(id);
  story = authorProjection(projection); $('source').value = story.source;
  $('family').textContent = projection.family;
  $('generation').textContent = projection.generation ? `Pinned generation · ${typeof projection.generation === 'string' ? projection.generation : JSON.stringify(projection.generation)}` : 'Generation not supplied · identity cannot be verified';
  $('page').textContent = `${page + 1}`; $('previous').disabled = page === 0; $('next').disabled = !projection.hasNext;
  const c = projection.coverage;
  $('coverage').textContent = `Source total unknown · response ${c.responseEntities} entities / ${c.responseRelations} relations · admitted ${c.admittedEntities} / ${c.admittedRelations} · outside page ${c.omittedEntities} / ${c.omittedRelations} · source/query gaps retained in evidence`;
  $('sections').replaceChildren();
  projection.sections.forEach(section => $('sections').append(button(section.title, () => {
    selectionPublication = null;
    $('selection').textContent = section.title; $('detail').replaceChildren(inspectValue(section.value));
  })));
  renderTree(); if (diagramMode) { $('diagram').replaceChildren(document.createTextNode('Compiling this admitted page…')); compileSource(); } else renderEvidenceList();
  if (selected) {
    if (pageLookup.has(selected)) selection(selected, false);
    else { $('selection').textContent = 'Selected identity is outside this page'; $('detail').replaceChildren(document.createTextNode(selected)); }
  }
  if ($('filter').value && $('find-scope').value === 'page') updateFind();
  else if (found) findStatus();
}
function accept(data, name) {
  // Validate projection before replacing any usable state.
  const next = projectOutput(data);
  finder.replace(data, responseIdentity + 1); responseIdentity++;
  found = null; findAt = -1; $('filter').value = ''; $('find-matches').replaceChildren();
  $('find-next').disabled = true; $('find-previous').disabled = true; $('find-status').textContent = 'Find searches loaded evidence only.';
  diagramMode = ['map', 'graph', 'semantic', 'context', 'symbolic'].includes(next.family);
  expanded.clear(); output = data; projection = next; page = 0; selected = null; selectionPublication = null; history = []; historyAt = -1;
  $('detail').replaceChildren(); $('selection').textContent = 'Select an entity or evidence surface';
  $('relation').value = '';
  $('export-evidence').disabled = false; $('back').disabled = true; $('forward').disabled = true;
  notice(`${name} · ${next.family === 'unknown' ? 'No recognized semantic schema. Evidence inspection only.' : 'Source values retained without reinterpretation.'}`);
  rebuild(next);
}
$('open-button').onclick = () => $('open').click();
$('open').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  const epoch = ++actionEpoch, current = () => epoch === actionEpoch;
  requests.cancel(); activeRequest = null; $('next-response').disabled = true;
  const id = ++loadId;
  try { if (file.size > VIEW_LIMITS.bytes) throw new Error('File exceeds 2 MiB. Use a bounded query/export rather than a complete index.');
    const data = JSON.parse(await file.text()); if (!current() || id !== loadId) return superseded(); accept(data, file.name);
  } catch (error) { return reportActionFailure(error, current); } finally { if (current()) event.target.value = ''; }
};
for (const name of Object.keys(OPERATIONS)) $('operation').append(new Option(name, name));
$('query-toggle').onclick = () => { $('query').hidden = !$('query').hidden; };
$('editor-toggle').onclick = () => { $('editor').hidden = !$('editor').hidden; if (output && !diagramMode) { diagramMode = true; compileSource(); } };
$('data-view').onclick = () => { if (projection) { diagramMode = !diagramMode; if (diagramMode) compileSource(); else { compiler.cancel(); renderEvidenceList(); } } };
async function runQuery(continuation = false) {
  const epoch = ++actionEpoch, current = () => epoch === actionEpoch;
  try {
    const input = continuation ? structuredClone(activeRequest.input) : JSON.parse($('request').value);
    const operation = continuation ? activeRequest.operation : $('operation').value;
    const cursor = projection?.cursor;
    if (continuation) { if (!cursor) return; if (input.request) input.request.cursor = cursor; else input.cursor = cursor; }
    const expected = input.generation ?? input.request?.generation ?? null;
    notice('Loading a bounded response…');
    const data = await requests.request(operation, input, { token: $('token').value, expectedGeneration: expected });
    if (!current()) return superseded();
    accept(data, `${operation} response`); if (!current()) return superseded(); activeRequest = { operation, input };
    $('next-response').disabled = !projection.cursor;
  } catch (error) { return reportActionFailure(error, current); }
}
$('run').onclick = () => runQuery(); $('next-response').onclick = () => runQuery(true);
$('cancel').onclick = () => { actionEpoch++; requests.cancel(); notice('Request cancelled. Previous admitted view retained.'); };
$('previous').onclick = () => { if (page > 0) { page--; rebuild(); } };
$('next').onclick = () => { if (projection?.hasNext) { page++; rebuild(); } };
$('relation').onchange = () => { if (output) rebuild(); };
$('filter').oninput = updateFind; $('find-scope').onchange = updateFind;
$('find-next').onclick = () => { if (found?.count) goToMatch((findAt + 1) % found.count); };
$('find-previous').onclick = () => { if (found?.count) goToMatch(findAt < 0 ? found.count - 1 : (findAt + found.count - 1) % found.count); };
$('compile').onclick = () => { diagramMode = true; compileSource(); };
$('reset-source').onclick = () => { if (story) { $('source').value = story.source; compileSource(); } };
$('zoom-in').onclick = () => { zoom = Math.min(3, zoom * 1.25); diagram?.zoom(zoom); };
$('zoom-out').onclick = () => { zoom = Math.max(0.2, zoom / 1.25); diagram?.zoom(zoom); };
$('fit').onclick = () => { $('diagram').scrollTo({ top: 0, left: 0 }); if (diagram) { diagram.svg.style.width = '100%'; diagram.svg.style.height = '100%'; } };
$('close-detail').onclick = () => { selectionPublication = null; $('detail').replaceChildren(); $('selection').textContent = 'Inspector closed · selection retained'; };
function followHistory(position) {
  const entry = history[position]; if (!entry) return;
  historyAt = position;
  if (page !== entry.page) { page = entry.page; rebuild(); }
  selection(entry.id, false);
}
$('back').onclick = () => { if (historyAt > 0) followHistory(historyAt - 1); };
$('forward').onclick = () => { if (historyAt < history.length - 1) followHistory(historyAt + 1); };
$('export-svg').onclick = () => { if (diagram) download('pairofcleats-story.svg', new XMLSerializer().serializeToString(diagram.svg), 'image/svg+xml'); };
$('export-story').onclick = () => download('pairofcleats-story.json', JSON.stringify({ ...story, source: validSource, coverage: projection.coverage }, null, 2));
$('export-evidence').onclick = () => download('pairofcleats-output.json', JSON.stringify(output, null, 2));
window.addEventListener('pagehide', () => { actionEpoch++; compiler.cancel(); requests.cancel(); finder.dispose(); pageLookup = null; });
// Served reports can hand in one bounded initial model; API workspace starts empty.
const initial = document.getElementById('map-data');
if (initial) { try { accept(JSON.parse(initial.textContent), 'Code map report'); } catch (error) { notice(error.message, true); } }
