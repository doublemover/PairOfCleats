using System;
using System.Collections.Generic;

namespace Demo.App {
  /// Widget renderer
  public interface IRenderer {
    void Render();
  }

  /// Widget class
  public class Widget : IRenderer {
    public string Name { get; }

    public Widget(string name) {
      Name = name;
    }

    public void Render() {
      Console.WriteLine(Name);
    }

    public static Widget Create(string name) {
      return new Widget(name);
    }
  }
}
