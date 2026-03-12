<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Upload, View, CopyDocument, Delete, Plus } from '@element-plus/icons-vue';
import {
  type NvsPartition, type NvsEntry, type NvsEncoding, type NvsFlashStats,
  NvsType, NvsVersion,
  ENCODING_TO_TYPE, TYPE_TO_ENCODING,
  isPrimitiveType,
  createEmptyPartition, addEntry, removeEntry, updateEntry,
  duplicateEntry, mergePartitions, calculateFlashStats,
  validatePartition, generateEntryId, normalizePartition, reconcileBlobTypes,
  checkBlobCompatibility,
  parseBinary, serializeBinary, parseCsv, serializeCsv,
  MAX_KEY_LENGTH,
} from '../../lib/nvs';

const props = defineProps<{
  isDark?: boolean;
}>();

// ── Core state ─────────────────────────────────────────────────────

const partition = ref<NvsPartition>(createEmptyPartition());
const targetSize = ref(0x4000);

// ── UI state ───────────────────────────────────────────────────────

const namespaceFilter = ref('');
const keySearch = ref('');
const mergeMode = ref<'overwrite' | 'skip'>('overwrite');
const showHex = ref(false);

// Inline new row state
const newRow = ref({ namespace: '', key: '', encoding: 'u8' as NvsEncoding, value: '' });

// Value viewer dialog
const showValueDialog = ref(false);
const valueDialogEntry = ref<NvsEntry | null>(null);

// Column sort state
const sortProp = ref<'namespace' | 'key' | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

// File input refs
const openBinInput = ref<HTMLInputElement>();
const mergeBinInput = ref<HTMLInputElement>();
const openCsvInput = ref<HTMLInputElement>();
const mergeCsvInput = ref<HTMLInputElement>();
const openJsonInput = ref<HTMLInputElement>();
const mergeJsonInput = ref<HTMLInputElement>();
const blobUploadInput = ref<HTMLInputElement>();
const blobUploadEntryId = ref('');

// ── Persistence ────────────────────────────────────────────────────

const STORAGE_KEY = 'nvs-editor-v1';
const STORAGE_SIZE_KEY = 'nvs-editor-size-v1';

function partitionToJson(p: NvsPartition): string {
  return JSON.stringify(p, (_, v) => {
    if (v instanceof Uint8Array) return { __t: 'u8a', d: Array.from(v) };
    if (typeof v === 'bigint') return { __t: 'bi', d: v.toString() };
    return v;
  });
}

function partitionFromJson(s: string): NvsPartition {
  return JSON.parse(s, (_, v) => {
    if (v && typeof v === 'object' && v.__t === 'u8a') return new Uint8Array(v.d);
    if (v && typeof v === 'object' && v.__t === 'bi') return BigInt(v.d);
    return v;
  });
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;
watch(partition, (val) => {
  if (_persistTimer !== null) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, partitionToJson(val)); } catch {}
    _persistTimer = null;
  }, 500);
}, { deep: true });

watch(targetSize, (val) => {
  try { localStorage.setItem(STORAGE_SIZE_KEY, String(val)); } catch {}
});

onMounted(() => {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) partition.value = normalizePartition(partitionFromJson(s)).partition;
  } catch {}
  try {
    const sz = localStorage.getItem(STORAGE_SIZE_KEY);
    if (sz) {
      const parsed = parseInt(sz, 10);
      if (!Number.isNaN(parsed) && parsed > 0) targetSize.value = parsed;
    }
  } catch {}
});

// ── Computed ───────────────────────────────────────────────────────

const flashStats = computed<NvsFlashStats>(() =>
  calculateFlashStats(partition.value, targetSize.value),
);

const errors = computed(() => validatePartition(partition.value));

const filteredEntries = computed(() => {
  let entries = partition.value.entries;
  if (namespaceFilter.value) entries = entries.filter(e => e.namespace === namespaceFilter.value);
  if (keySearch.value) entries = entries.filter(e => e.key.includes(keySearch.value));
  if (sortProp.value && sortOrder.value) {
    const col = sortProp.value;
    const dir = sortOrder.value === 'ascending' ? 1 : -1;
    entries = [...entries].sort((a, b) => dir * a[col].localeCompare(b[col]));
  }
  return entries;
});

