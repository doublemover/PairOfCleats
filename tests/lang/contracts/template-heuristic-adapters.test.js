#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import { assertHeuristicAdapterCases } from '../helpers/heuristic-adapter-contracts.js';

applyTestEnv();

const CASES = [
  {
    id: 'handlebars',
    source: [
      '{{> shared.header}}',
      '{{#*inline "card"}}',
      '  {{helper user}}',
      '{{/inline}}'
    ].join('\n'),
    expectedImport: 'shared.header',
    expectedExport: 'card',
    expectedUsage: 'helper'
  },
  {
    id: 'mustache',
    source: [
      '{{> account.card}}',
      '{{#item}}',
      '  {{format item}}',
      '{{/item}}'
    ].join('\n'),
    expectedImport: 'account.card',
    expectedExport: 'item',
    expectedUsage: 'format'
  },
  {
    id: 'jinja',
    source: [
      '{% include "layout/header.html" %}',
      '{% macro render_card(user) %}',
      '  {{ helper(user) }}',
      '{% endmacro %}'
    ].join('\n'),
    expectedImport: 'layout/header.html',
    expectedExport: 'render_card',
    expectedUsage: 'helper'
  },
  {
    id: 'razor',
    source: [
      '@using Acme.Web',
      '@section Scripts {',
      '  @RenderSection("Scripts", required: false)',
      '}',
      '@Html.Partial("Shared/_Card")'
    ].join('\n'),
    expectedImport: 'Acme.Web',
    expectedExport: 'Scripts',
    expectedUsage: 'Shared/_Card'
  }
];

assertHeuristicAdapterCases(CASES, { usageLabel: 'template usage' });

console.log('template heuristic adapters contract test passed');
