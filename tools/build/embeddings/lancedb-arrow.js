import { DataType, Field, FixedSizeList, Float32, Int64, Schema, Struct,
  RecordBatch, Table, makeData } from 'apache-arrow';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';

/** One schema for every batch, independent of configured column spelling. */
export const createLanceVectorContract = ({ dims, idColumn, embeddingColumn, batchSize,
  quantization, normalize }) => {
  if (!Number.isSafeInteger(dims) || dims < 1) throw new Error('LanceDB dimensions must be a positive integer.');
  if (idColumn === embeddingColumn) throw new Error('LanceDB ID and vector columns must differ.');
  const rowBytes = dims * Float32Array.BYTES_PER_ELEMENT + BigInt64Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(rowBytes) || rowBytes > 16 * 1024 * 1024) throw new Error('LanceDB vector exceeds the bounded batch byte limit.');
  const capacity = Math.max(1, Math.min(Math.floor(batchSize || 1024), Math.floor(16 * 1024 * 1024 / rowBytes)));
  const item = new Float32(), idType = new Int64();
  const vectorType = new FixedSizeList(dims, new Field('item', item, false));
  const schema = new Schema([new Field(idColumn, idType, false), new Field(embeddingColumn, vectorType, false)]);
  const ids = new BigInt64Array(capacity), values = new Float32Array(capacity * dims);
  let count = 0, inFlight = false;
  return {
    schema, capacity,
    get size() { return count; },
    append(id, vector) {
      if (inFlight || count >= capacity) throw new Error('LanceDB batch must finish ingestion before append.');
      if (!Number.isSafeInteger(id) || id < 0) throw new Error('LanceDB document ID is invalid.');
      if (!vector || vector.length !== dims) throw new Error(`LanceDB vector dimension mismatch at document ${id}.`);
      for (let i = 0; i < dims; i++) if (!Number.isFinite(vector[i])) throw new Error(`LanceDB vector is non-finite at document ${id}.`);
      const decoded = dequantizeUint8ToFloat32(vector, quantization?.minVal, quantization?.maxVal, quantization?.levels);
      if (!decoded || !decoded.every(Number.isFinite)) throw new Error('LanceDB decoded vector is invalid.');
      if (normalize !== false) normalizeEmbeddingVectorInPlace(decoded);
      ids[count] = BigInt(id);
      values.set(decoded, count * dims);
      count++;
    },
    take() {
      if (inFlight) throw new Error('LanceDB batch is already being ingested.');
      if (!count) return null;
      inFlight = true;
      const length = count;
      const children = [makeData({ type: idType, data: ids.subarray(0, length), length, nullCount: 0 }),
        makeData({ type: vectorType, length, nullCount: 0,
          child: makeData({ type: item, data: values.subarray(0, length * dims), length: length * dims, nullCount: 0 }) })];
      const batch = new RecordBatch(schema, makeData({ type: new Struct(schema.fields), length, children, nullCount: 0 }));
      return new Table(schema, [batch]);
    },
    release() { inFlight = false; count = 0; },
    assertSchema(actual) {
      const id = actual?.fields?.find(field => field.name === idColumn);
      const vector = actual?.fields?.find(field => field.name === embeddingColumn);
      if (!id || !DataType.isInt(id.type) || id.type.bitWidth !== 64 || !id.type.isSigned
        || !vector || !DataType.isFixedSizeList(vector.type) || vector.type.listSize !== dims
        || !DataType.isFloat(vector.type.children?.[0]?.type)
        || vector.type.children[0].type.precision !== item.precision) {
        throw new Error('LanceDB physical schema does not match the configured ID/vector contract.');
      }
    }
  };
};
