<script lang="ts">
import type { ToolMeta } from '../tools'
export const toolMeta: ToolMeta = {
  path: '/nvs',
  name: 'NVS Editor',
  desc: 'Create and edit ESP-IDF NVS binary partitions and CSV files',
  icon: 'NVS',
  color: '#409EFF',
  order: 1,
}
</script>

<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import NvsEditor from '@yunsi/components/nvs-editor/NvsEditor.vue'

const isDark = inject<Ref<boolean>>('isDark', ref(false))
</script>

<template>
  <NvsEditor :is-dark="isDark" />
</template>
