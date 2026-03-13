/** Widget renderer contract */
export interface Renderer {
  render(): string;
}

export type WidgetOptions = {
  size: number;
  theme?: string;
};

export class BaseWidget {
  constructor(public id: string) {}
}

export class Widget extends BaseWidget implements Renderer {
  /** Create a widget */
  constructor(private readonly name: string, opts: WidgetOptions) {
    super(name);
  }

  render(): string {
    return this.name;
  }

  static from(name: string): Widget {
    return new Widget(name, { size: 1 });
  }
}

export function makeWidget(name: string): Widget {
  return new Widget(name, { size: 2 });
}
