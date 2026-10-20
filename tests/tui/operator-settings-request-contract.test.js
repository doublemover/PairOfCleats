import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertTuiSettingsRequest } from '../../src/contracts/validators/tui-settings.js';

const scopeId = randomUUID(), previewId = randomUUID();
const revision = `sha256:${'a'.repeat(64)}`, schemaRevision = `sha256:${'b'.repeat(64)}`;
const valid = {
  dispatch: { proto: 'poc.tui@1', op: 'settings:run', jobId: 'settings-1', method: 'inspect', params: { scopeId } },
  select: { kind: 'repo', target: 'C:/fixture repository' },
  inspect: { scopeId },
  preview: { scopeId, revision, schemaRevision, operation: 'edit', path: ['threads'], value: 1 },
  commit: { scopeId, previewId, confirmed: true },
  cancel: { scopeId, previewId }
};
for (const [kind, request] of Object.entries(valid)) {
  assert.equal(assertTuiSettingsRequest(kind, request), request);
  assert.throws(() => assertTuiSettingsRequest(kind, { ...request, configPath: '../outside.json' }),
    { code: 'ERR_TUI_SETTINGS_REQUEST' }, `${kind}: unknown authority fields never disappear silently`);
}
assertTuiSettingsRequest('select', { kind: 'workspace', target: 'workspace.jsonc' });
assertTuiSettingsRequest('preview', { scopeId, revision, schemaRevision, operation: 'reset' });
for (const [kind, request] of [
  ['unknown', {}], ['select', { kind: 'shell', target: 'cmd.exe' }],
  ['dispatch', { ...valid.dispatch, method: 'shell' }],
  ['dispatch', { ...valid.dispatch, jobId: '../outside' }],
  ['dispatch', { ...valid.dispatch, jobId: 'x'.repeat(129) }],
  ['select', { kind: 'repo', target: 'x'.repeat(4097) }], ['inspect', { scopeId: 'unbound' }],
  ['preview', { ...valid.preview, operation: 'delete' }],
  ['preview', { ...valid.preview, revision: 'author-cache' }],
  ['preview', { ...valid.preview, schemaRevision: 'missing' }],
  ['preview', { ...valid.preview, operation: 'reset' }],
  ['preview', { ...valid.preview, path: [] }],
  ['preview', { ...valid.preview, path: Array(33).fill('a') }],
  ['preview', { ...valid.preview, value: undefined }],
  ['preview', { ...valid.preview, value: Number.NaN }],
  ['preview', { ...valid.preview, value: Infinity }],
  ['preview', { ...valid.preview, value: 'x'.repeat(128 * 1024) }],
  ['preview', { ...valid.preview, value: Array(4096).fill(0) }],
  ['commit', { ...valid.commit, confirmed: 'yes' }],
  ['cancel', { scopeId }]
]) assert.throws(() => assertTuiSettingsRequest(kind, request), { code: 'ERR_TUI_SETTINGS_REQUEST' });
let deep = 1;
for (let index = 0; index < 25; index++) deep = { child: deep };
assert.throws(() => assertTuiSettingsRequest('preview', { ...valid.preview, value: deep }),
  { code: 'ERR_TUI_SETTINGS_REQUEST' }, 'reject excessive depth before recursive validation/stringification');
const circular = {}; circular.self = circular;
assert.throws(() => assertTuiSettingsRequest('preview', { ...valid.preview, value: circular }),
  { code: 'ERR_TUI_SETTINGS_REQUEST' });
console.log('TUI settings requests retain strict shape, authority, JSON identity and resource bounds');
