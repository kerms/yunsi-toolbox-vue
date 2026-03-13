<template>
  <el-dialog
    :model-value="props.visible"
    title="编辑二进制数据"
    width="min(640px, 92vw)"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:visible', $event)"
  >
    <!-- toolbar -->
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <span class="text-sm text-gray-500">{{ byteCount }} 字节</span>
      <el-button-group class="ml-2">
        <el-button size="small" :type="activeTab === 'edit' ? 'primary' : ''" @click="activeTab = 'edit'">编辑</el-button>
        <el-button size="small" :type="activeTab === 'preview' ? 'primary' : ''" @click="activeTab = 'preview'">预览</el-button>
      </el-button-group>
      <span class="flex-1" />
      <el-button size="small" :icon="Upload" @click="importInput?.click()">导入文件</el-button>
      <el-button size="small" :icon="Download" @click="exportFile">导出文件</el-button>
    </div>

    <!-- edit tab: offset + textarea -->
    <div v-if="activeTab === 'edit'" class="hex-editor-wrapper">
      <div ref="offsetPanel" class="hex-offset-panel" :style="{ height: editorHeight + 'px' }" aria-hidden="true">
        <div v-for="(_, i) in lineCount" :key="i" class="hex-offset-row">
          {{ (i * 16).toString(16).padStart(8, '0') }}
        </div>
      </div>
      <textarea
        v-model="hexText"
        class="blob-hex-textarea"
        :style="{ height: editorHeight + 'px', overflowY: 'auto' }"
        wrap="off"
        spellcheck="false"
        placeholder="输入十六进制字节 (如: de ad be ef 01 02)&#10;支持空格、逗号、0x前缀分隔"
        @input="onHexInput"
        @scroll="syncOffsetScroll"
      />
    </div>
    <!-- preview tab: HexDump -->
    <HexDump v-else :data="currentBytes" :height="editorHeight" />

    <div v-if="parseError" class="text-red-500 text-xs mt-1">{{ parseError }}</div>

    <input ref="importInput" type="file" accept="*/*" style="display:none" @change="onImport" />

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :disabled="!!parseError" @click="confirm">确认</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, withDefaults } from 'vue';
import { Upload, Download } from '@element-plus/icons-vue';
import HexDump from '../app-image-viewer/HexDump.vue';
import { parseHexString } from '../../lib/nvs';

const props = withDefaults(defineProps<{
  modelValue: Uint8Array;
  visible: boolean;
  entryKey?: string;
}>(), { entryKey: 'blob' });

const emit = defineEmits<{
  'update:modelValue': [value: Uint8Array];
  'update:visible': [value: boolean];
}>();

const importInput = ref<HTMLInputElement>();
const offsetPanel = ref<HTMLDivElement>();
const hexText = ref('');
const parseError = ref<string | null>(null);
const activeTab = ref<'edit' | 'preview'>('edit');

// ── Formatting ────────────────────────────────────────────────────────────────

function formatHex(data: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < data.length; i += 16) {
    const chunk = data.subarray(i, i + 16);
    lines.push(Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' '));
  }
  return lines.join('\n');
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseHex(text: string): Uint8Array | null {
  const result = parseHexString(text);
  if ('error' in result) {
    parseError.value = result.error;
    return null;
  }
  parseError.value = null;
  return result.bytes;
}

const currentBytes = computed<Uint8Array>(() => parseHex(hexText.value) ?? new Uint8Array(0));
const byteCount = computed(() => currentBytes.value.length);

/** Number of non-empty lines in the textarea (= number of 16-byte offset rows to show) */
const lineCount = computed(() => {
  const lines = hexText.value.split('\n');
  const count = (lines.length > 0 && lines[lines.length - 1].trim() === '')
    ? lines.length - 1
    : lines.length;
  return Math.max(1, count);
});

/** Editor/preview height in px — uses max of textarea line count and hex-dump row count */
const editorHeight = computed(() => {
  const textRows = lineCount.value + 1;
  const byteRows = Math.ceil(currentBytes.value.length / 16) + 1;
  return Math.min(20, Math.max(textRows, byteRows)) * 20 + 16;
});

// ── Sync with prop ────────────────────────────────────────────────────────────

watch(() => props.visible, (v) => {
  if (v) {
    hexText.value = formatHex(props.modelValue as Uint8Array);
    parseError.value = null;
    activeTab.value = 'edit';
  }
});

// ── Handlers ──────────────────────────────────────────────────────────────────

function onHexInput() {
  parseHex(hexText.value); // side-effect: sets parseError
}

function syncOffsetScroll(e: Event) {
  if (offsetPanel.value)
    offsetPanel.value.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
}

function confirm() {
  const bytes = parseHex(hexText.value);
  if (bytes === null) return;
  emit('update:modelValue', bytes);
  emit('update:visible', false);
}

async function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  hexText.value = formatHex(bytes);
  parseError.value = null;
}

function exportFile() {
  const bytes = parseHex(hexText.value);
  if (!bytes) return;
  const url = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]));
  const a = document.createElement('a');
  a.href = url;
  a.download = props.entryKey + '.bin';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
</script>

<style scoped>
.hex-editor-wrapper {
  display: flex;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}
.hex-editor-wrapper:focus-within {
  border-color: var(--el-color-primary);
}
.hex-offset-panel {
  flex-shrink: 0;
  width: 80px;
  overflow: hidden;
  background: var(--el-fill-color-light);
  border-right: 1px solid var(--el-border-color-lighter);
  user-select: none;
  -webkit-user-select: none;
  padding: 8px 6px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  box-sizing: border-box;
}
.hex-offset-row {
  white-space: nowrap;
}
.blob-hex-textarea {
  flex: 1;
  min-width: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 10px;
  border: none;
  border-radius: 0;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
  outline: none;
  box-sizing: border-box;
  width: 100%;
  overflow-x: auto;
}
.blob-hex-textarea:focus {
  outline: none;
}
</style>
