<template>
  <main class="app-shell">
    <h1>{{ title }}</h1>
    <button @click="increment">Count: {{ count }}</button>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const title = 'USR Minimum Slice';
const count = ref(0);

function increment() {
  count.value += 1;
}
</script>

<style scoped>
.app-shell {
  display: grid;
  gap: 0.75rem;
}
</style>
