import assert from 'node:assert/strict';
import { discoverSegments } from '../../../src/index/segments.js';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { collectEmbeddedSemanticSources, getSegmentSemanticContext } from '../../../src/index/semantic/embedded-source.js';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';

// Authored source/storage regression; this does not qualify an Astro language
// server, generated template bindings, a compiler upgrade or a published index.
const frontmatter = '\r\ninterface Props { title: string }\r\nconst title: Props["title"] = "hé😀";\r\n';
const text = '---' + frontmatter + '---\r\n<main>{title}</main>\r\n<script>console.log("browser");</script>';
const fixture = await createRecoveryFixture(text);
try {
  const segments = discoverSegments({ text, ext: '.astro', relPath: 'Page.astro', mode: 'code' });
  const front = segments.find(segment => segment.meta?.block === 'frontmatter');
  assert.ok(front);
  assert.equal(front.languageId, 'typescript');
  assert.equal(text.slice(front.start, front.end), frontmatter);
  assert.equal(segments.find(segment => segment.meta?.block === 'script')?.languageId, 'javascript');
  const policy = { languages: ['javascript', 'typescript'], storage: { batchRows: 16, batchBytes: 8192 }, enrichment: { bindings: 'off' } };
  const parent = await collectFileSemanticFacts({ ...fixture.options, bytes: fixture.bytes, text,
    language: 'astro', relPath: 'original.js', repositoryNamespace: fixture.root, policy });
  const embedded = await collectEmbeddedSemanticSources({ parentFacts: parent, segments: [front], text,
    repositoryNamespace: fixture.root, stagingRoot: fixture.stagingRoot,
    storage: { relativePath: 'semantic', generation: fixture.generation }, diskAccount: fixture.account, policy });
  const { tsSyntax } = getSegmentSemanticContext(embedded.syntaxContexts, front);
  assert.equal(tsSyntax.sourceFile.parseDiagnostics.length, 0);
  assert.equal(tsSyntax.identity.family, 'typescript');
  assert.equal(tsSyntax.sourceFile.text, frontmatter);
  const local = embedded.sourceFacts[0].facts;
  assert.equal(local.source.language, 'typescript');
  assert.equal(local.source.mapping.quality, 'exact');
  assert.equal(local.source.mapping.parentSourceUnitId, parent.source.sourceUnitId);
  const rows = [];
  for await (const row of fixture.store([local.partition]).iterateRows(local.partition.partitionId, 'semantic_records')) rows.push(row);
  assert.ok(rows.some(row => row.data.astKind === 'InterfaceDeclaration'));
  assert.ok(rows.some(row => row.data.astKind === 'IndexedAccessType'));
  assert.ok(rows.every(row => !row.span || row.span[0] >= 0 && row.span[1] <= frontmatter.length));
  for (const sourceText of ['---\nconst plain = 1;\n---\n<p/>', '---\nconst broken: =\n---\n<p/>']) {
    const found = discoverSegments({ text: sourceText, ext: '.astro', relPath: 'Partial.astro', mode: 'code' });
    const candidate = found.find(segment => segment.meta?.block === 'frontmatter');
    if (candidate) assert.equal(candidate.languageId, 'typescript');
  }
  console.log('Astro frontmatter keeps TypeScript syntax and exact immutable embedded storage');
} finally { await fixture.cleanup(); }
