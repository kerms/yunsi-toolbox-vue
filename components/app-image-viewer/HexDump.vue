<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{ data: Uint8Array; height?: number }>(), { height: 400 })

const BYTES = 16
const ROW_H = 20

const scrollTop = ref(0)

const totalRows = computed(() => Math.ceil(props.data.length / BYTES))
const firstRow  = computed(() => Math.floor(scrollTop.value / ROW_H))
const lastRow   = computed(() => Math.min(firstRow.value + Math.ceil(props.height / ROW_H) + 4, totalRows.value))

const rows = computed(() => {
  const out = []
  for (let r = firstRow.value; r < lastRow.value; r++) {
    const off = r * BYTES
    const slice = props.data.subarray(off, off + BYTES)
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0'))
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.')
    out.push({ off, hex, asc })
  }
  return out
})

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement).scrollTop
}
</script>

<template>
  <div class="hd-wrap" :style="{ height: height + 'px' }" @scroll="onScroll">
    <div :style="{ height: totalRows * ROW_H + 'px', position: 'relative' }">
      <div :style="{ transform: `translateY(${firstRow * ROW_H}px)` }">
        <div v-for="row in rows" :key="row.off" class="hd-row">
          <span class="hd-off">{{ row.off.toString(16).padStart(8, '0') }}</span>
          <span class="hd-hex">{{ row.hex.slice(0, 8).join(' ') }}&nbsp;&nbsp;{{ row.hex.slice(8).join(' ') }}</span>
          <span class="hd-asc">|{{ row.asc.join('') }}|</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hd-wrap {
  overflow-y: auto;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
}
.hd-row {
  display: flex;
  height: 20px;
  align-items: center;
  gap: 12px;
  padding: 0 8px;
  white-space: pre;
}
.hd-row:hover {
  background: var(--el-fill-color-light);
}
.hd-off {
  color: var(--el-text-color-placeholder);
  min-width: 6em;
  user-select: none;
}
.hd-hex {
  color: var(--el-text-color-primary);
}
.hd-asc {
  color: var(--el-text-color-secondary);
}
</style>
