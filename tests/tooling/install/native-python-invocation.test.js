import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runSetupPreflight } from '../../../tools/setup/preflight.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const require = createRequire(import.meta.url);
const PythonFinder = require('node-gyp/lib/find-python.js');
for (const executable of ['C:\\Python313\\python.exe', 'C:\\Python & tools\\PYTHON.EXE', '\\\\host\\python tools\\python.exe']) {
  const finder = new PythonFinder(executable);
  finder.win = true;
  const calls = [];
  finder.execFile = async (command, args, options) => {
    calls.push({ command, args, options });
    return [null, calls.length === 1 ? executable : '3.13.3', ''];
  };
  assert.equal(await finder.checkCommand(executable), executable);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, executable);
  assert.equal(calls[0].options.shell, false, 'absolute native executables preserve argument boundaries without CMD');
  assert.deepEqual(calls[0].args, finder.argsExecutable);
  assert.equal(calls[1].options.shell, false);
}
for (const command of ['python', 'C:\\tools\\python.cmd']) {
  const finder = new PythonFinder(command); finder.win = true;
  const calls = [];
  finder.execFile = async (executable, args, options) => {
    calls.push({ executable, args, options });
    return [null, calls.length === 1 ? 'C:\\Python313\\python.exe' : '3.13.3', ''];
  };
  await finder.checkCommand(command);
  assert.equal(calls[0].options.shell, true, 'relative commands and CMD launchers retain existing discovery');
  assert.equal(calls[1].options.shell, false);
}
// The preflight's selected child environment is accepted by npm 11 and by the
// actual locked node-gyp parser, without generating unknown-config warnings.
const discovery = runSetupPreflight();
assert.equal(discovery.childEnv.NODE_GYP_FORCE_PYTHON, discovery.python.executable);
assert.equal(discovery.childEnv.npm_package_config_node_gyp_python, discovery.python.executable);
assert.equal(Object.keys(discovery.childEnv).some(key => key.startsWith('npm_config_')), false);
console.log('Original node-gyp Python invocation and supported setup configuration passed.');
