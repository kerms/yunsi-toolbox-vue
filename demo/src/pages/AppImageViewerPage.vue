<script lang="ts">
import type { ToolMeta } from '../tools'
export const toolMeta: ToolMeta = {
  path: '/app-image',
  name: 'App Image Viewer',
  desc: 'Inspect ESP32 app image headers, segments and app description',
  icon: 'IMG',
  color: '#E6A23C',
  order: 3,
}
</script>

<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import AppImageViewer from '@yunsi/components/app-image-viewer/AppImageViewer.vue'

const isDark = inject<Ref<boolean>>('isDark', ref(false))
</script>

<template>
  <AppImageViewer :is-dark="isDark" />
</template>
