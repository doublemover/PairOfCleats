import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseExpressionAt } from 'acorn';

/** The callback returns undefined so guarded runtime-only postchecks stay idle. */
export const createInvocationRecorder = () => {
  const records = [];
  let current = null;
  return {
    runNode(label, script, args = [], options = {}) {
      assert.ok(current, 'action construction cannot execute a command');
      current.invocations.push({ label, script, args, options });
    },
    async record(actions) {
      for (const action of actions) {
        current = { group: action.group, label: action.label, covers: action.covers || [],
          coversTierB: action.coversTierB || [], invocations: [] };
        const expression = parseExpressionAt(`(${action.run.toString()})`, 0, { ecmaVersion: 'latest' });
        current.directDelegation = expression.type === 'ArrowFunctionExpression' && !expression.async
          && expression.body.type === 'CallExpression' && expression.body.callee.name === 'runNode';
        await action.run();
        records.push(current);
      }
      current = null;
      return records;
    }
  };
};

export const validateInvocationTargets = (records, root) => {
  const physicalRoot = fs.realpathSync(root);
  let checked = 0;
  for (const record of records) {
    assert.ok(record.invocations.length > 0, `${record.group}/${record.label} must declare an actual invocation`);
    for (const invocation of record.invocations) {
      const target = path.resolve(root, invocation.script);
      assert.ok(fs.existsSync(target), `stale executable target in ${record.group}/${record.label}: ${target}`);
      const relative = path.relative(physicalRoot, fs.realpathSync(target));
      assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        `executable target escaped allowed repository root: ${target}`);
      assert.ok(fs.statSync(target).isFile(), `executable target must be a file: ${target}`);
      checked++;
    }
  }
  return checked;
};
