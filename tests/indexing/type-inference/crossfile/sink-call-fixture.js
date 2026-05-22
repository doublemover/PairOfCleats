import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const callerText = 'export function caller(input) { return sinkFn("abc"); }\n';

export const createSinkCallCalleeText = (paramName = 'value') => (
  `export function sinkFn(${paramName}) { return ${paramName}; }\n`
);

export const prepareSinkCallFixture = async (root, cacheName, { paramName = 'value' } = {}) => {
  const calleeText = createSinkCallCalleeText(paramName);
  const tempRoot = resolveTestCachePath(root, cacheName);
  const srcDir = path.join(tempRoot, 'src');
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, 'callee.js'), calleeText, 'utf8');
  await fs.writeFile(path.join(srcDir, 'caller.js'), callerText, 'utf8');
  return { tempRoot };
};

export const cleanupSinkCallFixture = async (tempRoot) => {
  await fs.rm(tempRoot, { recursive: true, force: true });
};

export const createSinkCallChunks = ({
  calleeInferredTypes = null,
  calleeRisk = {
    sinks: [
      {
        name: 'db.exec',
        category: 'sql-injection',
        severity: 'high',
        ruleId: 'sink-rule'
      }
    ],
    tags: ['security']
  },
  callerDocmeta = {
    risk: {
      sources: [
        {
          name: 'http.input',
          ruleId: 'source-rule',
          confidence: 0.8
        }
      ]
    }
  },
  paramName = 'value'
} = {}) => {
  const calleeText = createSinkCallCalleeText(paramName);
  const calleeDocmeta = {
    paramNames: [paramName]
  };

  if (calleeRisk) calleeDocmeta.risk = calleeRisk;
  if (calleeInferredTypes) {
    calleeDocmeta.inferredTypes = calleeInferredTypes;
  }

  return [
    {
      chunkUid: 'uid:callee',
      file: 'src/callee.js',
      name: 'sinkFn',
      kind: 'function',
      start: 0,
      end: calleeText.length,
      metaV2: {
        symbol: {
          symbolId: 'sym:callee',
          symbolKey: 'src/callee.js::sinkFn',
          chunkUid: 'uid:callee'
        }
      },
      codeRelations: {},
      docmeta: calleeDocmeta
    },
    {
      chunkUid: 'uid:caller',
      file: 'src/caller.js',
      name: 'caller',
      kind: 'function',
      start: 0,
      end: callerText.length,
      metaV2: {
        symbol: {
          symbolId: 'sym:caller',
          symbolKey: 'src/caller.js::caller',
          chunkUid: 'uid:caller'
        }
      },
      codeRelations: {
        calls: [[0, 'sinkFn']],
        callDetails: [
          {
            callee: 'sinkFn',
            args: ['"abc"']
          }
        ]
      },
      docmeta: callerDocmeta
    }
  ];
};
