import { MAX_JSON_BYTES, loadJsonArrayArtifact } from '../../../../src/shared/artifact-io.js';
import { writeRelationBenchGraphArtifacts } from '../../../../tools/bench/index/relations-fixture.js';

export const writeAndLoadRelationBenchGraphArtifacts = async ({
  outDir,
  chunks,
  fileRelations,
  maxJsonBytes,
  loadMaxBytes = MAX_JSON_BYTES
}) => {
  const pieces = [];
  await writeRelationBenchGraphArtifacts({
    outDir,
    chunks,
    fileRelations,
    maxJsonBytes,
    onPiece: (entry, _filePath, label) => {
      pieces.push({ ...entry, path: label });
    }
  });

  const manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    mode: 'code',
    stage: 'stage2',
    pieces
  };

  const rows = await loadJsonArrayArtifact(outDir, 'graph_relations', {
    manifest,
    strict: true,
    maxBytes: loadMaxBytes
  });

  return { pieces, manifest, rows };
};
