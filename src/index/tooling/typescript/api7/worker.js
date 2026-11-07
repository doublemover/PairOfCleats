import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRecordWriter, readRecords } from '../runtime/protocol.js';
import { TYPESCRIPT_API7_PROFILE } from '../../../../shared/typescript-api7-pins.js';
import { api7Failure, api7Identity, captureTypeScriptApi7Request, TYPESCRIPT_API7_FS_CALLBACKS, TYPESCRIPT_API7_LIMITS } from './request.js';
import { projectTypeScriptApi7Snapshot } from './projection.js';

export const runTypeScriptApi7Worker = async ({ input = process.stdin, output = process.stdout } = {}) => {
  let init;
  for await (const record of readRecords(input, TYPESCRIPT_API7_LIMITS, TYPESCRIPT_API7_LIMITS.maxInputBytes)) {
    if (init || record.type !== 'request' || Object.keys(record).sort().join(',') !== 'pipe,request,sdkRoot,toolIdentity,type,virtualRoot'
      || !path.isAbsolute(record.sdkRoot || '') || !/^\\\\\.\\pipe\\pairofcleats-api7-[a-f0-9]{32}$/.test(record.pipe || '')
      || !/^C:\/__pairofcleats_api7__\/[a-f0-9]{32}$/.test(record.virtualRoot || '')) throw api7Failure('invalid-worker-request');
    init = { ...record, request: captureTypeScriptApi7Request(record.request) };
    if (!record.toolIdentity || Object.keys(record.toolIdentity).sort().join(',') !== 'native,sdk'
      || ['sdk', 'native'].some(role => Object.keys(record.toolIdentity[role] || {}).sort().join(',') !== 'descriptorId,installId'
        || !/^[a-f0-9]{64}$/.test(record.toolIdentity[role].descriptorId) || !/^[a-f0-9]{64}$/.test(record.toolIdentity[role].installId))) throw api7Failure('invalid-worker-tool-identity');
  }
  if (!init) throw api7Failure('missing-worker-request');
  const load = relative => import(pathToFileURL(path.join(init.sdkRoot, relative)).href);
  const [sdk, fs, callbacks] = await Promise.all([load('dist/api/async/api.js'), load('dist/api/fs.js'), load('dist/api/fsCallbacks.js')]);
  const names = ['readFile', 'fileExists', 'directoryExists', 'getAccessibleEntries', 'realpath', 'stat', 'writeFile', 'removeFile'];
  const configured = callbacks.configureFileSystemCallbacks(Object.fromEntries(names.map(name => [name, fs.serverFS.error])));
  if (configured.callbackNames.length || configured.arguments.join(',') !== TYPESCRIPT_API7_FS_CALLBACKS) throw api7Failure('pinned-filesystem-callback-contract');
  const api = new sdk.API({ pipe: init.pipe }); let snapshot, result, firstError, snapshotDisposed = false, apiClosed = false;
  try {
    const files = init.request.files.map(file => [init.virtualRoot + '/' + file.path, file.text]);
    const params = { fileSystem: fs.createFileSystem(files) };
    if (init.request.project.kind === 'roots') params.createPrograms = [{ rootFiles: init.request.project.roots.map(file => init.virtualRoot + '/' + file),
      compilerOptions: { noEmit: true, noLib: true, strict: true, types: [], target: 'esnext', module: 'nodenext', moduleResolution: 'nodenext' } }];
    else params.openProjects = init.request.project.configFiles.map(file => init.virtualRoot + '/' + file);
    snapshot = await api.createSnapshot(params);
    result = await projectTypeScriptApi7Snapshot({ sdk, snapshot, request: init.request, virtualRoot: init.virtualRoot, toolIdentity: init.toolIdentity });
  } catch (error) { firstError = error; }
  finally {
    if (snapshot) {
      // Programs created inside the snapshot have no independent owning
      // snapshot. Dispose them before retiring their snapshot and API session.
      for (const project of snapshot.getProjects()) {
        try { await project.program.dispose(); }
        catch (error) { firstError = firstError ? new AggregateError([firstError, error], 'Program disposal failed.', { cause: firstError }) : error; }
      }
      try { await snapshot.dispose(); snapshotDisposed = snapshot.isDisposed(); }
      catch (error) { firstError = firstError ? new AggregateError([firstError, error], 'Snapshot disposal failed.', { cause: firstError }) : error; }
    }
    try { await api.close(); apiClosed = true; }
    catch (error) { firstError = firstError ? new AggregateError([firstError, error], 'API disposal failed.', { cause: firstError }) : error; }
  }
  if (firstError) throw firstError;
  const write = createRecordWriter(output, TYPESCRIPT_API7_LIMITS, TYPESCRIPT_API7_LIMITS.maxOutputBytes);
  await write({ type: 'result', value: { schemaVersion: 1, profile: TYPESCRIPT_API7_PROFILE,
    requestIdentity: api7Identity(init.request), ...result, lifecycle: { snapshotDisposed, apiClosed } } });
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runTypeScriptApi7Worker(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
