import assert from 'node:assert/strict';
import { verifyNativeTuiConpty } from '../helpers/native-tui-conpty.js';
assert.equal(process.platform, 'win32', 'This qualification owner requires Windows ConPTY.');
await verifyNativeTuiConpty('shutdown-partial-frame');
