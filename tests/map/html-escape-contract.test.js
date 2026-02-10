#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../helpers/test-env.js';
import { escapeHtml } from '../../src/map/shared/escape-html.js';
import { renderSvgHtml } from '../../src/map/html-writer.js';
import { renderDot } from '../../src/map/dot-writer.js';

applyTestEnv();

assert.equal(escapeHtml('<a&"b>'), '&lt;a&amp;&quot;b&gt;');

const html = renderSvgHtml({
  svg: '<svg><text>x</text></svg>',
  title: 'Map <Main>',
  mapModel: {
    summary: { counts: { files: 1, members: 1, edges: 0 } },
    warnings: ['bad <warn>'],
    legend: { functionBadges: {}, edgeStyles: {} }
  }
});
assert.equal(html.includes('<title>Map &lt;Main&gt;</title>'), true);
assert.equal(html.includes('bad &lt;warn&gt;'), true);

const dot = renderDot({
  nodes: [{
    path: 'src/<main>.js',
    category: 'source',
    members: [{
      id: 'm1',
      port: 'p<1>',
      name: 'fn<unsafe>',
      signature: '"x"',
      modifiers: {}
    }]
  }],
  edges: [],
  legend: {
    fileShapes: {},
    edgeStyles: {},
    functionBadges: {}
  }
});
assert.equal(dot.includes('&lt;main&gt;'), true);
assert.equal(dot.includes('fn&lt;unsafe&gt;'), true);
assert.equal(dot.includes('PORT="p&lt;1&gt;"'), true);

console.log('html escape contract test passed');