const progressColor = computed(() => {
  const pct = flashStats.value.usagePercent;
  if (pct >= 85) return '#F56C6C';
  if (pct >= 60) return '#E6A23C';
  return '#67C23A';
});

const targetSizePages = computed({
  get: () => Math.floor(targetSize.value / 4096),
  set: (pages: number) => {
    targetSize.value = Math.max(3, pages) * 4096;
  },
});

const sizeInPages = ref(true);

const targetSizeKB = computed({
  get: () => targetSizePages.value * 4,
  set: (kb: number) => { targetSizePages.value = Math.max(3, Math.round(kb / 4)); },
});

const encodingOptions = computed<NvsEncoding[]>(() => {
  const base: NvsEncoding[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'string'];
  return partition.value.version === NvsVersion.V2 ? [...base, 'binary'] : [...base, 'blob'];
});

// ── Helpers ────────────────────────────────────────────────────────

function handleVersionChange(version: NvsVersion) {
  const reconciledEntries = reconcileBlobTypes(partition.value.entries, version);
  partition.value = { ...partition.value, version, entries: reconciledEntries };
  if (newRow.value.encoding === 'blob' || newRow.value.encoding === 'binary')
    newRow.value.encoding = version === NvsVersion.V2 ? 'binary' : 'blob';
  const blobWarnings = checkBlobCompatibility(reconciledEntries, version);
  if (blobWarnings.length > 0) {
    showStatus(`${blobWarnings.length} 个 blob 超出 ${version === NvsVersion.V1 ? 'V1' : 'V2'} 大小限制，请查看验证面板`, 'info');
  }
}

function showStatus(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  ElMessage({ message: msg, type, duration: 4000, showClose: true });
}

function getEncodingForType(type: NvsType): NvsEncoding {
  return TYPE_TO_ENCODING[type] ?? 'u8';
}

/** Check if string contains non-printable bytes (< 0x20 or 0x7F) */
function hasNonPrintable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7F) return true;
  }
  return false;
}

/** Display namespace: hexdump format when showHex is on */
function displayNamespace(s: string): string {
  if (showHex.value) {
    return Array.from(s, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
  }
  return s;
}

/** Format raw string for display — non-printable bytes become \xHH, backslash becomes \\\\ */
function formatEscapes(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x5C) out += '\\\\';
    else if (c < 0x20 || c === 0x7F) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += ch;
  }
  return out;
}

/** Parse C-style escape sequences back to raw string.
 *  \0 and \x00 are intentionally excluded: NVS keys are null-terminated in binary,
 *  so a NUL byte would silently truncate the key on round-trip. */
function parseEscapes(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|[nrt\\])/g, (_, esc: string) => {
    if (esc[0] === 'x') {
      const code = parseInt(esc.slice(1), 16);
      return code === 0 ? '\\x00' : String.fromCharCode(code);
    }
    if (esc === 'n') return '\n';
    if (esc === 'r') return '\r';
    if (esc === 't') return '\t';
    if (esc === '\\') return '\\';
    return '\\' + esc;
  });
}

/** Preview of blob value for table cell (up to 8 bytes) */
function formatValue(entry: NvsEntry): string {
  if (entry.value instanceof Uint8Array) {
    const preview = entry.value.subarray(0, 8);
    const hex = Array.from(preview).map(b => b.toString(16).padStart(2, '0')).join(' ');
    if (entry.value.length > 8) return `${hex} …(${entry.value.length}B)`;
    return hex;
  }
  return String(entry.value);
}

