#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveWindowsCmdInvocation as resolveSharedInvocation } from '../../../src/shared/subprocess/windows-cmd.js';

const require = createRequire(import.meta.url);
const { resolveWindowsCmdInvocation } = require('../../../extensions/vscode/windows-cmd.js');

const args = ['alpha&beta', '%TEMP%', '!VALUE!', '^caret'];
const shared = resolveSharedInvocation('pairofcleats.cmd', args);
const extension = resolveWindowsCmdInvocation('pairofcleats.cmd', args);
assert.deepEqual(extension, shared, 'expected VS Code wrapper invocation to match shared Windows cmd escaping');

console.log('vscode windows cmd helper test passed');
