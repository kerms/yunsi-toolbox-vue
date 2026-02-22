<script lang="ts">
import type { ToolMeta } from '../tools'
export const toolMeta: ToolMeta = {
  path: '/partition-table',
  name: 'Partition Table',
  desc: 'Edit ESP32 flash partition tables — import/export binary and CSV',
  icon: 'PT',
  color: '#67C23A',
  order: 2,
}
</script>

<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import PartitionTableEditor from '@yunsi/components/partition-table-editor/PartitionTableEditor.vue'

const isDark = inject<Ref<boolean>>('isDark', ref(false))
</script>

<template>
  <PartitionTableEditor :is-dark="isDark" />
</template>