/** Full value text for the viewer dialog */
function fullValueText(entry: NvsEntry): string {
  if (entry.value instanceof Uint8Array) {
    const lines: string[] = [];
    for (let i = 0; i < entry.value.length; i += 16) {
      const chunk = entry.value.subarray(i, i + 16);
      const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const asc = Array.from(chunk).map(b => (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.').join('');
      lines.push(`${i.toString(16).padStart(4, '0')}: ${hex.padEnd(47)}  ${asc}`);
    }
    return lines.join('\n');
  }
  return String(entry.value);
}


function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function parseValueInput(encoding: NvsEncoding, raw: string): number | bigint | string | Uint8Array {
  switch (encoding) {
    case 'u8': case 'u16': case 'u32':
    case 'i8': case 'i16': case 'i32': {
      const str = raw.trim();
      if (str.startsWith('0x') || str.startsWith('0X')) {
        if (!/^-?0[xX][0-9a-fA-F]+$/.test(str)) throw new Error(`无效的整数值: "${str}"`);
        return parseInt(str, 16);
      }
      if (!/^-?\d+$/.test(str)) throw new Error(`无效的整数值: "${str}"`);
      return parseInt(str, 10);
    }
    case 'u64': case 'i64': {
      const str64 = raw.trim();
      if (str64.startsWith('-0x') || str64.startsWith('-0X')) {
        if (!/^-0[xX][0-9a-fA-F]+$/.test(str64)) throw new Error(`无效的整数值: "${str64}"`);
        return -BigInt(str64.slice(1));
      }
      try { return BigInt(str64); } catch { throw new Error(`无效的整数值: "${str64}"`); }
    }
    case 'string':
      return parseEscapes(raw);
    case 'blob':
    case 'binary': {
      const hex = raw.replace(/\s/g, '');
      if (hex.length === 0) return new Uint8Array(0);
      if (hex.length % 2 !== 0) throw new Error('十六进制字符串长度必须为偶数');
      if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('十六进制字符串包含无效字符');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      return bytes;
    }
    default:
      return raw;
  }
}

// ── Actions: CRUD ──────────────────────────────────────────────────

function autoIncrementKey(key: string): string {
  const m = key.match(/^(.*?)(\d+)$/);
  if (m) return m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0');
  return key + '_1';
}

function handleInlineAddEntry() {
  const rawKey = parseEscapes(newRow.value.key);
  if (!newRow.value.namespace || !rawKey) {
    showStatus('命名空间和键名不能为空', 'error');
    return;
  }
  const type = ENCODING_TO_TYPE[newRow.value.encoding];
  let value: ReturnType<typeof parseValueInput>;
  try {
    value = parseValueInput(newRow.value.encoding, newRow.value.value);
  } catch (e: any) {
    showStatus(e.message ?? '值格式错误', 'error');
    return;
  }
  partition.value = addEntry(partition.value, {
    namespace: newRow.value.namespace,
    key: rawKey,
    type,
    value,
  });
  newRow.value.key = autoIncrementKey(newRow.value.key);
  newRow.value.value = '';
  showStatus('已添加', 'success');
}

function handleDeleteEntry(entryId: string) {
  partition.value = removeEntry(partition.value, entryId);
}

function handleDuplicateEntry(entryId: string) {
  partition.value = duplicateEntry(partition.value, entryId);
  showStatus('已复制记录', 'success');
}

function handleClear() {
  partition.value = createEmptyPartition(partition.value.version);
  showStatus('已清空所有记录', 'info');
}

// ── Actions: Inline edit ───────────────────────────────────────────

function handleUpdateKey(entryId: string, newKey: string) {
  partition.value = updateEntry(partition.value, entryId, { key: newKey });
}

function handleUpdateNamespace(entryId: string, ns: string) {
  partition.value = updateEntry(partition.value, entryId, { namespace: ns });
}

function handleUpdateEncoding(entryId: string, encoding: NvsEncoding) {
  const type = ENCODING_TO_TYPE[encoding];
  let value: NvsEntry['value'];
  if (isPrimitiveType(type)) value = 0;
  else if (type === NvsType.SZ) value = '';
  else value = new Uint8Array(0);
  partition.value = updateEntry(partition.value, entryId, { type, value });
}

function handleUpdateValue(entryId: string, encoding: NvsEncoding, raw: string) {
  let value: ReturnType<typeof parseValueInput>;
  try {
    value = parseValueInput(encoding, raw);
  } catch (e: any) {
    showStatus(e.message ?? '值格式错误', 'error');
    return;
  }
  partition.value = updateEntry(partition.value, entryId, { value });
}

// ── Actions: Sort ──────────────────────────────────────────────────

function handleSortChange({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) {
  sortProp.value = prop as 'namespace' | 'key' | null;
  sortOrder.value = order;
}

// ── Actions: File I/O ──────────────────────────────────────────────

async function onOpenBinChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    partition.value = parseBinary(data);
    targetSize.value = data.byteLength;
    showStatus(`已加载 ${file.name} (${data.byteLength} 字节)`, 'success');
  } catch (e: any) {
    showStatus(`加载失败: ${e.message}`, 'error');
  }
}

function handleExportBinary() {
  try {
    const errs = validatePartition(partition.value);
    if (errs.length > 0) { showStatus(`验证错误: ${errs[0]}`, 'error'); return; }
    const data = serializeBinary(partition.value, targetSize.value);
    downloadBlob(new Blob([data as Uint8Array<ArrayBuffer>]), 'nvs.bin');
    showStatus('已导出 nvs.bin', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
  }
}

async function onMergeBinChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const incoming = parseBinary(new Uint8Array(buffer));
    partition.value = mergePartitions(partition.value, incoming, mergeMode.value);
    showStatus(`已合并 ${file.name} (${incoming.entries.length} 条记录)`, 'success');
    const blobWarnings = checkBlobCompatibility(partition.value.entries, partition.value.version);
    if (blobWarnings.length > 0) {
      showStatus(`${blobWarnings.length} 个 blob 超出大小限制，请查看验证面板`, 'info');
    }
  } catch (e: any) {
    showStatus(`合并失败: ${e.message}`, 'error');
  }
}

