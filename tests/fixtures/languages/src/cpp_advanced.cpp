#include <string>

template <typename T>
T addValues(T a, T b) {
    return a + b;
}

int useAdd() {
    return addValues(1, 2);
}

class Counter {
public:
    explicit Counter(int start) : value(start) {}
    int next() { return ++value; }

private:
    int value;
};
