import assert from 'node:assert/strict';
import { createJinjaTemplateStructureParser, parseJinjaTemplateStructure, resolveJinjaTemplateDialect } from '../../../src/shared/jinja-template-structure.js';
import { chunkJinja, createJinjaChunker } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { collectJinjaImports, createJinjaImportCollector } from '../../../src/index/language-registry/import-collectors/jinja.js';
import { createJinjaManagedAdapter } from '../../../src/index/language-registry/adapters/heuristic.js';
import { collectLanguageImports } from '../../../src/index/language-registry/registry.js';
import { LANGUAGE_CAPS_BASELINES, TREE_SITTER_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';

const text = [
  '😀 header', '{%- raw -%}', '{% block Ghost %}', '{% include "raw.fake" %}',
  '{%+ endraw +%}', '{# {% include "comment.fake" %} #}',
  '{{ "{% include \'string.fake\' %}" }}',
  '{{ {"key": "{% block DictGhost %}", "value": [user.name]} }}',
  '{% block Real %}', '{% include "real.html" %}', '{% endblock Real %}',
  '{% macro render_item(item) %}', '{{ helper(item) }}', '{% endmacro %}',
  '<div title="{% include \'attribute.html\' %}">text</div>'
].join('\r\n');
const model = parseJinjaTemplateStructure(text);
assert.equal(model.parser, 'heuristic-template-lexical');
assert.equal(model.coverage, 'heuristic');
assert.equal(model.dialect, 'jinja');
assert.equal(model.rangeSource, 'application-utf16-lexical');
assert.equal(parseJinjaTemplateStructure(text), model);
assert.ok(Object.isFrozen(model) && Object.isFrozen(model.headings[0]));
assert.deepEqual(model.definitions.map((entry) => entry.name), ['Real', 'render_item']);
assert.deepEqual(collectJinjaImports(text), ['real.html', 'attribute.html']);
assert.ok(!model.referenceEntries.some((entry) => /Ghost|fake/u.test(entry.value)));
assert.ok(model.referenceEntries.some((entry) => entry.value === 'user.name'));
assert.equal(model.headings[0].start, text.indexOf('{% block Real %}'));
assert.equal(text.slice(model.headings[0].start, model.headings[0].end), '{% block Real %}');
const chunks = chunkJinja(text);
assert.ok(chunks.every((entry) => entry.meta.astRange === undefined && entry.meta.parserCoverage === 'heuristic'
  && entry.meta.rangeSource === 'application-utf16-lexical' && entry.start === entry.meta.lexicalRange.start));
assert.equal(chunkJinja('😀 {% block Real %}{% endblock %}')[0].start, 3, 'UTF-16 offset includes both emoji code units');
const adapter = createJinjaManagedAdapter();
const relations = adapter.buildRelations({ text, options: {} });
assert.deepEqual(relations.exports, ['Real', 'render_item']);
assert.deepEqual(relations.imports, collectJinjaImports(text));
assert.ok(relations.usages.includes('helper') && !relations.usages.some((value) => /Ghost|fake/u.test(value)));
assert.equal(adapter.capabilityProfile.state, 'partial');
assert.ok(relations.calls.length <= 96);
assert.equal(adapter.extractDocMeta({ chunk: chunks[0] }).source, 'managed-template-lexical-heuristic');
assert.deepEqual(collectJinjaImports('{%- include\n "real.html" -%}'), ['real.html']);
assert.deepEqual(collectJinjaImports('{%+ include "real.html" +%}'), ['real.html']);
assert.deepEqual(collectJinjaImports('{% raw %}{% malformed {% endraw %}{% include "real.html" %}'), ['real.html']);
assert.deepEqual(collectJinjaImports(String.raw`{{ "escaped \" {% include 'fake' %}" }}{% include "real" %}`), ['real']);
assert.deepEqual(collectJinjaImports(String.raw`{% include 'a\'b.html' %}`), ["a'b.html"]);
assert.deepEqual(collectJinjaImports(String.raw`{% include "a\\b.html" %}`), ['a\\b.html']);
assert.deepEqual(collectJinjaImports(String.raw`{% include "a\x2eb.html" %}`), [], 'unsupported string escapes remain unresolved');
assert.deepEqual(collectJinjaImports('{% include "prefix" ~ variable %}{% include variable %}'), [], 'dynamic expressions are not a constant first-string import');
assert.deepEqual(collectJinjaImports('{% from "macros.html" import render %}{% import "other.html" as other %}'), ['macros.html', 'other.html']);

const djangoText = [
  '😀 header', '{% verbatim named %}', '{% endverbatim %}',
  '{{ "{% endverbatim named %}" }}', '{# {% endverbatim named %} #}',
  '{%- unsupported literal -%}', '{% block Ghost %}', '{% include "verbatim.fake" %}',
  '{% endverbatim named %}', '{% comment "optional note" %}',
  '{{ "{% endcomment %}" }}', '{% include "comment.fake" %}', '{% endcomment %}',
  '{% block Actual %}', '{% include "django.html" with value=user only %}', '{% endblock Actual %}'
].join('\n');
for (const ext of ['.django', '.djhtml']) {
  assert.equal(resolveJinjaTemplateDialect({ ext }), 'django');
  const model = parseJinjaTemplateStructure(djangoText, { ext });
  assert.equal(model.reason, null);
  assert.equal(model.dialect, 'django');
  assert.deepEqual(model.definitions.map((entry) => entry.name), ['Actual']);
  assert.deepEqual(collectLanguageImports({ text: djangoText, ext, relPath: `templates/page${ext}`, mode: 'code' }), ['django.html']);
  const dispatched = smartChunk({ text: djangoText, ext, relPath: `templates/page${ext}`, mode: 'code' });
  assert.deepEqual(dispatched.map((entry) => entry.name), ['block Actual', 'include "django.html"']);
  assert.ok(dispatched.every((entry) => entry.meta.templateDialect === 'django'));
  assert.deepEqual(adapter.buildRelations({ text: djangoText, ext, relPath: `templates/page${ext}`, options: {} }).exports, ['Actual']);
}
for (const ext of ['.jinja', '.jinja2', '.j2']) {
  assert.equal(resolveJinjaTemplateDialect({ ext }), 'jinja');
  assert.ok(smartChunk({ text, ext, mode: 'code' }).every((entry) => entry.meta.templateDialect === 'jinja'));
}
assert.equal(resolveJinjaTemplateDialect({ relPath: 'templates\\page.DJHTML' }), 'django');
assert.equal(parseJinjaTemplateStructure(djangoText).reason, 'unsupported-dialect-tag', 'Django verbatim is not Jinja raw');
assert.equal(parseJinjaTemplateStructure(text, { ext: '.django' }).reason, 'unsupported-django-whitespace-control');
assert.equal(parseJinjaTemplateStructure('{% raw %}data{% endraw %}', { ext: '.django' }).reason, 'unsupported-dialect-tag');
assert.deepEqual(collectJinjaImports('{% verbatim   name %}{% endverbatim name %}{% include "fake" %}{% endverbatim   name %}{% include "real" %}', { ext: '.django' }), ['real'], 'named terminator preserves its exact internal whitespace');
assert.deepEqual(collectJinjaImports('{% include\n "literal.html" %}{% include "real.html" %}', { ext: '.django' }), ['real.html'], 'Django multiline tag text is not a Jinja tag');
assert.deepEqual(collectJinjaImports('{# multiline\n {% include "active.html" %}\n#}', { ext: '.django' }), ['active.html'], 'Django single-line comment delimiters do not hide active tags in multiline text');
assert.deepEqual(collectJinjaImports('{# multiline\n {% include "active.html" %}\n#}'), [], 'Jinja comments can span lines');
assert.deepEqual(collectJinjaImports('{% include "inside%}name" %}'), ['inside%}name']);
assert.equal(parseJinjaTemplateStructure('{% include "inside%}name" %}', { ext: '.django' }).reason, 'unterminated-string', 'Django first-delimiter rule is not Jinja quote-aware delimiter handling');

for (const source of ['{% raw %}missing', '{% raw argument %}text{% endraw %}', '{% block Real %}',
  '{% block One %}{% endblock Two %}', '{% if ok %}{% endfor %}', '{{ "unclosed', '{# unclosed', '{{ (value] }}']) {
  assert.ok(parseJinjaTemplateStructure(source).reason);
  assert.equal(chunkJinja(source)[0].name, 'jinja');
  assert.deepEqual(collectJinjaImports(source), []);
  assert.deepEqual(adapter.buildRelations({ text: source, options: {} }).exports, []);
}
for (const source of ['{% verbatim named %}{% endverbatim %}', '{% comment %}unclosed', '{% verbatim\tname %}literal{% endverbatim name %}']) {
  assert.ok(parseJinjaTemplateStructure(source, { ext: '.django' }).reason);
  assert.deepEqual(collectJinjaImports(source, { ext: '.django' }), []);
}
const stable = createJinjaTemplateStructureParser({ now: () => 0 });
assert.equal(stable('x'.repeat(196609)).reason, 'source-limit');
assert.equal(stable('\n'.repeat(3000)).reason, 'line-limit');
assert.equal(stable('{{' + 'x'.repeat(8190) + '}}').reason, 'tag-length-limit');
assert.equal(stable('{{x}}'.repeat(4097)).reason, 'tag-limit');
assert.equal(stable('{{a+b+c+d+e+f}}'.repeat(3000)).reason, 'token-limit');
assert.equal(stable('{% if ok %}'.repeat(65) + '{% endif %}'.repeat(65)).reason, 'depth-limit');
assert.equal(stable('{{' + '('.repeat(65) + 'x' + ')'.repeat(65) + '}}').reason, 'depth-limit');
const source = '{% include "first" %}\n{% block Real %}{{value}}{% endblock %}\n{% include "excluded" %}';
const lineOptions = { collectorScanBudget: { maxLines: 2, maxMs: 0 } };
assert.deepEqual(collectJinjaImports(source, lineOptions), ['first']);
assert.ok(!adapter.buildRelations({ text: source, options: lineOptions }).imports.includes('excluded'));
assert.deepEqual(collectJinjaImports('{% include "first" %}{% include "second" %}', { collectorScanBudget: { maxMatches: 1, maxMs: 0 } }), ['first']);
assert.deepEqual(collectJinjaImports('{% include "first" %}{% include "second" %}', { collectorScanBudget: { maxTokens: 1, maxMs: 0 } }), ['first']);
const cached = createJinjaTemplateStructureParser();
assert.equal(cached('{% include "real" %}').reason, null);
assert.equal(cached('{% include "real" %}', { remainingMs: () => 0 }).reason, 'time-limit');
assert.equal(cached('text', { remainingMs: () => NaN }).reason, 'time-limit');
for (const mode of ['chunk', 'import', 'relation']) {
  let clock = 0;
  const parseStructure = createJinjaTemplateStructureParser({ now: () => (clock += 2) });
  const source = '{% block Real %}{% include "real" %}{% endblock %}';
  const options = { collectorNow: () => clock, collectorScanBudget: { maxMs: 10 }, collectorDiagnostics: [] };
  if (mode === 'chunk') assert.equal(createJinjaChunker({ parseStructure })(source,
    { treeSitter: { byLanguage: { jinja: { maxParseMs: 10 } } } })[0].meta.parserFallbackReason, 'time-limit');
  if (mode === 'import') assert.deepEqual(createJinjaImportCollector({ parseStructure })(source, options), []);
  if (mode === 'relation') assert.deepEqual(createJinjaManagedAdapter({ parseStructure }).buildRelations({ text: source, options }).exports, []);
  assert.ok(clock >= 10 && clock < 40, 'bounded lexical checks stop after actual caller expiration');
}
assert.deepEqual(LANGUAGE_CAPS_BASELINES.jinja, { maxBytes: 224 * 1024, maxLines: 3500 });
assert.deepEqual(TREE_SITTER_CAPS_BASELINES.jinja, { maxBytes: 224 * 1024, maxLines: 3500, maxParseMs: 1200 });
console.log('Distinct Jinja/Django lexical boundaries exclude opaque/string phantoms with UTF-16 ranges and caller bounds');