async function onOpenCsvChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    const text = await file.text();
    partition.value = parseCsv(text);
    showStatus(`已加载 ${file.name}`, 'success');
  } catch (e: any) {
    showStatus(`加载失败: ${e.message}`, 'error');
  }
}

function handleExportCsv() {
  try {
    const text = serializeCsv(partition.value);
    downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), 'nvs.csv');
    showStatus('已导出 nvs.csv', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
  }
}

async function onMergeCsvChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = parseCsv(text);
    partition.value = mergePartitions(partition.value, incoming, mergeMode.value);
    showStatus(`已合并 ${file.name} (${incoming.entries.length} 条记录)`, 'success');
    const blobWarnings = checkBlobCompatibility(partition.value.entries, partition.value.version);
    if (blobWarnings.length > 0) {
      showStatus(`${blobWarnings.length} 个 blob 超出大小限制，请查看验证面板`, 'info');
    }
  } catch (e: any) {
    showStatus(`合并失败: ${e.message}`, 'error');
  }
}

async function onOpenJsonChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const raw = partitionFromJson(text);
    const { partition: incoming, dropped, clamped } = normalizePartition(raw);
    partition.value = incoming;
    const parts: string[] = [`已加载 ${file.name}`];
    if (dropped > 0 || clamped > 0) {
      const details: string[] = [];
      if (dropped > 0) details.push(`丢弃 ${dropped} 条无效记录`);
      if (clamped > 0) details.push(`${clamped} 条值被截断`);
      parts.push(`（${incoming.entries.length} 条，${details.join('，')}）`);
    }
    showStatus(parts.join(''), (dropped > 0 || clamped > 0) ? 'info' : 'success');
  } catch (e: any) {
    showStatus(`加载失败: ${e.message}`, 'error');
  }
}

function handleExportJson() {
  try {
    const text = partitionToJson(partition.value);
    downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), 'nvs.json');
    showStatus('已导出 nvs.json', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
  }
}

async function onMergeJsonChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const raw = partitionFromJson(text);
    const { partition: incoming, dropped, clamped } = normalizePartition(raw);
    partition.value = mergePartitions(partition.value, incoming, mergeMode.value);
    const parts: string[] = [`已合并 ${file.name}（${incoming.entries.length} 条记录`];
    if (dropped > 0 || clamped > 0) {
      const details: string[] = [];
      if (dropped > 0) details.push(`丢弃 ${dropped} 条无效记录`);
      if (clamped > 0) details.push(`${clamped} 条值被截断`);
      parts.push(`，${details.join('，')}`);
    }
    parts.push('）');
    showStatus(parts.join(''), (dropped > 0 || clamped > 0) ? 'info' : 'success');
    const blobWarnings = checkBlobCompatibility(partition.value.entries, partition.value.version);
    if (blobWarnings.length > 0) {
      showStatus(`${blobWarnings.length} 个 blob 超出大小限制，请查看验证面板`, 'info');
    }
  } catch (e: any) {
    showStatus(`合并失败: ${e.message}`, 'error');
  }
}


