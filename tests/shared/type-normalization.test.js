#!/usr/bin/env node
import assert from 'node:assert/strict';

import { canonicalizeTypeText } from '../../src/shared/type-normalization.js';

const pythonOptional = canonicalizeTypeText('typing.Optional[ builtins.str ]', { languageId: 'python' });
assert.equal(pythonOptional.displayText, 'str | None', 'expected python Optional alias normalization');
assert.equal(pythonOptional.originalText, 'typing.Optional[ builtins.str ]');

const tsNestedGeneric = canonicalizeTypeText('Promise < Result < Foo | undefined > >', { languageId: 'typescript' });
assert.equal(tsNestedGeneric.displayText, 'Promise<Result<Foo | undefined>>', 'expected nested generic spacing normalization');

const rustPrefixes = canonicalizeTypeText('std::vec::Vec<crate::model::Thing>', { languageId: 'rust' });
assert.equal(rustPrefixes.displayText, 'vec::Vec<model::Thing>', 'expected rust module prefix stripping');

const csharpGlobal = canonicalizeTypeText('global::System.Collections.Generic.List<global::MyApp.Widget>', { languageId: 'csharp' });
assert.equal(
  csharpGlobal.displayText,
  'System.Collections.Generic.List<MyApp.Widget>',
  'expected csharp global qualifier stripping'
);

console.log('shared type normalization test passed');
