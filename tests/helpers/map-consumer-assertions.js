import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { buildStackModel } from '../../src/map/isometric/client/stack-model.js';
import { initMapData } from '../../src/map/isometric/client/map-data.js';
import { state } from '../../src/map/isometric/client/state.js';
import { renderSelectionDetails } from '../../src/map/isometric/client/selection.js';
import { scoreMember } from '../../src/map/isometric/client/layout-utils.js';
import { scoringDefaults } from '../../src/map/isometric/client/defaults.js';
import { initStackNavigation } from '../../src/map/isometric/client/stack-navigation.js';

/** The actual browser model/inspector and scoring functions, with DOM emulation.
 * This makes no WebGL, browser rendering or hardware-performance claim.
 */
export const assertMapConsumerComposition = async (map, { emptyFiles = [], aliases = new Map() } = {}) => {
  const model = buildStackModel(map.nodes, map.edges);
  assert.deepEqual(model.files.map(file => file.key).sort(), map.nodes.map(file => file.path).sort());
  assert.equal(model.coverage.unresolvedEdges, 0);
  assert.equal(model.coverage.omittedFiles, 0);
  assert.equal(model.coverage.omittedMembers, 0);
  const window = new Window({ settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const original = { ...state };
  try {
    globalThis.window = window; globalThis.document = window.document;
    document.body.innerHTML = '<div id="stack-tree"></div><input id="stack-search">'
      + '<button id="stack-back"></button><button id="stack-forward"></button>'
      + '<button id="stack-home"></button><button id="stack-focus"></button>'
      + '<select id="stack-mode"></select><input id="stack-all-edges" type="checkbox">'
      + '<button id="stack-plumbing"></button><div id="stack-legend"></div><div id="stack-breadcrumb"></div>';
    const body = document.createElement('div'); document.body.append(body);
    Object.assign(state, { map, rawMap: map, remoteSource: null, sourceIndex: null,
      dom: { selectionBody: body }, edges: map.edges, config: {}, sourceNavigationInitialized: false,
      graphWorkerReady: false });
    initMapData();
    initStackNavigation();
    const tree = document.getElementById('stack-tree');
    assert.deepEqual([...tree.querySelectorAll(':scope > details > summary')].map(summary => summary.textContent),
      map.nodes.map(file => `${file.path} · ${file.members.length} segments`));
    const rowValue = label => [...body.querySelectorAll('.sel-row')]
      .find(row => row.querySelector('.sel-label')?.textContent === label)?.querySelector('.sel-value');
    for (const file of emptyFiles) {
      const stack = model.fileByPath.get(file); assert.ok(stack, file);
      assert.equal(stack.members.length, 0, 'inventory-only files do not invent a symbol');
      renderSelectionDetails({ type: 'file', file });
      assert.equal(rowValue('Path').textContent, file);
      assert.equal(rowValue('Members').textContent, '0');
    }
    for (const [id, labels] of aliases) {
      const found = model.memberById.get(id); assert.ok(found, id);
      const member = found.segment.member;
      assert.deepEqual(member.dataflow?.aliases || [], labels);
      renderSelectionDetails({ type: 'member', file: found.file.key, id });
      assert.deepEqual([...rowValue('Aliases').querySelectorAll('.sel-pill')].map(pill => pill.textContent), labels,
        'the real inspector retains every alias, including entries after the third');
      assert.equal(rowValue('Id').textContent, String(id));
      const without = { ...member, dataflow: { ...member.dataflow, aliases: [] } };
      assert.ok(Math.abs(scoreMember(member, scoringDefaults) - scoreMember(without, scoringDefaults)
        - labels.length * scoringDefaults.dataflow) < 1e-9, 'all admitted aliases contribute exactly once to scoring');
      const edges = map.edges.filter(edge => edge.type === 'alias' && edge.from.member === id);
      assert.deepEqual(edges.map(edge => edge.label).sort(), labels.map(label => 'alias:' + label).sort());
      assert.ok(edges.every(edge => edge.from.file === found.file.key && edge.to.file === found.file.key
        && edge.to.member === id), 'alias annotations never invent an inter-symbol target');
      assert.equal(model.levels.segments.filter(edge => edge.type === 'alias' && edge.fromMember === id).length, labels.length);
    }
    return model;
  } finally {
    Object.assign(state, original);
    globalThis.window = previousWindow; globalThis.document = previousDocument;
    await window.happyDOM.close();
  }
};