async function onBlobUploadChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file || !blobUploadEntryId.value) return;
  try {
    const entry = partition.value.entries.find(en => en.id === blobUploadEntryId.value);
    if (!entry) {
      showStatus('记录不存在', 'error');
      return;
    }
    if (isPrimitiveType(entry.type)) {
      const text = await file.text();
      const encoding = getEncodingForType(entry.type);
      const value = parseValueInput(encoding, text);
      partition.value = updateEntry(partition.value, blobUploadEntryId.value, { value });
      showStatus(`已上传 ${file.name}`, 'success');
    } else if (entry.type === NvsType.SZ) {
      const text = await file.text();
      partition.value = updateEntry(partition.value, blobUploadEntryId.value, { value: text });
      showStatus(`已上传 ${file.name} (${text.length} 字符)`, 'success');
    } else {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      partition.value = updateEntry(partition.value, blobUploadEntryId.value, { value: data });
      showStatus(`已上传 ${file.name} (${data.length} 字节)`, 'success');
    }
  } catch (e: any) {
    showStatus(`上传失败: ${e.message}`, 'error');
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(
    () => showStatus('已复制到剪贴板', 'success'),
    () => showStatus('复制失败', 'error'),
  );
}
</script>

<template>
  <div>
    <!-- Hidden file inputs -->
    <input ref="openBinInput" type="file" accept=".bin" style="display:none" @change="onOpenBinChange" />
    <input ref="mergeBinInput" type="file" accept=".bin" style="display:none" @change="onMergeBinChange" />
    <input ref="openCsvInput" type="file" accept=".csv" style="display:none" @change="onOpenCsvChange" />
    <input ref="mergeCsvInput" type="file" accept=".csv" style="display:none" @change="onMergeCsvChange" />
    <input ref="openJsonInput" type="file" accept=".json" style="display:none" @change="onOpenJsonChange" />
    <input ref="mergeJsonInput" type="file" accept=".json" style="display:none" @change="onMergeJsonChange" />
    <input ref="blobUploadInput" type="file" accept="*/*" style="display:none" @change="onBlobUploadChange" />

    <el-alert
      v-if="errors.length > 0"
      type="warning"
      show-icon
      class="mb-3"
      :closable="false"
    >
      <template #title>验证问题 ({{ errors.length }})</template>
      <div v-for="(err, i) in errors" :key="i" class="text-xs">{{ err }}</div>
    </el-alert>

    <div class="nvs-editor-layout">
    <div class="nvs-editor-main">

    <!-- ── Stats bar ── -->
    <div class="flex items-center justify-between flex-wrap gap-3 px-3.5 py-2.5 mb-3 rounded-lg border border-solid" style="background: var(--vp-c-bg-soft); border-color: var(--vp-c-divider);">
      <div class="flex items-center flex-wrap gap-2">
        <span class="text-[13px] whitespace-nowrap" style="color: var(--vp-c-text-2);">分区大小</span>
        <el-input-number
          v-if="sizeInPages"
          v-model="targetSizePages"
          :min="3" :step="1"
          size="small" style="width: 120px;"
        />
        <el-input-number
          v-else
          v-model="targetSizeKB"
          :min="12" :step="4"
          size="small" style="width: 120px;"
        />
        <span class="text-[13px] whitespace-nowrap cursor-pointer underline underline-offset-[3px] nvs-stats-unit" style="color: var(--vp-c-text-2);" @click="sizeInPages = !sizeInPages" title="点击切换单位">
          {{ sizeInPages ? '页' : 'KB' }}
        </span>
        <span class="text-[13px] whitespace-nowrap" style="color: var(--vp-c-text-3);">
          ({{ sizeInPages ? targetSizePages * 4 + ' KB' : targetSizePages + ' 页' }})
        </span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="text-[13px] whitespace-nowrap" style="color: var(--vp-c-text-2);">IDF 版本</span>
          <el-select
            :model-value="partition.version"
            size="small"
            style="width: 160px;"
            @change="handleVersionChange"
          >
            <el-option :value="NvsVersion.V2" label="IDF v4.0+ (V2)" />
            <el-option :value="NvsVersion.V1" label="IDF < v4.0 (V1)" />
          </el-select>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <el-progress
          :percentage="flashStats.usagePercent"
          :color="progressColor"
          :stroke-width="12"
          :show-text="false"
          style="width: 160px;"
        />
        <span class="text-[13px] whitespace-nowrap">
          {{ flashStats.usedEntries }} / {{ flashStats.maxEntries }} 条目
        </span>
        <span class="text-[13px] whitespace-nowrap" style="color: var(--vp-c-text-3);">
          ({{ flashStats.usagePercent.toFixed(1) }}%)
        </span>
      </div>
    </div>

    <!-- ── Toolbar ── -->
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <el-button type="danger" plain @click="handleClear">清空</el-button>
      <el-divider direction="vertical" />
      <el-button
        :type="showHex ? 'warning' : ''"
        :plain="!showHex"
        size="small"
        @click="showHex = !showHex"
        title="切换十六进制显示命名空间"
      >HEX 命名空间</el-button>
    </div>

    <!-- ── Filter bar ── -->
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <el-select v-model="namespaceFilter" placeholder="全部命名空间" clearable style="width: 180px;" size="small">
        <el-option v-for="ns in partition.namespaces" :key="ns" :label="displayNamespace(ns)" :value="ns" />
      </el-select>
      <el-input v-model="keySearch" placeholder="搜索键名..." clearable style="width: 200px;" size="small" />
      <span class="text-sm" style="color: var(--vp-c-text-3);">{{ filteredEntries.length }} 条</span>
    </div>

    <!-- ── Table + add row (scrollable on small screens) ── -->
    <div class="overflow-x-auto min-w-0">
    <!-- ── Inline add row (small/medium screens) ── -->
    <div class="nvs-add-inline flex items-center gap-1.5 px-2.5 py-2" style="background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); border-bottom: none; border-radius: 6px 6px 0 0;">
      <el-select
        v-model="newRow.namespace"
        filterable
        allow-create
        placeholder="命名空间"
        size="small"
        style="width: 150px;"
        @keyup.enter="handleInlineAddEntry"
      >
        <el-option v-for="ns in partition.namespaces" :key="ns" :value="ns" :label="ns" />
      </el-select>
      <el-input
        v-model="newRow.key"
        placeholder="键名 (支持 \xHH)"
        size="small"
        style="width: 170px;"
        @keyup.enter="handleInlineAddEntry"
      />
      <el-select v-model="newRow.encoding" size="small" style="width: 100px;">
        <el-option v-for="enc in encodingOptions" :key="enc" :value="enc" :label="enc" />
      </el-select>
      <el-input
        v-model="newRow.value"
        placeholder="值"
        size="small"
        style="flex: 1; min-width: 100px;"
        @keyup.enter="handleInlineAddEntry"
      />
      <el-button type="primary" :icon="Plus" size="small" @click="handleInlineAddEntry" title="添加记录" />
    </div>

    <!-- ── Data table ── -->
    <el-table
      :data="filteredEntries"
      stripe
      size="small"
      row-key="id"
      empty-text="暂无记录，请在上方添加或导入数据"
      max-height="600"
      @sort-change="handleSortChange"
      class="nvs-table"
    >
      <!-- Key -->
      <el-table-column prop="key" label="键名" width="170" sortable="custom" fixed="left">
        <template #default="{ row }">
          <div class="flex items-center gap-1 w-full">
            <el-icon v-if="hasNonPrintable(row.key)" class="shrink-0 w-3.5 h-3.5 text-[#E6A23C]" title="含非打印字节"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></el-icon>
            <el-input
              :model-value="formatEscapes(row.key)"
              size="small"
              style="flex: 1; min-width: 0;"
              placeholder="支持 \xHH 转义"
              @change="(val: string) => handleUpdateKey(row.id, parseEscapes(val))"
            />
          </div>
        </template>
      </el-table-column>

      <!-- Value -->
      <el-table-column label="值" min-width="160">
        <template #default="{ row }">
          <div class="flex items-center gap-1 w-full">
            <!-- Primitive -->
            <el-input
              v-if="isPrimitiveType(row.type)"
              :model-value="String(row.value)"
              size="small"
              style="flex: 1; min-width: 0;"
              @change="(val: string) => handleUpdateValue(row.id, getEncodingForType(row.type), val)"
            />
            <!-- String -->
            <el-input
              v-else-if="row.type === NvsType.SZ"
              :model-value="formatEscapes(row.value as string)"
              size="small"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 3 }"
              style="flex: 1; min-width: 0;"
              placeholder="支持 \xHH 转义"
              @change="(val: string) => handleUpdateValue(row.id, 'string', val)"
            />
            <!-- Blob -->
            <template v-else>
              <el-text size="small" class="flex-1 min-w-0 font-mono" truncated>{{ formatValue(row) }}</el-text>
            </template>
          </div>
        </template>
      </el-table-column>

      <!-- Type -->
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-select
            :model-value="getEncodingForType(row.type)"
            size="small"
            @change="(val: NvsEncoding) => handleUpdateEncoding(row.id, val)"
          >
            <el-option v-for="enc in encodingOptions" :key="enc" :label="enc" :value="enc" />
          </el-select>
        </template>
      </el-table-column>

      <!-- Namespace -->
      <el-table-column prop="namespace" label="命名空间" width="150" sortable="custom">
        <template #default="{ row }">
          <div class="flex items-center gap-1 w-full">
            <el-icon v-if="hasNonPrintable(row.namespace)" class="shrink-0 w-3.5 h-3.5 text-[#E6A23C]" title="含非打印字节"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></el-icon>
            <el-tooltip :content="displayNamespace(row.namespace)" placement="top" :show-after="300">
              <el-select
                :model-value="row.namespace"
                size="small"
                style="flex: 1; min-width: 0;"
                @change="(val: string) => handleUpdateNamespace(row.id, val)"
              >
                <el-option v-for="ns in partition.namespaces" :key="ns" :label="displayNamespace(ns)" :value="ns" />
              </el-select>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>

      <!-- Actions -->
      <el-table-column label="操作" width="115" fixed="right">
        <template #default="{ row }">
          <div class="nvs-actions flex items-center gap-px flex-nowrap">
            <el-button
              size="small"
              :icon="Upload"
              title="上传文件"
              @click="blobUploadEntryId = row.id; blobUploadInput?.click()"
            />
            <el-button
              size="small"
              :icon="View"
              title="查看完整值"
              @click="valueDialogEntry = row; showValueDialog = true"
            />
            <el-button
              size="small"
              :icon="CopyDocument"
              title="复制记录"
              @click="handleDuplicateEntry(row.id)"
            />
            <el-popconfirm title="确定删除?" @confirm="handleDeleteEntry(row.id)">
              <template #reference>
                <el-button size="small" :icon="Delete" type="danger" title="删除" />
              </template>
            </el-popconfirm>
          </div>
        </template>
      </el-table-column>
    </el-table>
    </div><!-- end nvs-table-wrap -->

    <!-- ── Import / Export ── -->
    <el-divider />
    <div class="flex flex-wrap items-center gap-2.5">
      <div class="flex flex-col items-start gap-1.5">
        <span class="text-[13px] font-semibold whitespace-nowrap" style="color: var(--vp-c-text-1);">二进制文件 (.bin)</span>
        <div class="nvs-io-buttons flex flex-wrap gap-1.5">
          <el-button size="small" @click="openBinInput?.click()">打开</el-button>
          <el-button size="small" type="primary" @click="handleExportBinary">导出</el-button>
          <el-button size="small" @click="mergeBinInput?.click()">合并</el-button>
        </div>
      </div>
      <div class="flex flex-col items-start gap-1.5">
        <span class="text-[13px] font-semibold whitespace-nowrap" style="color: var(--vp-c-text-1);">CSV 文件 (.csv)</span>
        <div class="nvs-io-buttons flex flex-wrap gap-1.5">
          <el-button size="small" @click="openCsvInput?.click()">打开</el-button>
          <el-button size="small" type="primary" @click="handleExportCsv">导出</el-button>
          <el-button size="small" @click="mergeCsvInput?.click()">合并</el-button>
        </div>
      </div>
      <div class="flex flex-col items-start gap-1.5">
        <span class="text-[13px] font-semibold whitespace-nowrap" style="color: var(--vp-c-text-1);">JSON 文件 (.json)</span>
        <div class="nvs-io-buttons flex flex-wrap gap-1.5">
          <el-button size="small" @click="openJsonInput?.click()">打开</el-button>
          <el-button size="small" type="primary" @click="handleExportJson">导出</el-button>
          <el-button size="small" @click="mergeJsonInput?.click()">合并</el-button>
        </div>
      </div>
      <div class="flex flex-col items-start gap-1.5">
        <span class="text-[13px] font-semibold whitespace-nowrap" style="color: var(--vp-c-text-1);">合并策略</span>
        <el-radio-group v-model="mergeMode" size="small">
          <el-radio value="overwrite">覆盖同名键</el-radio>
          <el-radio value="skip">跳过同名键</el-radio>
        </el-radio-group>
      </div>
    </div>
    </div><!-- end nvs-editor-main -->

    <!-- ── Right sidebar: add form (large screens) ── -->
    <div class="nvs-add-sidebar">
      <div class="nvs-add-form">
        <span class="nvs-add-form-title">添加记录</span>
        <el-select
          v-model="newRow.namespace"
          filterable
          allow-create
          placeholder="命名空间"
          size="small"
          @keyup.enter="handleInlineAddEntry"
        >
          <el-option v-for="ns in partition.namespaces" :key="ns" :value="ns" :label="ns" />
        </el-select>
        <el-input
          v-model="newRow.key"
          placeholder="键名 (支持 \xHH)"
          size="small"
          @keyup.enter="handleInlineAddEntry"
        />
        <el-select v-model="newRow.encoding" size="small">
          <el-option v-for="enc in encodingOptions" :key="enc" :value="enc" :label="enc" />
        </el-select>
        <el-input
          v-model="newRow.value"
          placeholder="值"
          size="small"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          @keyup.enter="handleInlineAddEntry"
        />
        <el-button type="primary" :icon="Plus" @click="handleInlineAddEntry">添加</el-button>
      </div>
    </div>
    </div><!-- end nvs-editor-layout -->

    <!-- ── Value viewer dialog ── -->
    <el-dialog
      v-model="showValueDialog"
      :title="`值查看器 — ${valueDialogEntry?.namespace} / ${valueDialogEntry?.key}`"
      width="640px"
    >
      <pre class="nvs-value-viewer">{{ valueDialogEntry ? fullValueText(valueDialogEntry) : '' }}</pre>
      <template #footer>
        <el-button @click="copyToClipboard(valueDialogEntry ? fullValueText(valueDialogEntry) : '')">复制</el-button>
        <el-button type="primary" @click="showValueDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.nvs-stats-unit:hover {
  color: var(--vp-c-brand);
}

