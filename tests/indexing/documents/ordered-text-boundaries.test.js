#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizePageText } from '../../../src/index/extractors/pdf.js';
import { parseDocxParagraphsFromXml } from '../../../src/index/extractors/docx.js';
assert.equal(normalizePageText([{ str: 'first', hasEOL: true }, { str: 'second' }]), 'first\nsecond');
assert.equal(normalizePageText([{ str: 'first' }, { str: '', hasEOL: true }, { str: 'second' }]), 'first\nsecond');
assert.equal(normalizePageText([{ str: 'one' }, { str: 'two' }]), 'one two');
assert.deepEqual(parseDocxParagraphsFromXml('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A</w:t><w:t>B</w:t><w:tab/><w:t>C</w:t><w:br w:type="textWrapping"/><w:t>É😀 &amp; D</w:t><w:cr/><w:t>E</w:t></w:r></w:p></w:document>'),
  [{ index: 2, style: 'Heading1', text: 'AB C\nÉ😀 & D\nE' }]);

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
assert.deepEqual(parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}" xmlns:other="urn:untrusted"><w:p><w:r><w:t>Before </w:t><w:del><w:r><w:t>deleted</w:t></w:r></w:del><w:moveFrom w:id="1"><w:r><w:t>moved origin</w:t></w:r></w:moveFrom><w:moveTo w:id="1"><w:r><w:t>destination</w:t></w:r></w:moveTo><w:t> after</w:t></w:r></w:p><w:moveFrom w:id="2"><w:p><w:r><w:t>old paragraph</w:t></w:r></w:p></w:moveFrom><w:p><w:r><w:t>visible</w:t><other:t>spoofed text</other:t><other:moveFrom><w:t>not a Word deletion</w:t></other:moveFrom></w:r></w:p><w:p><w:r><w:t>retained </w:t><w:moveFromRangeStart w:id="3"/><w:t>old range</w:t><w:moveFromRangeEnd w:id="3"/><w:t>content</w:t></w:r></w:p></w:document>`), [
  { index: 1, text: 'Before destination after' },
  { index: 2, text: 'visiblenot a Word deletion' },
  { index: 3, text: 'retained content' }
]);
assert.throws(() => parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}"><w:p><w:moveFromRangeStart w:id="4"/><w:t>secret</w:t></w:p></w:document>`), /Unclosed DOCX moved-from range/);
assert.throws(() => parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}"><!DOCTYPE w:document><w:p><w:t>secret</w:t></w:p></w:document>`), /DTD|doctype/i);
