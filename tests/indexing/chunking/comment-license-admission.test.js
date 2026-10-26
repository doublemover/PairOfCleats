import assert from 'node:assert/strict';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { COMMENT_CLASSIFICATION_VERSION, DEFAULT_COMMENT_LICENSE_PATTERN } from '../../../src/index/comments-policy.js';
import { buildCommentMeta } from '../../../src/index/build/file-processor/cpu/meta.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { createSafeRegex } from '../../../src/shared/safe-regex.js';
import { projectFileAnalysisComments, restoreFileAnalysisComments } from '../../../src/index/build/workers/file-analysis-risk.js';

const meta = (text, config = normalizeCommentConfig()) => buildCommentMeta({ text, ext: '.js',
  mode: 'extracted-prose', languageId: 'javascript', lineIndex: buildLineIndex(text),
  normalizedCommentsConfig: config, tokenDictWords: new Set(), dictConfig: {} });
assert.ok(DEFAULT_COMMENT_LICENSE_PATTERN.length <= 512, 'default remains inside the unchanged safe-regex pattern bound');
for (const [text, token] of [
  ['Submit a request with optional timeout and retry limits.', 'submit'],
  ['Commit durable records before publishing verified generation snapshots.', 'commit'],
  ['Permit isolated readers while respecting explicit lifetime limits.', 'permit'],
  ['Document limits without changing retry timeout scheduling semantics.', 'limit'],
  ['Unicode 提交MIT许可 retains ordinary parser documentation and useful retrieval tokens.', 'unicode'],
  ['The Apache adapter handles copyright policy discussions and license configuration fields.', 'adapter']
]) {
  const result = meta(`/** ${text} */`);
  assert.equal(result.commentEntries.length, 1, text);
  assert.equal(result.commentEntries[0].type, 'doc'); assert.equal(result.commentEntries[0].originalType, 'doc');
  assert.equal(result.commentEntries[0].licenseClassification, null);
  assert.ok(result.commentEntries[0].tokens.includes(token), `real tokenizer retains ${token}`);
  assert.equal(result.extraSegments.filter(segment => segment.type === 'comment').length, 1);
  assert.equal(result.commentEntries[0].proseAdmission.reason, 'included');
}

for (const [notice, reason] of [
  ['SPDX-License-Identifier: MIT', 'spdx-notice'],
  ['spdx-license-identifier: Apache-2.0', 'spdx-notice'],
  ['Copyright 2026 Example contributors', 'copyright-notice'],
  ['Copyright (c) 2026 Example contributors', 'copyright-notice'],
  ['© 2026 Example contributors', 'copyright-notice'],
  ['MIT License', 'license-notice'],
  ['Apache License, Version 2.0', 'license-notice'],
  ['License: BSD-3-Clause', 'license-notice'],
  ['License: GPL-3.0-only', 'license-notice'],
  ['License: LGPL-2.1-or-later', 'license-notice'],
  ['Licensed under the GPL-3.0-only license.', 'license-notice'],
  ['Permission is hereby granted, free of charge, to any person obtaining a copy.', 'license-notice']
]) {
  const text = `/**\n * ${notice}\n */`;
  const excluded = meta(text, normalizeCommentConfig({ minDocChars: 1, minTokens: 1 }));
  const comment = excluded.commentRanges[0]; assert.ok(comment, notice);
  assert.equal(comment.type, 'license'); assert.equal(comment.originalType, 'doc');
  assert.deepEqual(comment.licenseClassification, { policyVersion: COMMENT_CLASSIFICATION_VERSION,
    scope: 'comment-occurrence', reason, confidence: 'qualified-notice' });
  assert.equal(comment.proseAdmission.reason, 'license-excluded'); assert.equal(excluded.extraSegments.length, 0);
  const included = meta(text, normalizeCommentConfig({ includeLicense: true, minDocChars: 1, minTokens: 1 }));
  assert.equal(included.extraSegments.length, 1); assert.equal(included.commentEntries[0].proseAdmission.reason, 'included');
}
const mixed = '/**\n * Submit a request with optional timeout and retry limits.\n * SPDX-License-Identifier: MIT\n */';
const mixedResult = meta(mixed);
assert.equal(mixedResult.commentRanges[0].originalType, 'doc');
assert.equal(mixedResult.commentRanges[0].licenseClassification.scope, 'comment-occurrence');
assert.equal(mixedResult.extraSegments.length, 0, 'documented whole-occurrence exclusion keeps the original doc role');
assert.equal(meta('/*! Copyright 2026 Example contributors. */', normalizeCommentConfig({ minTokens: 1 }))
  .commentRanges[0].type, 'license', 'retained bang-comment notices remain qualified');
for (const [padding, expected] of [[199, 'license'], [200, 'doc']]) {
  const result = meta('\n'.repeat(padding) + '/** SPDX-License-Identifier: MIT */', normalizeCommentConfig({ minTokens: 1 }));
  assert.equal(result.commentRanges[0].type, expected, `start line ${padding + 1} preserves the header boundary`);
}

const custom = normalizeCommentConfig({ licensePattern: /submit/i });
const customResult = meta('/** Submit a request with optional timeout and retry limits. */', custom);
assert.equal(customResult.commentRanges[0].type, 'license', 'explicit custom regex keeps its deliberate substring semantics');
assert.equal(customResult.commentRanges[0].licenseClassification.reason, 'configured-license-pattern');
const safe = createSafeRegex('SPECIAL LEGAL TAG', 'i', { engine: 're2js', maxInputLength: 73 }); assert.ok(safe);
const normalized = normalizeCommentConfig({ licensePattern: safe });
const repeated = normalizeCommentConfig(normalized);
const restored = normalizeCommentConfig(restoreFileAnalysisComments(projectFileAnalysisComments(normalized)));
for (const config of [normalized, repeated, restored]) {
  assert.equal(config.licensePattern.source, 'SPECIAL LEGAL TAG');
  assert.equal(config.licensePattern.config.maxInputLength, 73);
  assert.equal(config.licensePattern.engine, 're2js');
  assert.equal(meta('/** SPECIAL LEGAL TAG plus useful ordinary documentation words. */', config).commentRanges[0].type, 'license');
  assert.equal(meta('/** Submit a request with optional timeout and retry limits. */', config).commentRanges[0].type, 'doc');
}
const first = extractComments({ text: mixed, ext: '.js', languageId: 'javascript', lineIndex: buildLineIndex(mixed), config: custom });
assert.equal(first.comments[0].licenseClassification.reason, 'configured-license-pattern');
console.log('Ordinary documentation reaches real prose tokens while explicit notices retain role, reason and configured exclusion.');
