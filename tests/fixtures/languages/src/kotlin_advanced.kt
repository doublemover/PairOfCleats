package demo

import kotlin.math.abs

/** Simple generic box */
data class Box<T>(val value: T)

sealed class Result {
  data class Ok(val value: String) : Result()
  data class Err(val message: String) : Result()
}

class Widget(private val name: String) {
  fun render(): String {
    return name
  }
}

fun makeWidget(name: String): Widget = Widget(name)
