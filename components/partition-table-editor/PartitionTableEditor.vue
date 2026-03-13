<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Plus, FolderOpened, Download, ArrowDown, Top, Bottom } from '@element-plus/icons-vue';
import {
  type PartitionTable, type PartitionEntry,
  PartitionType, PartitionFlags,
  TYPE_NAMES, NAME_TO_TYPE,
  getSubtypeName, subtypeFromName,
  AppSubtype, DataSubtype,
  APP_SUBTYPE_NAMES, DATA_SUBTYPE_NAMES,
  parseBinary, serializeBinary,
  parseCsv, serializeCsv,
  validateTable,
  NAME_FIELD_SIZE,
} from '../../lib/partition-table';

const props = defineProps<{
  isDark?: boolean;
}>();

// ── Core state ─────────────────────────────────────────────────────

const table = ref<PartitionTable>({ entries: [], md5Valid: false });

const openInput = ref<HTMLInputElement>();

// Add dialog
const showAddDialog = ref(false);
const newEntry = ref<PartitionEntry>({
  name: '',
  type: PartitionType.DATA,
  subtype: DataSubtype.NVS,
  offset: 0,
  size: 0x1000,
  flags: PartitionFlags.NONE,
});

// ── Computed ───────────────────────────────────────────────────────

const subtypeOptions = computed(() => {
  return newEntry.value.type === PartitionType.APP
    ? Object.entries(APP_SUBTYPE_NAMES)
    : Object.entries(DATA_SUBTYPE_NAMES);
});

function getSubtypeOptionsForType(type: PartitionType) {
  return type === PartitionType.APP
    ? Object.entries(APP_SUBTYPE_NAMES)
    : Object.entries(DATA_SUBTYPE_NAMES);
}

// ── Helpers ────────────────────────────────────────────────────────

function showStatus(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  ElMessage({ message: msg, type, duration: 4000, showClose: true });
}

function formatHex(val: number): string {
  return '0x' + val.toString(16).toUpperCase();
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024 && size % (1024 * 1024) === 0) {
    return `${size / (1024 * 1024)} MB`;
  }
  if (size >= 1024 && size % 1024 === 0) {
    return `${size / 1024} KB`;
  }
  return `${size} B`;
}

function parseHexOrDec(str: string): number {
  str = str.trim();
  if (str.startsWith('0x') || str.startsWith('0X')) {
    if (!/^0x[0-9a-f]+$/i.test(str)) throw new Error(`"${str}"`);
    const v = parseInt(str, 16);
    if (isNaN(v) || v < 0 || v > 0xFFFF_FFFF) throw new Error(`"${str}"`);
    return v;
  }
  // Support K/M suffixes
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([KkMm])?$/);
  if (match) {
    const num = parseFloat(match[1]);
    const unit = (match[2] || '').toUpperCase();
    let result: number;
    if (unit === 'K') result = Math.floor(num * 1024);
    else if (unit === 'M') result = Math.floor(num * 1024 * 1024);
    else result = Math.floor(num);
    if (result > 0xFFFF_FFFF) throw new Error(`"${str}" (超出 32 位范围)`);
    return result;
  }
  throw new Error(`"${str}"`);
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

// ── Actions ────────────────────────────────────────────────────────

function handleAddEntry() {
  if (!newEntry.value.name) return;
  table.value = {
    ...table.value,
    entries: [...table.value.entries, { ...newEntry.value }],
  };
  showAddDialog.value = false;
  newEntry.value = {
    name: '',
    type: PartitionType.DATA,
    subtype: DataSubtype.NVS,
    offset: 0,
    size: 0x1000,
    flags: PartitionFlags.NONE,
  };
  showStatus('已添加分区', 'success');
}

function handleDeleteEntry(index: number) {
  const entries = [...table.value.entries];
  entries.splice(index, 1);
  table.value = { ...table.value, entries };
}

