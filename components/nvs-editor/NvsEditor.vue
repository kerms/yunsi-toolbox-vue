<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import {
  type NvsPartition, type NvsEntry, type NvsEncoding, type NvsFlashStats,
  NvsType, NvsVersion,
  ENCODING_OPTIONS, ENCODING_TO_TYPE, TYPE_TO_ENCODING,
  isPrimitiveType,
  createEmptyPartition, addEntry, removeEntry, updateEntry,
  duplicateEntry, mergePartitions, calculateFlashStats,
  validatePartition, sortEntries, generateEntryId,
  parseBinary, serializeBinary, parseCsv, serializeCsv,
  MAX_KEY_LENGTH, PAGE_SIZE,
} from '../../lib/nvs';

const props = defineProps<{
  isDark?: boolean;
}>();

// ── Core state ─────────────────────────────────────────────────────

const partition = ref<NvsPartition>(createEmptyPartition());
const targetSize = ref(0x4000); // 16KB default

// ── UI state ───────────────────────────────────────────────────────

const namespaceFilter = ref('');
const keySearch = ref('');
const mergeMode = ref<'overwrite' | 'skip'>('overwrite');
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'info'>('info');

// Add entry dialog
const showAddDialog = ref(false);
const newEntry = reactive({
  namespace: '',
  key: '',
  encoding: 'u8' as NvsEncoding,
  value: '',
});

// Add namespace dialog
const showNsDialog = ref(false);
const newNamespace = ref('');

// ── Computed ───────────────────────────────────────────────────────

const flashStats = computed<NvsFlashStats>(() =>
  calculateFlashStats(partition.value, targetSize.value),
);

const errors = computed(() => validatePartition(partition.value));

const filteredEntries = computed(() => {
  let entries = partition.value.entries;
  if (namespaceFilter.value) {
    entries = entries.filter(e => e.namespace === namespaceFilter.value);
  }
  if (keySearch.value) {
    entries = entries.filter(e => e.key.includes(keySearch.value));
  }
  return entries;
});

const progressColor = computed(() => {
  const pct = flashStats.value.usagePercent;
  if (pct >= 85) return '#F56C6C';
  if (pct >= 60) return '#E6A23C';
  return '#67C23A';
});

const sizeOptions = [
  { label: '12 KB (3页)', value: 0x3000 },
  { label: '16 KB (4页)', value: 0x4000 },
  { label: '20 KB (5页)', value: 0x5000 },
  { label: '24 KB (6页)', value: 0x6000 },
  { label: '32 KB (8页)', value: 0x8000 },
  { label: '64 KB (16页)', value: 0x10000 },
  { label: '128 KB (32页)', value: 0x20000 },
  { label: '256 KB (64页)', value: 0x40000 },
];

// ── Helpers ────────────────────────────────────────────────────────

function showStatus(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  statusMessage.value = msg;
  statusType.value = type;
  setTimeout(() => { statusMessage.value = ''; }, 4000);
}

function getEncodingForType(type: NvsType): NvsEncoding {
  return TYPE_TO_ENCODING[type] ?? 'u8';
}

function formatValue(entry: NvsEntry): string {
  if (entry.value instanceof Uint8Array) {
    if (entry.value.length <= 32) {
      return Array.from(entry.value).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }
    return Array.from(entry.value.subarray(0, 32))
      .map(b => b.toString(16).padStart(2, '0')).join(' ') +
      ` ... (${entry.value.length} 字节)`;
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

/** Parse a value string based on encoding */
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
      return raw;
    case 'blob':
    case 'binary': {
      const hex = raw.replace(/\s/g, '');
      if (hex.length === 0) return new Uint8Array(0);
      if (hex.length % 2 !== 0) throw new Error(`十六进制字符串长度必须为偶数`);
      if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`十六进制字符串包含无效字符`);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }
    default:
      return raw;
  }
}

// ── Actions: CRUD ──────────────────────────────────────────────────

