/** Replace one published keyspace in a single LMDB write transaction.
 * Encoding deliberately remains inside the transaction: any late serialization
 * or put failure must abort the clear along with all replacement writes.
 */
export const replaceLmdbEntries = (db, entries, encode) => db.transactionSync(() => {
  db.clearSync();
  for (const [key, value] of entries) {
    if (value != null) db.putSync(key, encode(value));
  }
});
