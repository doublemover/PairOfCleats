import Foundation

/// Greeter for Swift samples.
class Greeter {
  /// Compose greeting.
  @available(iOS 13.0, *)
  func sayHello(name: String) -> String {
    return "hello \(name)"
  }
}

struct Counter {
  var value: Int

  init(start: Int) {
    self.value = start
  }
}
