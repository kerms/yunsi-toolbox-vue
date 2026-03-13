<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Upload, View, CopyDocument, Delete, Plus, Search, ArrowDown, FolderOpened, Download, Document, MoreFilled } from '@element-plus/icons-vue';
import BlobEditorDialog from './BlobEditorDialog.vue';
import {
  type NvsPartition, type NvsEntry, type NvsEncoding, type NvsFlashStats, type ValidationError,
  NvsType, NvsVersion,
  ENCODING_TO_TYPE, TYPE_TO_ENCODING,
  isPrimitiveType,
  createEmptyPartition, addEntry, removeEntry, updateEntry,
  duplicateEntry, mergePartitions, calculateFlashStats,
  validatePartition, generateEntryId, normalizePartition, reconcileBlobTypes,
  checkBlobCompatibility, parseHexString,
  parseBinary, serializeBinary, parseCsv, serializeCsv,
  MAX_KEY_LENGTH, PAGE_SIZE,
} from '../../lib/nvs';

const props = defineProps<{
  isDark?: boolean;
}>();

// ── Core state ─────────────────────────────────────────────────────

const partition = ref<NvsPartition>(createEmptyPartition());
const targetSize = ref(0x4000);

// ── UI state ───────────────────────────────────────────────────────

const namespaceFilter = ref('');
const searchQuery = ref('');
const mergeMode = ref<'overwrite' | 'skip'>('overwrite');
const showHex = ref(false);
const isSmallScreen = ref(false);
const mobileTab = ref<'add' | 'search'>('add');

// Inline new row state
const newRow = ref({ namespace: '', key: '', encoding: 'u8' as NvsEncoding, value: '' });

// Value viewer dialog
const showValueDialog = ref(false);
const valueDialogEntry = ref<NvsEntry | null>(null);

// Column sort state
const sortProp = ref<'namespace' | 'key' | 'value' | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

// File input refs
const openInput = ref<HTMLInputElement>();
const mergeInput = ref<HTMLInputElement>();
const newRowBlobInput = ref<HTMLInputElement>();
const newRowStringInput = ref<HTMLInputElement>();

// Blob editor dialog state
const blobEditorVisible = ref(false);
const blobEditorData    = ref(new Uint8Array(0));
const blobEditorEntryId = ref('');  // '' = new-row mode
const blobEditorKey     = ref('');

/** Transient editing buffers for inline table editing.
 *  Key: "entryId:field" → raw string value. */
const editingCells = reactive(new Map<string, string>());

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

function _onResize() { isSmallScreen.value = window.innerWidth < 640; }

