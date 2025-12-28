package demo;

import java.util.ArrayList;
import java.util.List;

public class Box<T> {
  private final List<T> items = new ArrayList<>();

  public Box() {}

  public void add(T item) {
    items.add(item);
  }

  public int size() {
    return items.size();
  }
}

interface Greeter {
  String greet(String name);
}
