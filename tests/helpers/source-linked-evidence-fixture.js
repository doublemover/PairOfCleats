import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from './semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../src/index/semantic/file-ref.js';
import { normalizeSemanticConfig } from '../../src/index/semantic/config.js';

/** Tiny canonical storage fixture. Its synthetic parser row does not qualify a
 * real language admission/extractor or an operational published index. */
export const createSourceLinkedEvidenceFixture = async inputs => {
  const f = await createRecoveryFixture('fixture storage owner');
  try {
    const sources = new Map(), syntaxPartitions = [];
    const policy = normalizeSemanticConfig({ enabled: true });
    const state = { semanticFactsByFile: new Map(), semanticCompilerContexts: [],
      semanticDiskAccount: f.account, semanticEvidenceArtifacts: [] };
    for (const { filename, text, language } of inputs) {
      const bytes = Buffer.from(text);
      const source = createSemanticSourceSnapshot({ bytes, repositoryNamespace: f.root, path: filename, language }).manifest;
      await fs.writeFile(path.join(f.root, filename), bytes);
      const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId,
        parser: { family: 'source-linked-fixture', version: '1', options: {} },
        extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
      const syntax = await f.write([semanticNode(0, source.textLength)], { source, sourceBytes: bytes, partitionId });
      const facts = createSemanticFactsRef({ source, syntaxPartitionId: partitionId,
        storage: { relativePath: 'semantic', generation: f.generation }, partitions: [syntax], coverage: [] });
      const item = { file: filename, text, bytes, source, syntax, facts, root: f.stagingRoot };
      sources.set(filename, item); state.semanticFactsByFile.set(filename, facts); syntaxPartitions.push(syntax);
    }
    return { ...f, sources, syntaxPartitions, state, policy, runtime: { root: f.root, buildRoot: f.root } };
  } catch (error) { await f.cleanup(); throw error; }
};
