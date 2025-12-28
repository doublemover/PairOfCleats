from dataclasses import dataclass
import attrs


@dataclass
class Point:
    """Simple point with distance helper."""
    x: int
    y: int = 0

    def distance(self, other: "Point") -> float:
        """Compute Euclidean distance."""
        def sq(v: float) -> float:
            return v * v

        return (sq(self.x - other.x) + sq(self.y - other.y)) ** 0.5


@attrs.define
class Person:
    """Attrs model sample."""
    name: str
    age: int = 0


def outer(flag: bool) -> int:
    """Exercise nested function names."""
    def inner(value: int) -> int:
        return value + 1

    return inner(4) if flag else 0


def update_state(state: dict, value: int) -> int:
    """Exercise dataflow metadata."""
    state["count"] = state.get("count", 0) + value
    if value < 0:
        raise ValueError("negative")
    return state["count"]


async def fetch_data(client) -> object:
    result = await client.fetch()
    return result
