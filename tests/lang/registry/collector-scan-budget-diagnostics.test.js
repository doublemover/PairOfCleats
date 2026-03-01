#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { collectGraphqlImports } from '../../../src/index/language-registry/import-collectors/graphql.js';
import { collectJinjaImports } from '../../../src/index/language-registry/import-collectors/jinja.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

applyTestEnv();

const graphqlDiagnostics = [];
const graphqlSource = Array.from({ length: 16 }, (_, index) => `#import "mod${index}.graphql"`).join('\n');
const graphqlImports = collectGraphqlImports(graphqlSource, {
  collectorDiagnostics: graphqlDiagnostics,
  collectorScanBudgets: {
    graphql: {
      maxChars: 16384,
      maxMatches: 64,
      maxTokens: 3,
      maxMs: 200
    }
  }
});
assert.equal(graphqlImports.length, 3);
const graphqlBudgetDiagnostic = graphqlDiagnostics.find((entry) => entry?.collectorId === 'graphql');
assert.ok(graphqlBudgetDiagnostic, 'expected GraphQL budget diagnostic');
assert.ok(
  Array.isArray(graphqlBudgetDiagnostic.reasons) && graphqlBudgetDiagnostic.reasons.includes('scan_tokens'),
  'expected GraphQL token budget reason'
);

const jinjaDiagnostics = [];
const jinjaSource = Array.from({ length: 24 }, () => '{% include "partials/item.html" %}').join('\n');
collectJinjaImports(jinjaSource, {
  collectorDiagnostics: jinjaDiagnostics,
  collectorScanBudgets: {
    jinja: {
      maxChars: 40,
      maxMatches: 32,
      maxTokens: 32,
      maxMs: 200
    }
  }
});
const jinjaBudgetDiagnostic = jinjaDiagnostics.find((entry) => entry?.collectorId === 'jinja');
assert.ok(jinjaBudgetDiagnostic, 'expected Jinja budget diagnostic');
assert.ok(
  Array.isArray(jinjaBudgetDiagnostic.reasons) && jinjaBudgetDiagnostic.reasons.includes('source_bytes'),
  'expected Jinja source truncation diagnostic'
);

let fakeNowMs = 0;
const graphqlTimeoutDiagnostics = [];
collectGraphqlImports('#import "one.graphql"\n#import "two.graphql"\n', {
  collectorDiagnostics: graphqlTimeoutDiagnostics,
  collectorNow: () => {
    fakeNowMs += 10;
    return fakeNowMs;
  },
  collectorScanBudgets: {
    graphql: {
      maxChars: 4096,
      maxMatches: 32,
      maxTokens: 32,
      maxMs: 5
    }
  }
});
const graphqlTimeoutDiagnostic = graphqlTimeoutDiagnostics.find((entry) => entry?.collectorId === 'graphql');
assert.ok(graphqlTimeoutDiagnostic, 'expected GraphQL timeout diagnostic');
assert.ok(
  Array.isArray(graphqlTimeoutDiagnostic.reasons) && graphqlTimeoutDiagnostic.reasons.includes('scan_time'),
  'expected GraphQL timeout reason'
);

const makefileEntry = LANGUAGE_REGISTRY.find((entry) => entry.id === 'makefile');
assert.ok(makefileEntry, 'expected makefile heuristic adapter entry');
const heuristicDiagnostics = [];
const makefileSource = Array.from(
  { length: 48 },
  (_, index) => `target${index}: dep${index} dep${index + 1}`
).join('\n');
const makefileRelations = makefileEntry.buildRelations({
  text: makefileSource,
  relPath: 'Makefile',
  options: {
    collectorDiagnostics: heuristicDiagnostics,
    collectorScanBudgets: {
      'heuristic-adapter:makefile': {
        maxChars: 65536,
        maxMatches: 4,
        maxTokens: 4,
        maxMs: 200
      }
    }
  }
});
assert.ok(Array.isArray(makefileRelations?.usages), 'expected makefile usages from heuristic adapter');
const heuristicBudgetDiagnostic = heuristicDiagnostics.find(
  (entry) => entry?.collectorId === 'heuristic-adapter:makefile'
);
assert.ok(heuristicBudgetDiagnostic, 'expected heuristic adapter budget diagnostic');
assert.ok(
  Array.isArray(heuristicBudgetDiagnostic.reasons)
  && (
    heuristicBudgetDiagnostic.reasons.includes('scan_matches')
    || heuristicBudgetDiagnostic.reasons.includes('scan_tokens')
  ),
  'expected heuristic adapter match/token budget reason'
);

console.log('collector scan budget diagnostics test passed');
