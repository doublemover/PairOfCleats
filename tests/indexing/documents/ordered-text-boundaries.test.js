#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizePageText } from '../../../src/index/extractors/pdf.js';
import { parseDocxParagraphsFromXml } from '../../../src/index/extractors/docx.js';
assert.equal(normalizePageText([{ str: 'first', hasEOL: true }, { str: 'second' }]), 'first\nsecond');
assert.equal(normalizePageText([{ str: 'first' }, { str: '', hasEOL: true }, { str: 'second' }]), 'first\nsecond');
assert.equal(normalizePageText([{ str: 'one' }, { str: 'two' }]), 'one two');
assert.deepEqual(parseDocxParagraphsFromXml('<w:document><w:p></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A</w:t><w:t>B</w:t><w:tab/><w:t>C</w:t><w:br w:type="textWrapping"/><w:t>É😀 &amp; D</w:t><w:cr/><w:t>E</w:t></w:r></w:p></w:document>'),
  [{ index: 2, style: 'Heading1', text: 'AB C\nÉ😀 & D\nE' }]);
