/**
 * @param {string} name
 * @param {object} opts
 * @returns {Widget}
 */
export function makeWidget(name, opts = {}) {
  const widget = new Widget(name, opts);
  return widget;
}

export class BaseWidget {
  constructor(name) {
    this.name = name;
  }
}

export class Widget extends BaseWidget {
  constructor(name, opts = {}) {
    super(name);
    this.opts = opts;
    this.secret = 1;
    this.items = [];
  }

  /**
   * @param {number} id
   * @returns {object}
   */
  async load(id, { limit = 3 } = {}) {
    const data = await fetchData(id);
    this.items.push(data);
    if (!data) {
      throw new Error('Missing');
    }
    return data;
  }

  *iter() {
    yield *this.items;
  }

  update(delta) {
    this.count += delta;
    return this.count;
  }
}