function handleMoveUp(index: number) {
  if (index <= 0) return;
  const entries = [...table.value.entries];
  [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
  table.value = { ...table.value, entries };
}

function handleMoveDown(index: number) {
  if (index >= table.value.entries.length - 1) return;
  const entries = [...table.value.entries];
  [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
  table.value = { ...table.value, entries };
}

function handleUpdateName(index: number, val: string) {
  const entries = [...table.value.entries];
  entries[index] = { ...entries[index], name: val.substring(0, NAME_FIELD_SIZE - 1) };
  table.value = { ...table.value, entries };
}

function handleUpdateType(index: number, val: PartitionType) {
  const entries = [...table.value.entries];
  // Reset subtype when type changes
  const defaultSubtype = val === PartitionType.APP ? AppSubtype.FACTORY : DataSubtype.NVS;
  entries[index] = { ...entries[index], type: val, subtype: defaultSubtype };
  table.value = { ...table.value, entries };
}

function handleUpdateSubtype(index: number, val: number) {
  const entries = [...table.value.entries];
  entries[index] = { ...entries[index], subtype: val };
  table.value = { ...table.value, entries };
}

function handleUpdateOffset(index: number, val: string) {
  try {
    const entries = [...table.value.entries];
    entries[index] = { ...entries[index], offset: parseHexOrDec(val) };
    table.value = { ...table.value, entries };
  } catch (e: any) {
    showStatus(`无效的偏移量: ${e.message}`, 'error');
  }
}

function handleUpdateSize(index: number, val: string) {
  try {
    const entries = [...table.value.entries];
    entries[index] = { ...entries[index], size: parseHexOrDec(val) };
    table.value = { ...table.value, entries };
  } catch (e: any) {
    showStatus(`无效的大小: ${e.message}`, 'error');
  }
}

function handleUpdateFlags(index: number, encrypted: boolean) {
  const entries = [...table.value.entries];
  const cur = entries[index].flags;
  entries[index] = { ...entries[index], flags: encrypted
    ? cur | PartitionFlags.ENCRYPTED
    : cur & ~PartitionFlags.ENCRYPTED };
  table.value = { ...table.value, entries };
}

function handleClear() {
  table.value = { entries: [], md5Valid: false };
  showStatus('已清空分区表', 'info');
}

// ── File I/O ───────────────────────────────────────────────────────

async function detectFileType(file: File): Promise<'bin' | 'csv' | null> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'bin') return 'bin';
  if (ext === 'csv') return 'csv';
  // Fallback: magic byte for partition table binary is 0xAA 0x50.
  if (file.size >= 2) {
    const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (header[0] === 0xAA && header[1] === 0x50) return 'bin';
  }
  // Ambiguous: ask user
  try {
    await ElMessageBox.confirm(
      `无法确定 "${file.name}" 的格式。请选择打开方式：`,
      '选择格式',
      { confirmButtonText: '二进制 (BIN)', cancelButtonText: 'CSV 文本', distinguishCancelAndClose: true },
    );
    return 'bin';
  } catch (action) {
    if (action === 'cancel') return 'csv';
    return null; // dialog dismissed (Esc / X) → abort
  }
}

async function onOpenChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;

  const type = await detectFileType(file);
  if (!type) return; // user dismissed
  if (type === 'bin') {
    await handleOpenBinary(file);
  } else {
    await handleOpenCsv(file);
  }
}

async function handleOpenBinary(file: File) {
  try {
    const buffer = await file.arrayBuffer();
    table.value = parseBinary(new Uint8Array(buffer));
    const md5Status = table.value.md5Valid ? '有效' : '无效/缺失';
    const corruptedNote = table.value.corrupted ? ', 检测到二进制损坏' : '';
    showStatus(
      `已加载 ${file.name} (${table.value.entries.length} 分区, MD5: ${md5Status}${corruptedNote})`,
      table.value.corrupted ? 'error' : 'success',
    );
  } catch (e: any) {
    showStatus(`加载失败: ${e.message}`, 'error');
  }
}

