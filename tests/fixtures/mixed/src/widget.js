export class Widget {
  constructor(id) {
    this.id = id;
  }

  render() {
    return `<div>${this.id}</div>`;
  }
}

export const createWidget = (id) => new Widget(id);