onMounted(() => {
  isSmallScreen.value = window.innerWidth < 640;
  window.addEventListener('resize', _onResize);
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

onUnmounted(() => { window.removeEventListener('resize', _onResize); });

// ── Computed ───────────────────────────────────────────────────────

const flashStats = computed<NvsFlashStats>(() =>
  calculateFlashStats(partition.value, targetSize.value),
);

const errors = computed(() => validatePartition(partition.value));

/** Map entry ID → validation errors for that entry (for red highlighting) */
const entryErrors = computed(() => {
  const map = new Map<string, string[]>();
  for (const err of errors.value) {
    if (err.entryId) {
      if (!map.has(err.entryId)) map.set(err.entryId, []);
      map.get(err.entryId)!.push(err.message);
    }
  }
  return map;
});

const _blobHexCache = new WeakMap<Uint8Array, string>();

/** Stringify entry value for search/sort comparison */
function valueToString(entry: NvsEntry): string {
  if (entry.value instanceof Uint8Array) {
    let hex = _blobHexCache.get(entry.value);
    if (!hex) { hex = Array.from(entry.value).map(b => b.toString(16).padStart(2, '0')).join(' '); _blobHexCache.set(entry.value, hex); }
    return hex;
  }
  return String(entry.value);
}

const filteredEntries = computed(() => {
  let entries = partition.value.entries;
  if (namespaceFilter.value) entries = entries.filter(e => e.namespace === namespaceFilter.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    entries = entries.filter(e =>
      e.key.toLowerCase().includes(q) || valueToString(e).toLowerCase().includes(q),
    );
  }
  if (sortProp.value && sortOrder.value) {
    const col = sortProp.value;
    const dir = sortOrder.value === 'ascending' ? 1 : -1;
    if (col === 'value') {
      entries = [...entries].sort((a, b) => {
        const av = a.value, bv = b.value;
        if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
        if (typeof av === 'bigint' && typeof bv === 'bigint') return dir * (av < bv ? -1 : av > bv ? 1 : 0);
        // Mixed integer types: coerce to BigInt for precision-safe comparison
        if ((typeof av === 'number' || typeof av === 'bigint') &&
            (typeof bv === 'number' || typeof bv === 'bigint')) {
          const an = typeof av === 'bigint' ? av : BigInt(av);
          const bn = typeof bv === 'bigint' ? bv : BigInt(bv);
          return dir * (an < bn ? -1 : an > bn ? 1 : 0);
        }
        // For blob sort: use cheap 8-byte preview, not full blobToHex
        const as_ = av instanceof Uint8Array ? formatValue(a) : String(av);
        const bs_ = bv instanceof Uint8Array ? formatValue(b) : String(bv);
        return dir * as_.localeCompare(bs_);
      });
    } else {
      entries = [...entries].sort((a, b) => dir * a[col].localeCompare(b[col]));
    }
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

/** Hex-dump a string as space-separated UTF-8 byte values (for string values) */
function displayHex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');
}

/** Hex-dump a string as space-separated Latin-1 byte values (for keys and namespaces) */
function displayHexLatin1(s: string): string {
  return Array.from(s, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
}

/** Display a namespace/key string with hex mode support (Latin-1 encoding) */
function displayStr(s: string): string {
  return showHex.value ? displayHexLatin1(s) : s;
}

/** Format entry value for hex display */
function formatValueHex(entry: NvsEntry): string {
  if (entry.value instanceof Uint8Array) return formatValue(entry);
  if (typeof entry.value === 'bigint') {
    // Negative I64: show two's complement unsigned representation
    const v = entry.value < 0n ? BigInt.asUintN(64, entry.value) : entry.value;
    return '0x' + v.toString(16).toUpperCase();
  }
  if (typeof entry.value === 'number') {
    // Negative signed integers: mask to proper unsigned width (two's complement)
    let v = entry.value;
    if (v < 0) {
      switch (entry.type) {
        case NvsType.I8:  v = v & 0xFF; break;
        case NvsType.I16: v = v & 0xFFFF; break;
        case NvsType.I32: v = v >>> 0; break;
      }
    }
    return '0x' + v.toString(16).toUpperCase();
  }
  if (typeof entry.value === 'string') return displayHex(entry.value);
  return String(entry.value);
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
      const result = parseHexString(raw);
      if ('error' in result) throw new Error(result.error);
      return result.bytes;
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
  showStatus('已添加', 'success');
}

async function onNewRowStringChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  newRow.value.value = formatEscapes(await file.text());
}

async function onNewRowBlobChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  newRow.value.value = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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

function handleUpdateKey(entryId: string, newKey: string): boolean {
  if (!newKey) { showStatus('键名不能为空', 'error'); return false; }
  if (newKey.length > MAX_KEY_LENGTH) { showStatus(`键名超过 ${MAX_KEY_LENGTH} 字符`, 'error'); return false; }
  partition.value = updateEntry(partition.value, entryId, { key: newKey });
  return true;
}

function handleUpdateNamespace(entryId: string, ns: string) {
  partition.value = updateEntry(partition.value, entryId, { namespace: ns });
}

function handleUpdateEncoding(entryId: string, encoding: NvsEncoding) {
  const type = ENCODING_TO_TYPE[encoding];
  const entry = partition.value.entries.find(e => e.id === entryId);
  if (!entry) return;

  const oldValue = entry.value;
  let value: NvsEntry['value'];
  const isBigIntType = type === NvsType.U64 || type === NvsType.I64;

  if (isBigIntType) {
    if (typeof oldValue === 'bigint') value = oldValue;
    else if (typeof oldValue === 'number') value = BigInt(Math.trunc(oldValue));
    else if (typeof oldValue === 'string') {
      try { value = BigInt(oldValue); } catch { value = 0n; }
    } else value = 0n;
  } else if (isPrimitiveType(type)) {
    if (typeof oldValue === 'number') value = oldValue;
    else if (typeof oldValue === 'bigint') value = Number(oldValue);
    else if (typeof oldValue === 'string') {
      const n = Number(oldValue);
      value = Number.isNaN(n) ? 0 : Math.trunc(n);
    } else value = 0;
  } else if (type === NvsType.SZ) {
    if (typeof oldValue === 'string') value = oldValue;
    else if (typeof oldValue === 'number' || typeof oldValue === 'bigint') value = String(oldValue);
    else value = '';
  } else {
    value = oldValue instanceof Uint8Array ? oldValue : new Uint8Array(0);
  }

  partition.value = updateEntry(partition.value, entryId, { type, value });
  editingCells.delete(entryId + ':value');
}

function handleUpdateValue(entryId: string, encoding: NvsEncoding, raw: string): boolean {
  let value: ReturnType<typeof parseValueInput>;
  try {
    value = parseValueInput(encoding, raw);
  } catch (e: any) {
    showStatus(e.message ?? '值格式错误', 'error');
    return false;
  }
  partition.value = updateEntry(partition.value, entryId, { value });
  return true;
}

/** Commit the editing buffer for a cell. Buffer is cleared only on success. */
function commitEdit(entryId: string, field: string) {
  const bufKey = entryId + ':' + field;
  const val = editingCells.get(bufKey);
  if (val === undefined) return;

  let ok: boolean;
  if (field === 'key') {
    ok = handleUpdateKey(entryId, parseEscapes(val));
  } else {
    const entry = partition.value.entries.find(e => e.id === entryId);
    if (!entry) { editingCells.delete(bufKey); return; }
    if (entry.type === NvsType.SZ) {
      partition.value = updateEntry(partition.value, entryId, { value: parseEscapes(val) });
      ok = true;
    } else {
      ok = handleUpdateValue(entryId, getEncodingForType(entry.type), val);
    }
  }
  if (ok) editingCells.delete(bufKey);
}

/** Cancel editing: discard buffer so display reverts to stored value. */
function cancelEdit(entryId: string, field: string) {
  editingCells.delete(entryId + ':' + field);
}

// ── Actions: Sort ──────────────────────────────────────────────────

function handleSortChange({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) {
  sortProp.value = prop as 'namespace' | 'key' | 'value' | null;
  sortOrder.value = order;
}

// ── Actions: File I/O ──────────────────────────────────────────────

async function detectFileType(file: File): Promise<'bin' | 'csv' | 'json'> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'bin' || ext === 'nvs' || ext === 'part' || ext === 'img') return 'bin';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  // Fallback: size multiple of page size → binary; first byte '{' → json; else csv
  if (file.size > 0 && file.size % PAGE_SIZE === 0) return 'bin';
  const firstByte = new Uint8Array(await file.slice(0, 1).arrayBuffer())[0];
  return firstByte === 0x7b ? 'json' : 'csv';
}

async function handleImport(file: File, mode: 'open' | 'merge') {
  const type = await detectFileType(file);
  try {
    if (type === 'bin') {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      const incoming = parseBinary(data);
      if (mode === 'open') {
        partition.value = incoming;
        targetSize.value = data.byteLength;
        showStatus(`已加载 ${file.name} (${data.byteLength} 字节)`, 'success');
      } else {
        partition.value = mergePartitions(partition.value, incoming, mergeMode.value);
        showStatus(`已合并 ${file.name} (${incoming.entries.length} 条记录)`, 'success');
        const blobWarnings = checkBlobCompatibility(partition.value.entries, partition.value.version);
        if (blobWarnings.length > 0) showStatus(`${blobWarnings.length} 个 blob 超出大小限制，请查看验证面板`, 'info');
      }
    } else if (type === 'csv') {
      const text = await file.text();
      const incoming = parseCsv(text);
      if (mode === 'open') {
        partition.value = incoming;
        showStatus(`已加载 ${file.name}`, 'success');
      } else {
        partition.value = mergePartitions(partition.value, incoming, mergeMode.value);
        showStatus(`已合并 ${file.name} (${incoming.entries.length} 条记录)`, 'success');
        const blobWarnings = checkBlobCompatibility(partition.value.entries, partition.value.version);
        if (blobWarnings.length > 0) showStatus(`${blobWarnings.length} 个 blob 超出大小限制，请查看验证面板`, 'info');
      }
    } else {
      const text = await file.text();
      const raw = partitionFromJson(text);
      const { partition: incoming, dropped, clamped } = normalizePartition(raw);
      if (mode === 'open') {
        partition.value = incoming;
        const parts: string[] = [`已加载 ${file.name}`];
        if (dropped > 0 || clamped > 0) {
          const details: string[] = [];
          if (dropped > 0) details.push(`丢弃 ${dropped} 条无效记录`);
          if (clamped > 0) details.push(`${clamped} 条值被截断`);
          parts.push(`（${incoming.entries.length} 条，${details.join('，')}）`);
        }
        showStatus(parts.join(''), (dropped > 0 || clamped > 0) ? 'info' : 'success');
      } else {
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
        if (blobWarnings.length > 0) showStatus(`${blobWarnings.length} 个 blob 超出大小限制，请查看验证面板`, 'info');
      }
    }
  } catch (e: any) {
    showStatus(`${mode === 'open' ? '加载' : '合并'}失败: ${e.message}`, 'error');
  }
}

async function onOpenChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  await handleImport(file, 'open');
}

async function onMergeChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  await handleImport(file, 'merge');
}

function handleExportBinary() {
  try {
    const errs = validatePartition(partition.value);
    if (errs.length > 0) { showStatus(`验证错误: ${errs[0].message}`, 'error'); return; }
    const data = serializeBinary(partition.value, targetSize.value);
    downloadBlob(new Blob([data as Uint8Array<ArrayBuffer>]), 'nvs.bin');
    showStatus('已导出 nvs.bin', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
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

function handleExportJson() {
  try {
    const text = partitionToJson(partition.value);
    downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), 'nvs.json');
    showStatus('已导出 nvs.json', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
  }
}

function isBlobEntry(row: NvsEntry): boolean {
  return row.value instanceof Uint8Array;
}

function isUploadableEntry(_row: NvsEntry): boolean {
  return true;
}

const fileUploadInput = ref<HTMLInputElement>();
let fileUploadEntryId = '';

function triggerUpload(row: NvsEntry) {
  if (row.value instanceof Uint8Array) {
    openBlobEditor(row.id);
  } else {
    fileUploadEntryId = row.id;
    fileUploadInput.value?.click();
  }
}

async function onFileUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  const entry = partition.value.entries.find(e => e.id === fileUploadEntryId);
  if (!entry) { showStatus('记录不存在', 'error'); return; }
  const text = await file.text();
  if (isPrimitiveType(entry.type)) {
    try {
      const value = parseValueInput(getEncodingForType(entry.type), text.trim());
      partition.value = updateEntry(partition.value, fileUploadEntryId, { value });
      showStatus(`已导入 ${file.name}`, 'success');
    } catch (err: any) {
      showStatus(`导入失败: ${err.message}`, 'error');
    }
  } else {
    partition.value = updateEntry(partition.value, fileUploadEntryId, { value: text });
    showStatus('已导入文本', 'success');
  }
}

function openBlobEditor(entryId: string) {
  const entry = partition.value.entries.find(e => e.id === entryId);
  if (!entry || !(entry.value instanceof Uint8Array)) return;
  blobEditorEntryId.value = entryId;
  blobEditorKey.value     = entry.key;
  blobEditorData.value    = new Uint8Array(entry.value);
  blobEditorVisible.value = true;
}

function openBlobEditorForNewRow() {
  const result = parseHexString(newRow.value.value);
  if ('error' in result && newRow.value.value.trim()) {
    showStatus(`十六进制格式错误: ${result.error}`, 'error');
    return;
  }
  blobEditorEntryId.value = '';
  blobEditorKey.value     = newRow.value.key || 'blob';
  blobEditorData.value    = 'bytes' in result ? new Uint8Array(result.bytes) : new Uint8Array(0);
  blobEditorVisible.value = true;
}

function onBlobEditorConfirm(data: Uint8Array) {
  if (blobEditorEntryId.value) {
    partition.value = updateEntry(partition.value, blobEditorEntryId.value, { value: data });
    showStatus(`已更新 (${data.length} 字节)`, 'success');
  } else {
    newRow.value.value = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
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
  <div class="nvs-editor-container">
    <!-- Hidden file inputs -->
    <input ref="openInput"  type="file" accept=".bin,.nvs,.part,.img,.csv,.json" style="display:none" @change="onOpenChange" />
    <input ref="mergeInput" type="file" accept=".bin,.nvs,.part,.img,.csv,.json" style="display:none" @change="onMergeChange" />
    <input ref="newRowBlobInput" type="file" accept="*/*" style="display:none" @change="onNewRowBlobChange" />
    <input ref="newRowStringInput" type="file" accept="*/*" style="display:none" @change="onNewRowStringChange" />
    <input ref="fileUploadInput" type="file" accept="*/*" style="display:none" @change="onFileUpload" />

    <el-alert
      v-if="errors.length > 0"
      type="warning"
      show-icon
      class="mb-4"
      :closable="false"
    >
      <template #title>验证问题 ({{ errors.length }})</template>
      <div v-for="(err, i) in errors" :key="i" class="text-xs">{{ err.message }}</div>
    </el-alert>

    <!-- ── Stats and Configuration Card ── -->
    <el-card shadow="never" class="mb-4 nvs-stats-card">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center flex-wrap gap-4">
          <div class="stat-item">
            <span class="stat-label">分区大小</span>
            <div class="flex items-center gap-2 mt-1">
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
              <span class="text-[13px] cursor-pointer underline underline-offset-[3px] nvs-stats-unit" style="color: var(--vp-c-text-2);" @click="sizeInPages = !sizeInPages" title="点击切换单位">
                {{ sizeInPages ? '页' : 'KB' }}
              </span>
              <span class="text-[13px]" style="color: var(--vp-c-text-3);">
                ({{ sizeInPages ? targetSizePages * 4 + ' KB' : targetSizePages + ' 页' }})
              </span>
            </div>
          </div>
          
          <el-divider direction="vertical" class="hidden sm:block h-8" />
          
          <div class="stat-item">
            <span class="stat-label">IDF 版本</span>
            <div class="mt-1">
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
        </div>
        
        <div class="stat-item progress-item">
          <div class="flex justify-between w-full mb-1">
            <span class="stat-label">空间使用率</span>
            <span class="text-[12px]" style="color: var(--vp-c-text-2);">
              {{ flashStats.usedEntries }} / {{ flashStats.maxEntries }} 条目
            </span>
          </div>
          <el-progress
            :percentage="flashStats.usagePercent"
            :color="progressColor"
            :stroke-width="10"
            class="nvs-progress"
          >
            <span class="text-[12px] ml-2 font-medium">{{ flashStats.usagePercent.toFixed(1) }}%</span>
          </el-progress>
        </div>
      </div>
    </el-card>

    <!-- ── Main Action Toolbar (Desktop) ── -->
    <div v-if="!isSmallScreen" class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-3">
        <el-button type="danger" plain :icon="Delete" @click="handleClear">清空数据</el-button>
        <el-checkbox v-model="showHex" border>HEX 模式</el-checkbox>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <!-- Filter group — wraps as a unit -->
        <div class="flex items-center gap-2 flex-nowrap min-w-0">
          <el-select v-model="namespaceFilter" placeholder="全部命名空间" clearable style="width: 150px;">
            <el-option v-for="ns in partition.namespaces" :key="ns" :label="displayStr(ns)" :value="ns" />
          </el-select>
          <el-input v-model="searchQuery" placeholder="搜索键名/值..." clearable :prefix-icon="Search" style="width: 160px;" />
        </div>

        <!-- Action group — wraps as a unit -->
        <div class="flex items-center gap-2 flex-wrap">
          <el-divider direction="vertical" />
          <el-button type="primary" plain :icon="FolderOpened" @click="openInput?.click()">打开(覆盖)</el-button>

        <el-dropdown trigger="click">
          <el-button type="primary" plain :icon="Upload">
            导入 <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <div class="px-3 py-2 border-b border-gray-100 flex flex-col gap-1 bg-gray-50">
                <span class="text-xs text-gray-500 font-semibold">合并策略</span>
                <el-radio-group v-model="mergeMode" size="small">
                  <el-radio value="overwrite">覆盖同名</el-radio>
                  <el-radio value="skip">跳过同名</el-radio>
                </el-radio-group>
              </div>
              <el-dropdown-item @click="mergeInput?.click()">选择文件合并</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click">
          <el-button type="primary" :icon="Download">
            导出 <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="handleExportBinary">导出为 BIN</el-dropdown-item>
              <el-dropdown-item @click="handleExportCsv">导出为 CSV</el-dropdown-item>
              <el-dropdown-item @click="handleExportJson">导出为 JSON</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        </div><!-- end action group -->
      </div>
    </div>

    <!-- ── Mobile Toolbar (<640px) ── -->
    <div v-else class="mb-3">
      <!-- Row 1: actions -->
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <el-button type="primary" plain size="small" :icon="FolderOpened" @click="openInput?.click()">打开</el-button>
        <el-dropdown trigger="click">
          <el-button type="primary" plain size="small" :icon="Upload">
            导入 <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <div class="px-3 py-2 border-b border-gray-100 flex flex-col gap-1 bg-gray-50">
                <span class="text-xs text-gray-500 font-semibold">合并策略</span>
                <el-radio-group v-model="mergeMode" size="small">
                  <el-radio value="overwrite">覆盖同名</el-radio>
                  <el-radio value="skip">跳过同名</el-radio>
                </el-radio-group>
              </div>
              <el-dropdown-item @click="mergeInput?.click()">选择文件合并</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click">
          <el-button type="primary" size="small" :icon="Download">
            导出 <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="handleExportBinary">导出为 BIN</el-dropdown-item>
              <el-dropdown-item @click="handleExportCsv">导出为 CSV</el-dropdown-item>
              <el-dropdown-item @click="handleExportJson">导出为 JSON</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <span class="flex-1" />
        <el-button type="danger" plain size="small" :icon="Delete" @click="handleClear">清空</el-button>
        <el-checkbox v-model="showHex" border size="small">HEX</el-checkbox>
      </div>
      <!-- Row 2: tabs -->
      <el-tabs v-model="mobileTab" type="card" class="nvs-mobile-tabs">
        <el-tab-pane label="新增" name="add" />
        <el-tab-pane label="搜索" name="search" />
      </el-tabs>
      <!-- Search tab content -->
      <div v-if="mobileTab === 'search'" class="flex flex-col gap-2 mt-2">
        <el-select v-model="namespaceFilter" placeholder="全部命名空间" clearable>
          <el-option v-for="ns in partition.namespaces" :key="ns" :label="displayStr(ns)" :value="ns" />
        </el-select>
        <el-input v-model="searchQuery" placeholder="搜索键名/值..." clearable :prefix-icon="Search" />
      </div>
    </div>

    <!-- ── Data Table Card ── -->
    <el-card shadow="never" class="nvs-table-card" :body-style="{ padding: '0px' }">
      <div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-b nvs-card-header">
        <span class="text-[14px] font-semibold text-gray-700">数据列表 <span class="font-normal text-gray-500 ml-1">({{ filteredEntries.length }} 条)</span></span>
      </div>

      <!-- Inline Add Row -->
      <div v-show="!isSmallScreen || mobileTab === 'add'" class="nvs-add-inline grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px_150px_auto] gap-2 px-4 py-3 border-b" style="background: var(--vp-c-bg-soft);">
        <el-input
          v-model="newRow.key"
          placeholder="新键名 (支持 \xHH)"
          @keyup.enter="handleInlineAddEntry"
        />
        <div
          v-if="newRow.encoding === 'binary' || newRow.encoding === 'blob'"
          class="flex items-center gap-1 min-w-0"
        >
          <el-input
            v-model="newRow.value"
            placeholder="十六进制 (e.g. deadbeef)"
            @keyup.enter="handleInlineAddEntry"
            style="flex:1;min-width:0"
          />
          <el-button-group>
            <el-button :icon="Upload" @click="newRowBlobInput?.click()" title="从文件导入" />
            <el-button :icon="MoreFilled" @click="openBlobEditorForNewRow" title="详细编辑" />
          </el-button-group>
        </div>
        <div
          v-else-if="newRow.encoding === 'string'"
          class="flex items-center gap-1 min-w-0"
        >
          <el-input
            v-model="newRow.value"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 3 }"
            placeholder="值 (支持 \\xHH 转义)"
            style="flex:1;min-width:0"
          />
          <el-button :icon="Upload" @click="newRowStringInput?.click()" title="从文件导入" />
        </div>
        <el-input
          v-else
          v-model="newRow.value"
          placeholder="值"
          @keyup.enter="handleInlineAddEntry"
        />
        <el-select v-model="newRow.encoding">
          <el-option v-for="enc in encodingOptions" :key="enc" :value="enc" :label="enc" />
        </el-select>
        <el-select
          v-model="newRow.namespace"
          filterable
          allow-create
          placeholder="命名空间"
          @keyup.enter="handleInlineAddEntry"
        >
          <el-option v-for="ns in partition.namespaces" :key="ns" :value="ns" :label="displayStr(ns)" />
        </el-select>
        <el-button type="primary" :icon="Plus" @click="handleInlineAddEntry" title="添加记录">添加</el-button>
      </div>

      <!-- Data table -->
      <el-table
        :data="filteredEntries"
        stripe
        row-key="id"
        empty-text="暂无记录，请在上方添加或导入数据"
        max-height="600"
        @sort-change="handleSortChange"
        class="w-full"
      >
        <!-- Key -->
        <el-table-column prop="key" label="键名" min-width="120" sortable="custom" fixed="left">
          <template #default="{ row }">
            <div :class="['flex items-center gap-2 w-full', { 'nvs-cell-error': entryErrors.has(row.id) }]">
              <el-icon v-if="hasNonPrintable(row.key)" class="shrink-0 text-warning" title="含非打印字节"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></el-icon>
              <el-input
                :model-value="editingCells.get(row.id + ':key') ?? (showHex ? displayHexLatin1(row.key) : formatEscapes(row.key))"
                class="nvs-seamless-input"
                :placeholder="showHex ? '' : '支持 \\xHH'"
                :readonly="showHex"
                @focus="!showHex && editingCells.set(row.id + ':key', formatEscapes(row.key))"
                @input="(val: string) => editingCells.set(row.id + ':key', val)"
                @keyup.enter="commitEdit(row.id, 'key')"
                @keyup.escape="cancelEdit(row.id, 'key')"
                @blur="commitEdit(row.id, 'key')"
              />
            </div>
          </template>
        </el-table-column>

        <!-- Value -->
        <el-table-column prop="value" label="值" min-width="200" sortable="custom">
          <template #default="{ row }">
            <div :class="['flex items-center gap-1 w-full', { 'nvs-cell-error': entryErrors.has(row.id) }]">
              <!-- Primitive -->
              <el-input
                v-if="isPrimitiveType(row.type)"
                :model-value="editingCells.get(row.id + ':value') ?? (showHex ? formatValueHex(row) : String(row.value))"
                class="nvs-seamless-input"
                :readonly="showHex"
                @focus="!showHex && editingCells.set(row.id + ':value', String(row.value))"
                @input="(val: string) => editingCells.set(row.id + ':value', val)"
                @keyup.enter="commitEdit(row.id, 'value')"
                @keyup.escape="cancelEdit(row.id, 'value')"
                @blur="commitEdit(row.id, 'value')"
              />
              <!-- String -->
              <el-input
                v-else-if="row.type === NvsType.SZ"
                :model-value="editingCells.get(row.id + ':value') ?? (showHex ? displayHex(row.value as string) : formatEscapes(row.value as string))"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 3 }"
                class="nvs-seamless-input"
                :placeholder="showHex ? '' : '支持 \\xHH 转义'"
                :readonly="showHex"
                @focus="!showHex && editingCells.set(row.id + ':value', formatEscapes(row.value as string))"
                @input="(val: string) => editingCells.set(row.id + ':value', val)"
                @keyup.escape="cancelEdit(row.id, 'value')"
                @blur="commitEdit(row.id, 'value')"
              />
              <!-- Blob -->
              <div v-else class="flex items-center gap-1 w-full min-w-0">
                <span class="text-sm font-mono text-gray-500 flex-1 truncate">{{ formatValue(row) }}</span>
                <el-button size="small" link :icon="Document" @click="openBlobEditor(row.id)">编辑</el-button>
              </div>
            </div>
          </template>
        </el-table-column>

        <!-- Type -->
        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <div :class="{ 'nvs-cell-error': entryErrors.has(row.id) }">
            <el-select
              :model-value="getEncodingForType(row.type)"
              class="nvs-seamless-select"
              @change="(val: NvsEncoding) => handleUpdateEncoding(row.id, val)"
            >
              <el-option v-for="enc in encodingOptions" :key="enc" :label="enc" :value="enc" />
            </el-select>
            </div>
          </template>
        </el-table-column>

        <!-- Namespace -->
        <el-table-column prop="namespace" label="命名空间" width="180" sortable="custom">
          <template #default="{ row }">
            <div :class="['flex items-center gap-2 w-full', { 'nvs-cell-error': entryErrors.has(row.id) }]">
              <el-icon v-if="hasNonPrintable(row.namespace)" class="shrink-0 text-warning" title="含非打印字节"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></el-icon>
              <el-tooltip :content="displayStr(row.namespace)" placement="top" :show-after="300">
                <el-select
                  :model-value="row.namespace"
                  class="nvs-seamless-select"
                  @change="(val: string) => handleUpdateNamespace(row.id, val)"
                >
                  <el-option v-for="ns in partition.namespaces" :key="ns" :label="displayStr(ns)" :value="ns" />
                </el-select>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>

        <!-- Actions -->
        <el-table-column label="操作" :width="isSmallScreen ? 60 : 130" fixed="right">
          <template #default="{ row }">
            <!-- Desktop: compact icon buttons -->
            <div class="nvs-actions-desktop flex items-center">
              <el-button type="primary" link size="small" :icon="Upload" @click="triggerUpload(row)" :title="isBlobEntry(row) ? '编辑二进制' : '从文件导入'" />
              <el-button type="primary" link size="small" :icon="Document" @click="valueDialogEntry = row; showValueDialog = true" title="查看完整值" />
              <el-button type="primary" link size="small" :icon="CopyDocument" @click="handleDuplicateEntry(row.id)" title="复制记录" />
              <el-popconfirm title="确定删除此记录?" @confirm="handleDeleteEntry(row.id)">
                <template #reference>
                  <el-button type="danger" link size="small" :icon="Delete" title="删除" />
                </template>
              </el-popconfirm>
            </div>
            <!-- Mobile: dropdown menu -->
            <div class="nvs-actions-mobile">
              <el-dropdown trigger="click">
                <el-button type="primary" link :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="triggerUpload(row)">{{ isBlobEntry(row) ? '编辑二进制' : '从文件导入' }}</el-dropdown-item>
                    <el-dropdown-item @click="valueDialogEntry = row; showValueDialog = true">查看完整值</el-dropdown-item>
                    <el-dropdown-item @click="handleDuplicateEntry(row.id)">复制记录</el-dropdown-item>
                    <el-dropdown-item divided @click="ElMessageBox.confirm('确定删除此记录?', '确认', { type: 'warning' }).then(() => handleDeleteEntry(row.id)).catch(() => {})">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- ── Blob editor dialog ── -->
    <BlobEditorDialog
      v-model:visible="blobEditorVisible"
      :model-value="blobEditorData"
      :entry-key="blobEditorKey"
      @update:model-value="onBlobEditorConfirm"
    />

    <!-- ── Value viewer dialog ── -->
    <el-dialog
      v-model="showValueDialog"
      :title="`值查看器 — ${valueDialogEntry?.namespace} / ${valueDialogEntry?.key}`"
      width="640px"
      destroy-on-close
    >
      <pre class="nvs-value-viewer">{{ valueDialogEntry ? fullValueText(valueDialogEntry) : '' }}</pre>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="copyToClipboard(valueDialogEntry ? fullValueText(valueDialogEntry) : '')">复制内容</el-button>
          <el-button type="primary" @click="showValueDialog = false">关闭</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.nvs-editor-container {
  max-width: 100%;
  margin: 0 auto;
}

.nvs-stats-card :deep(.el-card__body) {
  padding: 16px 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.progress-item {
  min-width: 200px;
  flex: 1;
  max-width: 400px;
}

.nvs-progress :deep(.el-progress-bar__outer) {
  background-color: var(--vp-c-bg-soft);
}

.nvs-stats-unit:hover {
  color: var(--vp-c-brand);
}

.nvs-table-card {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
}

.nvs-card-header {
  background-color: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

/* Seamless Inputs for Table */
.nvs-seamless-input :deep(.el-input__wrapper),
.nvs-seamless-select :deep(.el-input__wrapper),
.nvs-seamless-input :deep(.el-textarea__inner) {
  box-shadow: none !important;
  background-color: transparent;
  padding: 0 8px;
}

.nvs-seamless-input :deep(.el-input__wrapper:hover),
.nvs-seamless-select :deep(.el-input__wrapper:hover),
.nvs-seamless-input :deep(.el-textarea__inner:hover),
.nvs-seamless-input :deep(.el-input__wrapper.is-focus),
.nvs-seamless-select :deep(.el-input__wrapper.is-focus),
.nvs-seamless-input :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
  background-color: var(--vp-c-bg);
  border-radius: 4px;
}

/* Value viewer */
.nvs-value-viewer {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow: auto;
  max-height: 400px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 16px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--vp-c-text-1);
}

/* Dark mode overrides and utility classes mapping */
.bg-gray-50 {
  background-color: var(--vp-c-bg-soft);
}
.border-b {
  border-bottom: 1px solid var(--vp-c-divider);
}
.text-gray-500 {
  color: var(--vp-c-text-2);
}
.text-gray-700 {
  color: var(--vp-c-text-1);
}
.border-gray-100 {
  border-color: var(--vp-c-divider);
}
.text-warning {
  color: #E6A23C;
}

/* Error highlighting for validation conflicts */
.nvs-cell-error :deep(.el-input__wrapper),
.nvs-cell-error :deep(.el-select .el-input__wrapper),
.nvs-cell-error :deep(.el-textarea__inner) {
  background-color: rgba(245, 108, 108, 0.1) !important;
}

/* Responsive action buttons */
.nvs-actions-mobile { display: none; }

@media (max-width: 639px) {
  .nvs-add-inline {
    grid-template-columns: 1fr;
  }
  .nvs-actions-desktop { display: none; }
  .nvs-actions-mobile { display: block; }
}

/* Mobile tabs: remove content padding since tab-pane is empty */
.nvs-mobile-tabs :deep(.el-tabs__content) {
  display: none;
}
.nvs-mobile-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
</style>
