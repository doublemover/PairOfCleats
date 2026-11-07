/** Request-owned minimum heap. The comparator must include any required stable tie break. */
export class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() { return this.items.length; }

  push(value) {
    const items = this.items;
    let index = items.length;
    items.push(value);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.compare(items[parent], value) <= 0) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = value;
  }

  pop() {
    const items = this.items;
    if (!items.length) return undefined;
    const first = items[0];
    const last = items.pop();
    if (!items.length) return first;
    let index = 0;
    while ((index * 2) + 1 < items.length) {
      let child = (index * 2) + 1;
      if (child + 1 < items.length && this.compare(items[child + 1], items[child]) < 0) child += 1;
      if (this.compare(last, items[child]) <= 0) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
}