function handleAddEntry() {
  if (!newEntry.namespace || !newEntry.key) return;

  const type = ENCODING_TO_TYPE[newEntry.encoding];
  let value: ReturnType<typeof parseValueInput>;
  try {
    value = parseValueInput(newEntry.encoding, newEntry.value);
  } catch (e: any) {
    showStatus(e.message ?? '值格式错误', 'error');
    return;
  }

  partition.value = addEntry(partition.value, {
    namespace: newEntry.namespace,
    key: newEntry.key,
    type,
    value,
  });

  showAddDialog.value = false;
  newEntry.key = '';
  newEntry.value = '';
  showStatus('已添加记录', 'success');
}

function handleAddNamespace() {
  const ns = newNamespace.value.trim();
  if (!ns) return;
  if (partition.value.namespaces.includes(ns)) {
    showStatus('命名空间已存在', 'error');
    return;
  }
  partition.value = {
    ...partition.value,
    namespaces: [...partition.value.namespaces, ns],
  };
  showNsDialog.value = false;
  newNamespace.value = '';
  // Auto-select new namespace in add dialog
  newEntry.namespace = ns;
  showStatus(`已添加命名空间 "${ns}"`, 'success');
}

function handleDeleteEntry(entryId: string) {
  partition.value = removeEntry(partition.value, entryId);
}

function handleDuplicateEntry(entryId: string) {
  partition.value = duplicateEntry(partition.value, entryId);
  showStatus('已复制记录', 'success');
}

function handleSort() {
  partition.value = sortEntries(partition.value);
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
  // Reset value to sensible default when type changes
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

// ── Actions: File I/O ──────────────────────────────────────────────

async function handleOpenBinary(file: File): Promise<false> {
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    partition.value = parseBinary(data);
    // Auto-set target size to match file
    targetSize.value = data.byteLength;
    showStatus(`已加载 ${file.name} (${data.byteLength} 字节)`, 'success');
  } catch (e: any) {
    showStatus(`加载失败: ${e.message}`, 'error');
  }
  return false; // prevent el-upload auto-upload
}

