def helper(value: int) -> int:
    """Return value plus one."""
    return value + 1


class Greeter:
    """Greeter docstring."""

    def __init__(self, name):
        self.name = name

    @staticmethod
    def message(name: str) -> str:
        """Compose greeting."""
        return f"hello {name}"


def add(a, b=1):
    return a + b
