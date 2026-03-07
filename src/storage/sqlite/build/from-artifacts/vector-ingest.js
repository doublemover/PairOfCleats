import { performance } from 'node:perf_hooks';
import {
  packUint32,
  packUint8,
  dequantizeUint8ToFloat32,
  isVectorEncodingCompatible,
  resolveEncodedVectorBytes,
  resolveVectorEncodingBytes,
  toSqliteRowId
} from '../../vector.js';

/**
 * Create vector/minhash ingestion helpers bound to sqlite state.
 * @param {object} ctx
 * @returns {object}
 */
export const createVectorIngestor = (ctx) => {
  const {
    db,
    resolvedBatchSize,
    recordBatch,
    recordTable,
    warn,
    validationStats,
    vectorAnn,
    vectorExtension,
    encodeVector,
    quantization,
    modelConfig,
    insertMinhash,
    insertDense,
    insertDenseMeta,
    recordDenseClamp
  } = ctx;

  let vectorAnnInsertWarned = false;

  const ingestMinhash = async (minhashSource, targetMode) => {
    if (!minhashSource) return;
    const start = performance.now();
    const rows = [];
    let minhashRows = 0;
    const insertTx = db.transaction((batch) => {
      for (const entry of batch) {
        if (!entry) continue;
        insertMinhash.run(targetMode, entry.docId, packUint32(entry.sig));
        validationStats.minhash += 1;
        minhashRows += 1;
      }
    });
    const flush = () => {
      if (!rows.length) return;
      insertTx(rows);
      rows.length = 0;
      recordBatch('minhashBatches');
    };
    const handleEntry = (docId, sig) => {
      if (!Number.isFinite(docId) || !sig) return;
      rows.push({ docId, sig });
      if (rows.length >= resolvedBatchSize) flush();
    };
    if (Array.isArray(minhashSource?.signatures)) {
      const signatures = minhashSource.signatures;
      for (let docId = 0; docId < signatures.length; docId += 1) {
        handleEntry(docId, signatures[docId]);
      }
    } else if (typeof minhashSource?.[Symbol.asyncIterator] === 'function') {
      for await (const entry of minhashSource) {
        if (entry && typeof entry === 'object') {
          handleEntry(entry.docId ?? entry.id, entry.sig ?? entry.signature);
        } else {
          handleEntry(entry?.docId, entry?.sig);
        }
      }
    }
    flush();
    recordTable('minhash_signatures', minhashRows, performance.now() - start);
  };

  const ingestDense = async (dense, targetMode) => {
    if (dense?.fields || dense?.arrays) {
      const fields = dense.fields && typeof dense.fields === 'object' ? dense.fields : null;
      const arrays = dense.arrays && typeof dense.arrays === 'object' ? dense.arrays : null;
      dense = {
        ...dense,
        ...(fields || {}),
        vectors: dense.vectors ?? arrays?.vectors
      };
    }
    const hasDenseArray = Array.isArray(dense?.vectors) && dense.vectors.length > 0;
    const hasDenseBuffer = !!(
      dense?.buffer
      && ArrayBuffer.isView(dense.buffer)
      && dense.buffer.BYTES_PER_ELEMENT === 1
    );
    const hasDenseRows = typeof dense?.rows?.[Symbol.asyncIterator] === 'function';
    if (!hasDenseArray && !hasDenseRows && !hasDenseBuffer) return;
    let denseDims = Number.isFinite(dense?.dims)
      ? Number(dense.dims)
      : (hasDenseArray ? (dense.vectors.find((vec) => vec && vec.length)?.length || 0) : 0);
    const denseScale = typeof dense?.scale === 'number' ? dense.scale : 1.0;
    let denseMetaWritten = false;
    const ensureDenseMeta = (sampleVec = null) => {
      if (denseMetaWritten) return;
      if ((!denseDims || denseDims <= 0) && sampleVec && typeof sampleVec.length === 'number') {
        denseDims = sampleVec.length || 0;
      }
      insertDenseMeta.run(
        targetMode,
        denseDims || null,
        denseScale,
        dense?.model || modelConfig.id || null,
        quantization.minVal,
        quantization.maxVal,
        quantization.levels
      );
      denseMetaWritten = true;
      recordTable('dense_meta', 1, 0);
    };
    if (denseDims > 0) {
      ensureDenseMeta();
    }
    const start = performance.now();
    let denseRows = 0;
    const denseBatch = [];
    const flushDenseBatch = db.transaction((batch) => {
      for (const item of batch) {
        const docId = item?.docId;
        const vec = item?.vec;
        if (!Number.isFinite(docId) || !vec) continue;
        ensureDenseMeta(vec);
        insertDense.run(targetMode, docId, packUint8(vec, { onClamp: recordDenseClamp }));
        validationStats.dense += 1;
        denseRows += 1;
        if (vectorAnn?.insert && encodeVector) {
          const floatVec = dequantizeUint8ToFloat32(
            vec,
            quantization.minVal,
            quantization.maxVal,
            quantization.levels
          );
          const encoded = encodeVector(floatVec, vectorExtension);
          if (encoded) {
            const compatible = isVectorEncodingCompatible({
              encoded,
              dims: denseDims,
              encoding: vectorExtension.encoding
            });
            if (!compatible) {
              if (!vectorAnnInsertWarned) {
                const expectedBytes = resolveVectorEncodingBytes(denseDims, vectorExtension.encoding);
                const actualBytes = resolveEncodedVectorBytes(encoded);
                warn(
                  `[sqlite] Vector extension insert skipped for ${targetMode}: ` +
                  `encoded length ${actualBytes ?? 'unknown'} != expected ${expectedBytes ?? 'unknown'} ` +
                  `(dims=${denseDims}, encoding=${vectorExtension.encoding || 'float32'}).`
                );
                vectorAnnInsertWarned = true;
              }
            } else {
              vectorAnn.insert.run(toSqliteRowId(docId), encoded);
            }
          }
        }
      }
    });
    const flush = () => {
      if (!denseBatch.length) return;
      flushDenseBatch(denseBatch);
      denseBatch.length = 0;
      recordBatch('denseBatches');
    };
    if (hasDenseArray) {
      for (let docId = 0; docId < dense.vectors.length; docId += 1) {
        const vec = dense.vectors[docId];
        if (!vec) continue;
        denseBatch.push({ docId, vec });
        if (denseBatch.length >= resolvedBatchSize) flush();
      }
    } else if (hasDenseBuffer) {
      const rowWidth = Number.isFinite(denseDims) && denseDims > 0 ? Math.floor(denseDims) : 0;
      const buffer = dense.buffer;
      const count = Number.isFinite(Number(dense?.count))
        ? Math.max(0, Math.floor(Number(dense.count)))
        : (rowWidth > 0 ? Math.floor(buffer.length / rowWidth) : 0);
      if (rowWidth > 0 && count > 0) {
        for (let docId = 0; docId < count; docId += 1) {
          const start = docId * rowWidth;
          const end = start + rowWidth;
          if (end > buffer.length) break;
          denseBatch.push({ docId, vec: buffer.subarray(start, end) });
          if (denseBatch.length >= resolvedBatchSize) flush();
        }
      }
    } else if (hasDenseRows) {
      let fallbackDocId = 0;
      for await (const entry of dense.rows) {
        const vec = (entry && typeof entry === 'object' && !Array.isArray(entry))
          ? (entry.vector ?? entry.values ?? null)
          : entry;
        const entryDocIdRaw = (entry && typeof entry === 'object' && !Array.isArray(entry))
          ? (entry.docId ?? entry.id ?? null)
          : null;
        const entryDocId = Number.isFinite(Number(entryDocIdRaw))
          ? Math.max(0, Math.floor(Number(entryDocIdRaw)))
          : null;
        const docId = entryDocId ?? fallbackDocId;
        if (vec) {
          denseBatch.push({ docId, vec });
          if (denseBatch.length >= resolvedBatchSize) flush();
        }
        fallbackDocId += 1;
      }
    }
    flush();
    if (!denseMetaWritten && hasDenseArray) {
      ensureDenseMeta();
    }
    recordTable('dense_vectors', denseRows, performance.now() - start);
    dense.vectors = null;
    dense.buffer = null;
  };

  return {
    ingestDense,
    ingestMinhash
  };
};