function handleExportBinary() {
  try {
    const errs = validatePartition(partition.value);
    if (errs.length > 0) {
      showStatus(`验证错误: ${errs[0]}`, 'error');
      return;
    }
    const data = serializeBinary(partition.value, targetSize.value);
    downloadBlob(new Blob([data as Uint8Array<ArrayBuffer>]), 'nvs.bin');
    showStatus('已导出 nvs.bin', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
  }
}

async function handleMergeBinary(file: File): Promise<false> {
  try {
    const buffer = await file.arrayBuffer();
    const incoming = parseBinary(new Uint8Array(buffer));
    partition.value = mergePartitions(partition.value, incoming, mergeMode.value);
    showStatus(`已合并 ${file.name} (${incoming.entries.length} 条记录)`, 'success');
  } catch (e: any) {
    showStatus(`合并失败: ${e.message}`, 'error');
  }
  return false;
}

async function handleOpenCsv(file: File): Promise<false> {
  try {
    const text = await file.text();
    partition.value = parseCsv(text);
    showStatus(`已加载 ${file.name}`, 'success');
  } catch (e: any) {
    showStatus(`加载失败: ${e.message}`, 'error');
  }
  return false;
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

async function handleMergeCsv(file: File): Promise<false> {
  try {
    const text = await file.text();
    const incoming = parseCsv(text);
    partition.value = mergePartitions(partition.value, incoming, mergeMode.value);
    showStatus(`已合并 ${file.name} (${incoming.entries.length} 条记录)`, 'success');
  } catch (e: any) {
    showStatus(`合并失败: ${e.message}`, 'error');
  }
  return false;
}

async function handleBlobFileUpload(entryId: string, file: File): Promise<false> {
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    partition.value = updateEntry(partition.value, entryId, { value: data });
    showStatus(`已上传 ${file.name} (${data.length} 字节)`, 'success');
  } catch (e: any) {
    showStatus(`上传失败: ${e.message}`, 'error');
  }
  return false;
}
</script>

<template>
  <div>
    <!-- Status message -->
    <transition name="el-fade-in">
      <el-alert
        v-if="statusMessage"
        :title="statusMessage"
        :type="statusType"
        show-icon
        closable
        class="mb-3"
        @close="statusMessage = ''"
      />
    </transition>

    <!-- Validation errors -->
    <el-alert
      v-if="errors.length > 0"
      type="warning"
      show-icon
      class="mb-3"
      :closable="false"
    >
      <template #title>
        验证问题 ({{ errors.length }})
      </template>
      <div v-for="(err, i) in errors" :key="i" class="text-xs">{{ err }}</div>
    </el-alert>

    <!-- ── Toolbar ── -->
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <el-button type="primary" @click="showAddDialog = true">
        添加记录
      </el-button>
      <el-button @click="showNsDialog = true">
        添加命名空间
      </el-button>
      <el-button @click="handleSort">排序</el-button>
      <el-button type="danger" plain @click="handleClear">清空</el-button>

      <el-divider direction="vertical" />

      <span class="text-sm">分区大小:</span>
      <el-select v-model="targetSize" style="width: 160px;">
        <el-option
          v-for="opt in sizeOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>

      <el-divider direction="vertical" />

      <div class="flex items-center gap-2 min-w-[200px]">
        <el-progress
          :percentage="flashStats.usagePercent"
          :color="progressColor"
          :stroke-width="14"
          :show-text="false"
          style="flex: 1;"
        />
        <el-text size="small">
          {{ flashStats.usedEntries }} / {{ flashStats.maxEntries }} 条目
        </el-text>
      </div>
    </div>

    <!-- ── Filter row ── -->
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <el-select
        v-model="namespaceFilter"
        placeholder="全部命名空间"
        clearable
        style="width: 180px;"
      >
        <el-option
          v-for="ns in partition.namespaces"
          :key="ns"
          :label="ns"
          :value="ns"
        />
      </el-select>
      <el-input
        v-model="keySearch"
        placeholder="搜索键名..."
        clearable
        style="width: 200px;"
      />
    </div>

    <!-- ── Data table ── -->
    <el-table
      :data="filteredEntries"
      border
      stripe
      size="small"
      row-key="id"
      empty-text="暂无记录，请添加或导入数据"
      max-height="500"
    >
      <el-table-column label="命名空间" width="150">
        <template #default="{ row }">
          <el-select
            :model-value="row.namespace"
            size="small"
            @change="(val: string) => handleUpdateNamespace(row.id, val)"
          >
            <el-option
              v-for="ns in partition.namespaces"
              :key="ns"
              :label="ns"
              :value="ns"
            />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column label="键名" width="180">
        <template #default="{ row }">
          <el-input
            :model-value="row.key"
            size="small"
            :maxlength="MAX_KEY_LENGTH"
            @change="(val: string) => handleUpdateKey(row.id, val)"
          />
        </template>
      </el-table-column>

      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-select
            :model-value="getEncodingForType(row.type)"
            size="small"
            @change="(val: NvsEncoding) => handleUpdateEncoding(row.id, val)"
          >
            <el-option
              v-for="enc in ENCODING_OPTIONS"
              :key="enc"
              :label="enc"
              :value="enc"
            />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column label="值" min-width="250">
        <template #default="{ row }">
          <!-- Primitive types: input -->
          <el-input
            v-if="isPrimitiveType(row.type)"
            :model-value="String(row.value)"
            size="small"
            @change="(val: string) => handleUpdateValue(row.id, getEncodingForType(row.type), val)"
          />
          <!-- String type -->
          <el-input
            v-else-if="row.type === NvsType.SZ"
            :model-value="row.value as string"
            size="small"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 3 }"
            @change="(val: string) => handleUpdateValue(row.id, 'string', val)"
          />
          <!-- Blob types -->
          <div v-else class="flex items-center gap-1">
            <el-text size="small" class="font-mono" truncated>
              {{ formatValue(row) }}
            </el-text>
            <el-upload
              :before-upload="(file: File) => handleBlobFileUpload(row.id, file)"
              :show-file-list="false"
              accept="*/*"
            >
              <el-button size="small" type="info" plain>上传文件</el-button>
            </el-upload>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            text
            @click="handleDuplicateEntry(row.id)"
            title="复制"
          >
            复制
          </el-button>
          <el-popconfirm
            title="确定删除?"
            @confirm="handleDeleteEntry(row.id)"
          >
            <template #reference>
              <el-button size="small" text type="danger" title="删除">
                删除
              </el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <!-- ── Import/Export section ── -->
    <el-divider />
    <div class="flex flex-wrap gap-4">
      <!-- Binary -->
      <div>
        <el-text tag="b" class="block mb-2">二进制文件 (.bin)</el-text>
        <div class="flex flex-wrap gap-2">
          <el-upload :before-upload="handleOpenBinary" :show-file-list="false" accept=".bin">
            <el-button>打开</el-button>
          </el-upload>
          <el-button type="primary" @click="handleExportBinary">导出</el-button>
          <el-upload :before-upload="handleMergeBinary" :show-file-list="false" accept=".bin">
            <el-button>合并</el-button>
          </el-upload>
        </div>
      </div>

      <!-- CSV -->
      <div>
        <el-text tag="b" class="block mb-2">CSV文件 (.csv)</el-text>
        <div class="flex flex-wrap gap-2">
          <el-upload :before-upload="handleOpenCsv" :show-file-list="false" accept=".csv">
            <el-button>打开</el-button>
          </el-upload>
          <el-button type="primary" @click="handleExportCsv">导出</el-button>
          <el-upload :before-upload="handleMergeCsv" :show-file-list="false" accept=".csv">
            <el-button>合并</el-button>
          </el-upload>
        </div>
      </div>

      <!-- Merge options -->
      <div>
        <el-text tag="b" class="block mb-2">合并选项</el-text>
        <el-radio-group v-model="mergeMode">
          <el-radio value="overwrite">覆盖同名键</el-radio>
          <el-radio value="skip">跳过同名键</el-radio>
        </el-radio-group>
      </div>
    </div>

    <!-- ── Add entry dialog ── -->
    <el-dialog v-model="showAddDialog" title="添加记录" width="450px">
      <el-form label-width="80px">
        <el-form-item label="命名空间">
          <el-select v-model="newEntry.namespace" placeholder="选择命名空间">
            <el-option
              v-for="ns in partition.namespaces"
              :key="ns"
              :label="ns"
              :value="ns"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="键名">
          <el-input v-model="newEntry.key" :maxlength="MAX_KEY_LENGTH" placeholder="key name" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="newEntry.encoding">
            <el-option v-for="enc in ENCODING_OPTIONS" :key="enc" :label="enc" :value="enc" />
          </el-select>
        </el-form-item>
        <el-form-item label="值">
          <el-input
            v-model="newEntry.value"
            :type="newEntry.encoding === 'string' ? 'textarea' : 'text'"
            placeholder="value"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAddEntry" :disabled="!newEntry.namespace || !newEntry.key">
          添加
        </el-button>
      </template>
    </el-dialog>

    <!-- ── Add namespace dialog ── -->
    <el-dialog v-model="showNsDialog" title="添加命名空间" width="400px">
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input
            v-model="newNamespace"
            :maxlength="MAX_KEY_LENGTH"
            placeholder="namespace name"
            @keyup.enter="handleAddNamespace"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNsDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAddNamespace" :disabled="!newNamespace.trim()">
          添加
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'Courier New', Courier, monospace;
}
</style>
