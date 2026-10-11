export default ({ started }) => {
  Atomics.store(new Int32Array(started), 0, 1);
  return new Promise(() => {});
};
