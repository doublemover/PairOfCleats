#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildVfsVirtualPath } from '../../../src/index/tooling/vfs.js';

const cases = [
  {
    name: 'whole-file virtual path keeps container path and vfs prefix',
    input: {
      containerPath: 'src/app.js',
      segmentUid: null,
      effectiveExt: '.js'
    },
    expected: '.poc-vfs/src/app.js'
  },
  {
    name: 'segment virtual path appends segment uid and effective extension',
    input: {
      containerPath: 'docs/readme.md',
      segmentUid: 'segu:v1:deadbeef',
      effectiveExt: '.ts'
    },
    expected: '.poc-vfs/docs/readme.md#seg:segu:v1:deadbeef.ts'
  },
  {
    name: 'container path escapes % and # so the segment delimiter remains unambiguous',
    input: {
      containerPath: 'docs/hello%world#v2.md',
      segmentUid: 'segu:v1:cafebabe',
      effectiveExt: '.js'
    },
    expected: '.poc-vfs/docs/hello%25world%23v2.md#seg:segu:v1:cafebabe.js'
  }
];

for (const testCase of cases) {
  const actual = buildVfsVirtualPath(testCase.input);
  assert.equal(actual, testCase.expected, testCase.name);

  // Repeat calls should produce byte-identical output.
  assert.equal(buildVfsVirtualPath(testCase.input), testCase.expected, `${testCase.name} (repeat)`);

  // Verify the container component never leaks a raw '#'.
  const [containerComponent] = actual.split('#seg:');
  assert.ok(containerComponent.startsWith('.poc-vfs/'), `${testCase.name}: missing .poc-vfs prefix`);
  assert.ok(!actual.includes('\\'), `${testCase.name}: virtual path should not contain backslashes`);
  assert.ok(
    !containerComponent.slice('.poc-vfs/'.length).startsWith('/'),
    `${testCase.name}: container path should remain repo-relative`
  );

  if (testCase.input.containerPath.includes('#')) {
    assert.ok(
      containerComponent.includes('%23'),
      `${testCase.name}: expected container '#' to be encoded as %23`
    );
    assert.ok(
      !containerComponent.slice('.poc-vfs/'.length).includes('#'),
      `${testCase.name}: raw '#' leaked into encoded container path`
    );
  }

  if (testCase.input.containerPath.includes('%')) {
    assert.ok(
      containerComponent.includes('%25'),
      `${testCase.name}: expected container '%' to be encoded as %25`
    );
  }
}

const segmentA = buildVfsVirtualPath({
  containerPath: 'src/segment.ts',
  segmentUid: 'segu:v1:a',
  effectiveExt: '.ts'
});
const segmentB = buildVfsVirtualPath({
  containerPath: 'src/segment.ts',
  segmentUid: 'segu:v1:b',
  effectiveExt: '.ts'
});
assert.equal(
  segmentA.split('#seg:')[0],
  segmentB.split('#seg:')[0],
  'segment switch should only affect #seg suffix'
);
assert.notEqual(segmentA, segmentB, 'segment switch should change virtual path');

const extA = buildVfsVirtualPath({
  containerPath: 'src/segment.ts',
  segmentUid: 'segu:v1:a',
  effectiveExt: '.ts'
});
const extB = buildVfsVirtualPath({
  containerPath: 'src/segment.ts',
  segmentUid: 'segu:v1:a',
  effectiveExt: '.tsx'
});
assert.equal(
  extA.split('#seg:')[0],
  extB.split('#seg:')[0],
  'effectiveExt changes should only affect #seg suffix'
);
assert.ok(extA.endsWith('.ts'), 'effectiveExt should be applied to segment suffix');

console.log('VFS virtualPath stability ok');
