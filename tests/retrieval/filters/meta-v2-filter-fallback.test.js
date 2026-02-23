#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterChunks } from '../../../src/retrieval/output.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';

const meta = [
  {
    id: 0,
    file: 'src/main.ts',
    ext: '.ts',
    codeRelations: {},
    docmeta: {
      record: {}
    },
    metaV2: {
      lang: 'typescript',
      effective: { languageId: 'typescript' },
      signature: 'compute(value)',
      params: ['value'],
      annotations: ['available'],
      dataflow: {
        reads: ['config'],
        writes: ['state'],
        mutations: ['state'],
        aliases: ['cfg']
      },
      controlFlow: {
        branches: 2,
        loops: 1,
        breaks: 1,
        continues: 1
      },
      structural: [
        {
          pack: 'security',
          ruleId: 'sql.injection',
          tags: ['sqli']
        }
      ],
      modifiers: ['public', 'async', 'generator', 'returns'],
      risk: {
        tags: ['security'],
        categories: ['injection'],
        sources: [{ name: 'request.body' }],
        sinks: [{ name: 'eval', category: 'injection' }],
        flows: [{ source: 'request.body', sink: 'eval' }]
      },
      record: {
        owner: 'platform',
        tier: 'core'
      },
      types: {
        declared: {
          returns: [{ type: 'Promise<Result>' }]
        },
        inferred: {
          params: {
            value: [{ type: 'Input' }]
          },
          returns: [{ type: 'Result' }]
        }
      }
    }
  }
];

const filterIndex = buildFilterIndex(meta, { fileChargramN: 3 });

const expectIds = (filters, expected, label) => {
  const actual = filterChunks(meta, filters, filterIndex).map((entry) => entry.id).sort();
  const expectedSorted = expected.slice().sort();
  assert.deepEqual(actual, expectedSorted, label);
};

expectIds({ signature: 'compute' }, [0], 'signature should match metaV2.signature');
expectIds({ param: 'value' }, [0], 'param should match metaV2.params');
expectIds({ decorator: 'available' }, [0], 'decorator should match metaV2.annotations fallback');
expectIds({ reads: 'config' }, [0], 'reads should match metaV2.dataflow.reads');
expectIds({ writes: 'state' }, [0], 'writes should match metaV2.dataflow.writes');
expectIds({ mutates: 'state' }, [0], 'mutates should match metaV2.dataflow.mutations');
expectIds({ alias: 'cfg' }, [0], 'alias should match metaV2.dataflow.aliases');
expectIds({ branches: 2 }, [0], 'branches should match metaV2.controlFlow.branches');
expectIds({ loops: 1 }, [0], 'loops should match metaV2.controlFlow.loops');
expectIds({ visibility: 'public' }, [0], 'visibility should match metaV2.modifiers');
expectIds({ structPack: 'security' }, [0], 'structPack should match metaV2.structural');
expectIds({ structRule: 'sql.injection' }, [0], 'structRule should match metaV2.structural');
expectIds({ structTag: 'sqli' }, [0], 'structTag should match metaV2.structural');
expectIds({ async: true }, [0], 'async should match metaV2.modifiers');
expectIds({ generator: true }, [0], 'generator should match metaV2.modifiers');
expectIds({ returns: true }, [0], 'returns should match metaV2.modifiers/returns');
expectIds({ returnType: 'promise' }, [0], 'returnType should match metaV2.types.declared.returns');
expectIds({ inferredType: 'input' }, [0], 'inferredType should match metaV2.types.inferred');
expectIds({ riskTag: 'security' }, [0], 'riskTag should match metaV2.risk.tags');
expectIds({ riskSource: 'request.body' }, [0], 'riskSource should match metaV2.risk.sources');
expectIds({ riskSink: 'eval' }, [0], 'riskSink should match metaV2.risk.sinks');
expectIds({ riskCategory: 'injection' }, [0], 'riskCategory should match metaV2.risk categories');
expectIds({ riskFlow: 'request.body->eval' }, [0], 'riskFlow should match metaV2.risk.flows');
expectIds({ meta: [{ key: 'owner', value: 'platform' }] }, [0], 'meta filter should match metaV2.record');

console.log('metaV2 filter fallback test passed');
