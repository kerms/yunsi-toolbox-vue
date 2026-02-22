<script setup lang="ts">
import { ref, computed, provide, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const isDark = ref(false)
provide('isDark', isDark)

watch(isDark, (val) => {
  document.documentElement.classList.toggle('dark', val)
}, { immediate: true })

const isHome = computed(() => route.path === '/')
</script>

<template>
  <div :class="{ dark: isDark }" class="app-shell">
    <header class="app-header">
      <div class="app-header-inner">
        <div class="app-brand" @click="router.push('/')">
          <span class="app-brand-name">Yunsi Toolbox</span>
          <span class="app-brand-sub">ESP32 Developer Tools</span>
        </div>
        <div class="app-header-actions">
          <el-button v-if="!isHome" text size="small" @click="router.push('/')">← Home</el-button>
          <span class="dark-label">Dark</span>
          <el-switch v-model="isDark" />
        </div>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>
