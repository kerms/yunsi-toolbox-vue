<script lang="ts">
import type { ToolMeta } from '../tools'
export const toolMeta: ToolMeta = {
  path: '/esp-flasher',
  name: 'ESP Flasher',
  desc: 'Flash firmware over USB via Web Serial — Chrome/Edge desktop',
  icon: '⚡',
  color: '#F56C6C',
  order: 4,
}
</script>

<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import EspFlasher from '@yunsi/components/esp-flasher/EspFlasher.vue'

const isDark = inject<Ref<boolean>>('isDark', ref(false))
const imageOptions: { value: string; link: string; target: string }[] = []
</script>

<template>
  <EspFlasher :image-options="imageOptions" :is-dark="isDark" />
</template>