@media (min-width: 1200px) {
  .nvs-add-inline {
    display: none;
  }
}

/* Table */
.nvs-table {
  border-radius: 0 0 6px 6px;
}
@media (min-width: 1200px) {
  .nvs-table {
    border-radius: 6px;
  }
}
.nvs-table :deep(td.el-table__cell),
.nvs-table :deep(th.el-table__cell) {
  border-right: none;
  border-bottom: none;
}
.nvs-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

/* Action buttons row */
.nvs-actions > * {
  flex-shrink: 0;
  margin: 0 !important;
}
.nvs-actions :deep(.el-button) {
  --el-button-size: 24px;
  padding: 4px;
}

.nvs-io-buttons :deep(.el-button),
.nvs-io-buttons :deep(.el-tag) {
  margin-left: 0;
}

/* Value viewer */
.nvs-value-viewer {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  max-height: 400px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 12px;
  margin: 0;
  white-space: pre;
  color: var(--vp-c-text-1);
}

/* Responsive editor layout */
.nvs-editor-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.nvs-editor-main {
  flex: 1;
  min-width: 0;
}
.nvs-add-sidebar {
  width: 260px;
  flex-shrink: 0;
  position: sticky;
  top: calc(var(--vp-nav-height, 64px) + 16px);
}
.nvs-add-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}
.nvs-add-form-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
@media (max-width: 1199px) {
  .nvs-editor-layout {
    display: block;
  }
  .nvs-add-sidebar {
    display: none;
  }
}
</style>
