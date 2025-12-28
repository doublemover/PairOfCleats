/// Generic container.
struct Box<T> {
    let value: T
}

extension Box where T: Equatable {
    func isEqual(_ other: T) -> Bool {
        return value == other
    }
}

protocol Greeter {
    func greet(name: String) -> String
}

class SwiftGreeter: Greeter {
    func greet(name: String) -> String {
        return "Hello \(name)"
    }
}
