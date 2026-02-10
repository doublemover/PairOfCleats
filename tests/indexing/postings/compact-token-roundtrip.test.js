#!/usr/bin/env node
import assert from 'node:assert/strict';
import { encodeVarint64List, decodeVarint64List } from '../../../src/shared/artifact-io/varint.js';
import { hashTokenId, parseHash64, formatHash64 } from '../../../src/shared/token-id.js';

const tokens = ['alpha', 'beta', 'gamma', 'delta'];
const tokenIds = tokens.map((token) => hashTokenId(token));
const packed = encodeVarint64List(tokenIds.map((id) => parseHash64(id)));
const decoded = decodeVarint64List(packed).map((value) => formatHash64(value));

assert.deepEqual(decoded, tokenIds, 'packed token ids should roundtrip');

console.log('compact token roundtrip test passed');
