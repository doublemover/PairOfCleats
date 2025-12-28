#include <string>

template <typename T>
T addValues(T a, T b) {
    return a + b;
}

class Counter {
public:
    explicit Counter(int start) : value(start) {}
    int next() { return ++value; }

private:
    int value;
};
