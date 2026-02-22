<script setup lang="ts">
import { useRouter } from 'vue-router'
import { tools } from '../tools'

const router = useRouter()
</script>

<template>
  <div class="home-page">
    <div class="home-intro">
      <h1 class="home-title">ESP32 Developer Tools</h1>
      <p class="home-subtitle">Select a tool to get started</p>
    </div>
    <div class="tools-grid">
      <div
        v-for="tool in tools"
        :key="tool.meta.path"
        class="tool-card"
        @click="router.push(tool.meta.path)"
      >
        <div class="tool-icon" :style="{ background: tool.meta.color }">
          {{ tool.meta.icon }}
        </div>
        <div class="tool-info">
          <h3>{{ tool.meta.name }}</h3>
          <p>{{ tool.meta.desc }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
