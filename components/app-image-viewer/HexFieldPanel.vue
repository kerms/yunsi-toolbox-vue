<script setup lang="ts">
import { ref } from 'vue'
import type { FieldGroup } from '../../lib/app-image/ranges'

const props = defineProps<{
  groups: FieldGroup[]
  activeRange: { start: number; end: number } | null
}>()

const emit = defineEmits<{
  select: [range: { start: number; end: number }]
}>()

const collapsed = ref<Set<number>>(new Set())

function toggle(i: number) {
  if (collapsed.value.has(i)) collapsed.value.delete(i)
  else collapsed.value.add(i)
  // trigger reactivity
  collapsed.value = new Set(collapsed.value)
}

function isGroupActive(g: FieldGroup): boolean {
  if (!props.activeRange) return false
  return props.activeRange.start >= g.start && props.activeRange.end <= g.end
}

function isFieldActive(start: number, end: number): boolean {
  if (!props.activeRange) return false
  return props.activeRange.start === start && props.activeRange.end === end
}

function selectGroup(g: FieldGroup) {
  emit('select', { start: g.start, end: g.end })
}

function selectField(start: number, end: number) {
  emit('select', { start, end })
}

function fmtRange(start: number, end: number): string {
  if (end - start === 1) return start.toString(16).padStart(8, '0')
  return `${start.toString(16).padStart(8, '0')}–${(end - 1).toString(16).padStart(8, '0')}`
}

</script>

<template>
  <div class="hfp-wrap">
    <!-- Group list -->
    <div class="hfp-groups">
      <div v-for="(g, gi) in groups" :key="gi" class="hfp-group">
        <!-- Group header row -->
        <div
          class="hfp-group-hdr"
          :class="{ 'hfp-row-active': isGroupActive(g) && g.fields.length === 0 }"
          @click="g.fields.length ? toggle(gi) : selectGroup(g)"
        >
          <span class="hfp-arrow" v-if="g.fields.length">{{ collapsed.has(gi) ? '▶' : '▼' }}</span>
          <span class="hfp-arrow" v-else>◇</span>
          <span class="hfp-group-label">{{ g.label }}</span>
          <span class="hfp-mono hfp-range">{{ fmtRange(g.start, g.end) }}</span>
        </div>

        <!-- Field rows -->
        <template v-if="!collapsed.has(gi) && g.fields.length">
          <div
            v-for="(f, fi) in g.fields"
            :key="fi"
            class="hfp-field-row"
            :class="{ 'hfp-row-active': isFieldActive(f.start, f.end) }"
            @click="selectField(f.start, f.end)"
          >
            <span class="hfp-field-label">{{ f.label }}</span>
            <span class="hfp-mono hfp-range">{{ fmtRange(f.start, f.end) }}</span>
            <span class="hfp-mono hfp-value">{{ f.value }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hfp-wrap {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
  overflow: hidden;
  font-size: 12px;
}

.hfp-groups {
  max-height: 180px;
  overflow-y: auto;
}

.hfp-group-hdr {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  cursor: pointer;
  user-select: none;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
  color: var(--el-text-color-regular);
}
.hfp-group-hdr:hover {
  background: var(--el-fill-color);
}

.hfp-field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 8px 1px 22px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.hfp-field-row:hover {
  background: var(--el-fill-color-light);
}

.hfp-row-active,
.hfp-row-active:hover {
  background: var(--el-color-primary-light-8) !important;
  color: var(--el-color-primary);
}

.hfp-arrow {
  width: 12px;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.hfp-group-label,
.hfp-field-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hfp-mono {
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  flex-shrink: 0;
}

.hfp-range {
  color: var(--el-text-color-placeholder);
  min-width: 9em;
  text-align: right;
}

.hfp-value {
  color: var(--el-text-color-secondary);
  min-width: 8em;
  max-width: 18em;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