function handleExportBinary() {
  const errors = validateTable(table.value);
  if (errors.length > 0) {
    const suffix = errors.length > 1 ? ` 等 ${errors.length} 个问题` : '';
    showStatus(`导出取消: ${errors[0].message}${suffix}`, 'error');
    return;
  }
  try {
    const data = serializeBinary(table.value);
    downloadBlob(new Blob([data as Uint8Array<ArrayBuffer>]), 'partitions.bin');
    showStatus('已导出 partitions.bin', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
  }
}

async function handleOpenCsv(file: File) {
  try {
    const text = await file.text();
    const warnings: string[] = [];
    table.value = parseCsv(text, (line, msg) => warnings.push(`行 ${line}: ${msg}`));
    if (warnings.length > 0) {
      const preview = warnings.slice(0, 2).join('; ') + (warnings.length > 2 ? '…' : '');
      showStatus(`已加载 ${file.name} (${table.value.entries.length} 分区，${warnings.length} 个警告: ${preview})`, 'error');
    } else {
      showStatus(`已加载 ${file.name} (${table.value.entries.length} 分区)`, 'success');
    }
  } catch (e: any) {
    showStatus(`加载失败: ${e.message}`, 'error');
  }
}

function handleExportCsv() {
  try {
    const text = serializeCsv(table.value);
    downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), 'partitions.csv');
    showStatus('已导出 partitions.csv', 'success');
  } catch (e: any) {
    showStatus(`导出失败: ${e.message}`, 'error');
  }
}
</script>

