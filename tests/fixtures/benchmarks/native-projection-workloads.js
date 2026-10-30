import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest('hex');
export const evidence = chunks => chunks.map(chunk => ({ name: chunk.name, kind: chunk.kind, start: chunk.start, end: chunk.end,
  coverage: chunk.meta?.syntaxCallCoverage || null, calls: (chunk.meta?.syntaxCalls || []).map(call => ({ ...call })) }));
const type = (name, kind = 'FunctionDeclaration') => ({ name, kind });
const call = (owner, callee, needle = callee + '()', prefix = '') => ({ owner, callee, needle, prefix });

export const projectionWorkloads = async language => {
  const specs = [];
  if (language === 'scala') {
    specs.push({ name: 'small', text: 'def owner(): Int = { target(); 1 }', names: [type('owner')], calls: [call('owner', 'target')] });
    specs.push({ name: 'wide', text: 'def owner(): Int = {\n'
      + Array.from({ length: 110 }, (_, i) => `target${i}()`).join('\n') + '\nowner()\n1\n}', names: [type('owner')],
    calls: [...Array.from({ length: 110 }, (_, i) => call('owner', 'target' + i)), call('owner', 'owner', '\nowner()', '\n')] });
    specs.push({ name: 'declarations', text: Array.from({ length: 48 }, (_, i) => `def owner${i}(): Int = target${i}()`).join('\n'),
      names: Array.from({ length: 48 }, (_, i) => type('owner' + i)), calls: Array.from({ length: 48 }, (_, i) => call('owner' + i, 'target' + i)) });
    specs.push({ name: 'deep', text: 'def owner(): Int = {\n' + 'if (ready) {\n'.repeat(32) + 'target()\n' + '}\n'.repeat(32) + '1\n}',
      names: [type('owner')], calls: [call('owner', 'target')] });
  } else if (language === 'lua') {
    specs.push({ name: 'small', text: 'function owner() target() end', names: [type('owner')], calls: [call('owner', 'target')] });
    specs.push({ name: 'wide', text: 'function owner()\n'
      + Array.from({ length: 128 }, (_, i) => `target${i}()`).join('\n') + '\nowner()\nend', names: [type('owner')],
    calls: [...Array.from({ length: 128 }, (_, i) => call('owner', 'target' + i)), call('owner', 'owner', '\nowner()', '\n')] });
    specs.push({ name: 'declarations', text: Array.from({ length: 48 }, (_, i) => `function owner${i}() target${i}() end`).join('\n'),
      names: Array.from({ length: 48 }, (_, i) => type('owner' + i)), calls: Array.from({ length: 48 }, (_, i) => call('owner' + i, 'target' + i)) });
    specs.push({ name: 'deep', text: 'function owner()\n' + 'if ready then\n'.repeat(24) + 'target()\n' + 'end\n'.repeat(24) + 'end',
      names: [type('owner')], calls: [call('owner', 'target')] });
  } else {
    assert.equal(language, 'css');
    specs.push({ name: 'small', text: '.small { color: red; }', names: [type('.small', 'StyleRule')], calls: [] });
    const names = Array.from({ length: 96 }, (_, i) => `.item${i}[data-label="a  b"]`);
    specs.push({ name: 'wide', text: names.map(name => name + ' { color: red; }').join('\n'), names: names.map(name => type(name, 'StyleRule')), calls: [] });
    specs.push({ name: 'declarations', text: Array.from({ length: 48 }, (_, i) => `.item${i} { margin: ${i}px; }`).join('\n'),
      names: Array.from({ length: 48 }, (_, i) => type('.item' + i, 'StyleRule')), calls: [] });
    specs.push({ name: 'deep', text: '@media screen {\n'.repeat(24) + '.inside { color: red; }\n' + '}\n'.repeat(24),
      names: [...Array.from({ length: 24 }, () => type('@media screen', 'StyleRule')), type('.inside', 'StyleRule')], calls: [] });
  }
  const saved = {
    scala: { path: 'tests/fixtures/languages/src/Widget.scala', sha256: '430be510177fa6ffec3d7f2b1d8a33ba2871b12fd8703e2e4ebd4e46d49a856f',
      names: [type('Widget', 'ClassDeclaration'), type('WidgetFactory', 'ObjectDeclaration'), type('WidgetFactory.buildWidget', 'MethodDeclaration')],
      calls: [call('WidgetFactory.buildWidget', 'Widget', 'Widget("ok")')], from: 'Widget("ok")', to: 'Widget("edited")' },
    lua: { path: 'tests/fixtures/languages/src/lua_advanced.lua', sha256: '2eb450196603807a4dcf5b78663cda9b19b7128425a981ab262d9781a4bb64d5',
      names: [type('Widget.new', 'MethodDeclaration'), type('Widget.render', 'MethodDeclaration'), type('make_widget')],
      calls: [call('Widget.new', 'setmetatable', 'setmetatable({ name = name }, self)'), call('make_widget', 'Widget.new', 'return Widget:new(name)', 'return ')],
      from: 'return self.name', to: 'return self.name .. "edited"' },
    css: { path: 'tests/fixtures/formats/src/styles.css', sha256: '2e52ec411ccc7b8aa273bdc20f3cd57dbfeb47386340444f9f2556e4dbbc57af',
      names: [type('.page-header', 'StyleRule'), type('@media screen and (max-width: 900px)', 'StyleRule'), type('.page-header', 'StyleRule')],
      calls: [], from: 'flex-direction: column;', to: 'flex-direction: row;' }
  }[language];
  const bytes = await fs.readFile(saved.path), text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(digest(text), saved.sha256, 'independent saved-source input binding');
  assert.equal(text.split(saved.from).length, 2, 'one declaration edit only');
  specs.push({ ...saved, name: 'saved', text, physicalSha256: digest(bytes) });
  const edited = text.replace(saved.from, saved.to);
  specs.push({ ...saved, name: 'edited', text: edited,
    calls: saved.calls.map(item => ({ ...item, needle: item.needle.replace(saved.from, saved.to) })) });
  return specs;
};

export const assertProjection = (chunks, spec) => {
  assert.ok(chunks?.length);
  assert.deepEqual(chunks.map(({ name, kind }) => ({ name, kind })), spec.names);
  assert.ok(chunks.every(chunk => !chunk.meta?.wholeFile));
  const actual = chunks.flatMap(chunk => (chunk.meta?.syntaxCalls || []).map(row => ({ owner: chunk.name, row })));
  assert.equal(actual.length, spec.calls.length);
  const remaining = [...actual];
  for (const expected of spec.calls) {
    // The authored full invocation spelling supplies an independent source
    // range, including method receivers, argument lists and Unicode prefixes.
    const found = spec.text.indexOf(expected.needle), start = found + (expected.prefix || '').length;
    assert.ok(found >= 0); assert.equal(spec.text.indexOf(expected.needle, found + 1), -1);
    const index = remaining.findIndex(({ owner, row }) => owner === expected.owner && row.callee === expected.callee
      && row.start === start && row.end === found + expected.needle.length);
    assert.ok(index >= 0, expected.owner + ' -> ' + expected.callee);
    const [{ row }] = remaining.splice(index, 1);
    assert.equal(row.resolution, 'unresolved'); assert.equal(row.coordinateSystem, 'utf16');
  }
  assert.equal(remaining.length, 0);
  return evidence(chunks);
};
