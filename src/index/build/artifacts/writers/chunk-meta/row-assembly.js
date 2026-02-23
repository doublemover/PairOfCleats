import { writeJsonArrayFile } from '../../../../../shared/json-stream.js';
import { mergeSortedRuns } from '../../../../../shared/merge.js';
import { compareChunkMetaIdOnly, mapRows } from './shared.js';

/**
 * Build reusable hot/cold row sources for chunk_meta fanout writers.
 *
 * @param {object} input
 * @param {(start?:number,end?:number,trackStats?:boolean)=>IterableIterator<object>} input.chunkMetaIterator
 * @param {number} input.chunkMetaCount
 * @param {object|null} input.collected
 * @param {(entry:object)=>object} input.projectHotEntry
 * @param {(entry:object)=>object|null} input.projectColdEntry
 * @param {string} input.compatJsonPath
 * @param {boolean} input.shouldWriteCompatChunkMetaJson
 * @returns {object}
 */
export const createChunkMetaRowAssembly = ({
  chunkMetaIterator,
  chunkMetaCount,
  collected,
  projectHotEntry,
  projectColdEntry,
  compatJsonPath,
  shouldWriteCompatChunkMetaJson
}) => {
  const rows = collected?.rows || null;
  const runs = collected?.runs || null;
  const buckets = collected?.buckets || null;

  /**
   * Prefer previously spilled ordering sources before falling back to the
   * canonical iterator so repeated fanout consumers see deterministic rows.
   */
  const createItemsSource = () => {
    let items = chunkMetaIterator(0, chunkMetaCount, false);
    let itemsAsync = false;
    if (buckets) {
      itemsAsync = true;
      items = (async function* bucketIterator() {
        for (const bucket of buckets) {
          const result = bucket?.result;
          if (!result) continue;
          if (result.runs) {
            yield* mergeSortedRuns(result.runs, {
              compare: compareChunkMetaIdOnly,
              validateComparator: true
            });
          } else if (Array.isArray(result.rows)) {
            for (const row of result.rows) yield row;
          }
        }
      })();
    } else if (runs) {
      itemsAsync = true;
      items = mergeSortedRuns(runs, { compare: compareChunkMetaIdOnly, validateComparator: true });
    } else if (rows) {
      items = rows;
    }
    return { items, itemsAsync };
  };

  const createHotItemsSource = () => {
    const source = createItemsSource();
    if (buckets || runs || rows) return source;
    return {
      ...source,
      items: mapRows(source.items, (entry) => projectHotEntry(entry))
    };
  };

  const createColdItemsSource = () => {
    const source = createItemsSource();
    return {
      ...source,
      items: mapRows(source.items, (entry) => projectColdEntry(entry))
    };
  };

  let materializedHotRowsCache = null;
  let materializedHotRowsPromise = null;
  const materializeHotRows = async () => {
    if (Array.isArray(materializedHotRowsCache)) return materializedHotRowsCache;
    if (materializedHotRowsPromise) return materializedHotRowsPromise;
    materializedHotRowsPromise = (async () => {
      const { items, itemsAsync } = createHotItemsSource();
      if (itemsAsync) {
        const materialized = [];
        for await (const item of items) {
          materialized.push(item);
        }
        materializedHotRowsCache = materialized;
        return materialized;
      }
      if (Array.isArray(items)) {
        materializedHotRowsCache = items;
        return items;
      }
      const materialized = Array.from(items || []);
      materializedHotRowsCache = materialized;
      return materialized;
    })().finally(() => {
      materializedHotRowsPromise = null;
    });
    return materializedHotRowsPromise;
  };

  const writeCompatChunkMetaJson = async (hotRows = null) => {
    if (!shouldWriteCompatChunkMetaJson) return;
    if (Array.isArray(hotRows)) {
      await writeJsonArrayFile(compatJsonPath, hotRows, { atomic: true });
      return;
    }
    const { items, itemsAsync } = createHotItemsSource();
    if (itemsAsync) {
      const materialized = await materializeHotRows();
      await writeJsonArrayFile(compatJsonPath, materialized, { atomic: true });
      return;
    }
    await writeJsonArrayFile(compatJsonPath, items, { atomic: true });
  };

  let collectedCleaned = false;
  const cleanupCollected = async () => {
    if (collectedCleaned) return;
    collectedCleaned = true;
    if (collected?.cleanup) await collected.cleanup();
  };

  return {
    createHotItemsSource,
    createColdItemsSource,
    materializeHotRows,
    writeCompatChunkMetaJson,
    cleanupCollected,
    buckets,
    bucketSize: collected?.bucketSize || null
  };
};