<template>
  <div class="partition-table-editor-container">
    <!-- Hidden file input -->
    <input ref="openInput" type="file" accept=".bin,.csv" style="display:none" @change="onOpenChange" />

    <!-- ── Main Action Toolbar ── -->
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-3">
        <el-button type="danger" plain :icon="Delete" @click="handleClear">清空数据</el-button>
        <el-button type="primary" plain :icon="Plus" @click="showAddDialog = true">添加分区</el-button>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <!-- Import / Export -->
        <el-button type="primary" plain :icon="FolderOpened" @click="openInput?.click()">打开(覆盖)</el-button>

        <el-dropdown trigger="click">
          <el-button type="primary" :icon="Download">
            导出 <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="handleExportBinary">导出为 BIN</el-dropdown-item>
              <el-dropdown-item @click="handleExportCsv">导出为 CSV</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- ── Data Table Card ── -->
    <el-card shadow="never" class="nvs-table-card" :body-style="{ padding: '0px' }">
      <div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-b nvs-card-header">
        <span class="text-[14px] font-semibold text-gray-700">分区列表 <span class="font-normal text-gray-500 ml-1">({{ table.entries.length }} 条)</span></span>
      </div>

      <el-table
      :data="table.entries"
      stripe
      size="default"
      empty-text="暂无分区，请添加或导入"
      max-height="600"
      class="w-full"
    >
      <el-table-column label="名称" width="160">
        <template #default="{ row, $index }">
          <el-input
            :model-value="row.name"
            class="nvs-seamless-input"
            :maxlength="15"
            @change="(val: string) => handleUpdateName($index, val)"
          />
        </template>
      </el-table-column>

      <el-table-column label="类型" width="120">
        <template #default="{ row, $index }">
          <el-select
            :model-value="row.type"
            class="nvs-seamless-select"
            @change="(val: PartitionType) => handleUpdateType($index, val)"
          >
            <el-option label="app" :value="PartitionType.APP" />
            <el-option label="data" :value="PartitionType.DATA" />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column label="子类型" width="150">
        <template #default="{ row, $index }">
          <el-select
            :model-value="row.subtype"
            class="nvs-seamless-select"
            @change="(val: number) => handleUpdateSubtype($index, val)"
          >
            <el-option
              v-for="[val, name] in getSubtypeOptionsForType(row.type)"
              :key="val"
              :label="name"
              :value="Number(val)"
            />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column label="偏移量" width="160">
        <template #default="{ row, $index }">
          <el-input
            :model-value="formatHex(row.offset)"
            class="nvs-seamless-input"
            @change="(val: string) => handleUpdateOffset($index, val)"
          />
        </template>
      </el-table-column>

      <el-table-column label="大小" width="180">
        <template #default="{ row, $index }">
          <el-input
            :model-value="formatHex(row.size)"
            class="nvs-seamless-input text-mono"
            @change="(val: string) => handleUpdateSize($index, val)"
          >
            <template #suffix>
              <span class="text-xs text-gray-500 mr-1">{{ formatSize(row.size) }}</span>
            </template>
          </el-input>
        </template>
      </el-table-column>

      <el-table-column label="加密" width="80" align="center">
        <template #default="{ row, $index }">
          <el-checkbox
            :model-value="(row.flags & 0x01) !== 0"
            @change="(val: boolean) => handleUpdateFlags($index, val)"
          />
        </template>
      </el-table-column>

      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ $index }">
          <div class="flex items-center">
            <el-button type="primary" link size="small" :icon="Top" @click="handleMoveUp($index)" :disabled="$index === 0" title="上移" />
            <el-button type="primary" link size="small" :icon="Bottom" @click="handleMoveDown($index)" :disabled="$index === table.entries.length - 1" title="下移" />
            <el-popconfirm title="确定删除?" @confirm="handleDeleteEntry($index)">
              <template #reference>
                <el-button type="danger" link size="small" :icon="Delete" title="删除" />
              </template>
            </el-popconfirm>
          </div>
        </template>
      </el-table-column>
    </el-table>
    </el-card>

    <!-- ── Add partition dialog ── -->
    <el-dialog v-model="showAddDialog" title="添加分区" width="450px">
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="newEntry.name" :maxlength="15" placeholder="partition name" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="newEntry.type">
            <el-option label="app" :value="PartitionType.APP" />
            <el-option label="data" :value="PartitionType.DATA" />
          </el-select>
        </el-form-item>
        <el-form-item label="子类型">
          <el-select v-model="newEntry.subtype">
            <el-option
              v-for="[val, name] in subtypeOptions"
              :key="val"
              :label="name"
              :value="Number(val)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="偏移量">
          <el-input
            :model-value="formatHex(newEntry.offset)"
            @change="(val: string) => { try { newEntry.offset = parseHexOrDec(val) } catch { showStatus('无效的偏移量', 'error') } }"
            placeholder="0x9000"
          />
        </el-form-item>
        <el-form-item label="大小">
          <el-input
            :model-value="formatHex(newEntry.size)"
            @change="(val: string) => { try { newEntry.size = parseHexOrDec(val) } catch { showStatus('无效的大小', 'error') } }"
            placeholder="0x6000 or 24K"
          />
        </el-form-item>
        <el-form-item label="加密">
          <el-checkbox
            :model-value="(newEntry.flags & PartitionFlags.ENCRYPTED) !== 0"
            @change="(val: boolean) => newEntry.flags = val
              ? newEntry.flags | PartitionFlags.ENCRYPTED
              : newEntry.flags & ~PartitionFlags.ENCRYPTED"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAddEntry" :disabled="!newEntry.name">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
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
.nvs-seamless-select :deep(.el-input__wrapper) {
  box-shadow: none !important;
  background-color: transparent;
  padding: 0 8px;
}

.nvs-seamless-input :deep(.el-input__wrapper:hover),
.nvs-seamless-select :deep(.el-input__wrapper:hover),
.nvs-seamless-input :deep(.el-input__wrapper.is-focus),
.nvs-seamless-select :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
  background-color: var(--vp-c-bg);
  border-radius: 4px;
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
.text-mono :deep(.el-input__inner) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
}
</style>
