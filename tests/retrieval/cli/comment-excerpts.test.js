#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  attachCommentExcerpts,
  buildCommentLookup
} from '../../../src/retrieval/cli/run-search-session/comment-excerpts.js';

const lookup = buildCommentLookup({
  joinComments: true,
  extractedChunkMeta: [
    {
      file: 'src/a.js',
      docmeta: {
        comments: [
          { start: 1, end: 2, text: 'alpha', type: 'line', style: 'slash' },
          { start: 1, end: 2, text: 'alpha', type: 'line', style: 'slash' },
          { start: 3, end: 4, text: 'beta', type: 'line', style: 'slash' },
          { start: 5, end: 6, text: 'gamma', type: 'line', style: 'slash' },
          { start: 7, end: 8, text: 'delta', type: 'line', style: 'slash' }
        ]
      }
    }
  ]
});

assert(lookup instanceof Map, 'expected lookup map when join-comments is enabled');
assert.equal(buildCommentLookup({ joinComments: false, extractedChunkMeta: [] }), null);

const hits = [
  {
    file: 'src/a.js',
    docmeta: {
      commentRefs: [
        { start: 1, end: 2 },
        { start: 1, end: 2 },
        { start: 3, end: 4 },
        { start: 5, end: 6 },
        { start: 7, end: 8 }
      ]
    }
  },
  {
    file: 'src/a.js',
    docmeta: {
      commentRefs: [{ start: 1, end: 2 }],
      commentExcerpt: 'already-set'
    }
  }
];

attachCommentExcerpts({ hits, commentLookup: lookup, maxExcerpts: 3 });

assert.equal(hits[0].docmeta.commentExcerpts.length, 3, 'expected excerpt limit to be enforced');
assert.deepEqual(
  hits[0].docmeta.commentExcerpts.map((entry) => entry.text),
  ['alpha', 'beta', 'gamma']
);
assert.equal(hits[0].docmeta.commentExcerpt, 'alpha');
assert.equal(hits[1].docmeta.commentExcerpt, 'already-set', 'pre-existing excerpt should not be overwritten');

console.log('comment excerpts helpers test passed');
