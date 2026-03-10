<script setup lang="ts">
import { ref } from 'vue';
import {
  type AppImageInfo,
  SPI_FLASH_MODE_NAMES, SPI_FLASH_SPEED_NAMES, SPI_FLASH_SIZE_NAMES,
  parseAppImage,
} from '../../lib/app-image';
import { computeFieldRanges, type FieldGroup } from '../../lib/app-image/ranges';
import HexDump from './HexDump.vue';
import HexFieldPanel from './HexFieldPanel.vue';

const props = defineProps<{
  isDark?: boolean;
}>();

const imageInfo = ref<AppImageInfo | null>(null);
const rawData = ref<Uint8Array | null>(null);
const showHex = ref(false);
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'info'>('info');
const fileName = ref('');
const fieldGroups = ref<FieldGroup[]>([]);
const activeRange = ref<{ start: number; end: number } | null>(null);
const hexDumpRef = ref<InstanceType<typeof HexDump> | null>(null);

let statusTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  statusMessage.value = msg;
  statusType.value = type;
  statusTimer = setTimeout(() => {
    statusMessage.value = '';
    statusTimer = null;
  }, 4000);
}

function formatHex(val: number): string {
  return '0x' + val.toString(16).toUpperCase();
}

function formatSha256(data: Uint8Array): string {
  // Check if all zeros (not computed)
  if (data.every(b => b === 0)) return '(未计算)';
  return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
}

function onByteHover(offset: number | null) {
  if (offset === null) { activeRange.value = null; return; }
  // Pass 1: named field match (checked across all groups first)
  for (const g of fieldGroups.value) {
    const f = g.fields.find(f => offset >= f.start && offset < f.end);
    if (f) { activeRange.value = { start: f.start, end: f.end }; return; }
  }
  // Pass 2: data-only group (segment data blobs)
  for (const g of fieldGroups.value) {
    if (g.fields.length === 0 && offset >= g.start && offset < g.end) {
      activeRange.value = { start: g.start, end: g.end }; return;
    }
  }
  activeRange.value = null;
}

function onFieldSelect(range: { start: number; end: number }) {
  activeRange.value = range;
  hexDumpRef.value?.scrollTo(range.start);
}

async function handleOpenFile(file: File): Promise<false> {
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    if (data.length >= 4 &&
        data[0] === 0x7F && data[1] === 0x45 && data[2] === 0x4C && data[3] === 0x46) {
      throw new Error('ELF 格式不支持。请使用 esptool.py elf2image 将其转换为 .bin 文件');
    }
    imageInfo.value = parseAppImage(data);
    rawData.value = data;
    fieldGroups.value = computeFieldRanges(data, imageInfo.value);
    activeRange.value = null;
    showHex.value = false;
    fileName.value = file.name;
    showStatus(`已加载 ${file.name} (${data.byteLength} 字节)`, 'success');
  } catch (e: any) {
    imageInfo.value = null;
    showStatus(`加载失败: ${e.message}`, 'error');
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

    <!-- Upload -->
    <div class="mb-4">
      <el-upload :before-upload="handleOpenFile" :show-file-list="false" accept=".bin">
        <el-button type="primary">打开固件文件</el-button>
      </el-upload>
    </div>

    <template v-if="imageInfo">
      <!-- App Description -->
      <template v-if="imageInfo.appDescription">
        <el-text tag="b" class="block mb-2">应用信息</el-text>
        <el-descriptions :column="2" border size="small" class="mb-4">
          <el-descriptions-item label="项目名称">{{ imageInfo.appDescription.projectName }}</el-descriptions-item>
          <el-descriptions-item label="版本">{{ imageInfo.appDescription.version }}</el-descriptions-item>
          <el-descriptions-item label="IDF版本">{{ imageInfo.appDescription.idfVersion }}</el-descriptions-item>
          <el-descriptions-item label="安全版本">{{ imageInfo.appDescription.secureVersion }}</el-descriptions-item>
          <el-descriptions-item label="编译日期">{{ imageInfo.appDescription.compileDate }}</el-descriptions-item>
          <el-descriptions-item label="编译时间">{{ imageInfo.appDescription.compileTime }}</el-descriptions-item>
          <el-descriptions-item label="ELF SHA256" :span="2">
            <el-text size="small" class="font-mono break-all">
              {{ formatSha256(imageInfo.appDescription.appElfSha256) }}
            </el-text>
          </el-descriptions-item>
        </el-descriptions>
      </template>

      <!-- Image Header -->
      <el-text tag="b" class="block mb-2">镜像头</el-text>
      <el-descriptions :column="2" border size="small" class="mb-4">
        <el-descriptions-item label="芯片">{{ imageInfo.chipName }}</el-descriptions-item>
        <el-descriptions-item label="入口地址">{{ formatHex(imageInfo.header.entryPoint) }}</el-descriptions-item>
        <el-descriptions-item label="SPI模式">{{ SPI_FLASH_MODE_NAMES[imageInfo.header.spiMode] ?? formatHex(imageInfo.header.spiMode) }}</el-descriptions-item>
        <el-descriptions-item label="SPI速度">{{ SPI_FLASH_SPEED_NAMES[imageInfo.header.spiSpeed] ?? formatHex(imageInfo.header.spiSpeed) }}</el-descriptions-item>
        <el-descriptions-item label="Flash大小">{{ SPI_FLASH_SIZE_NAMES[imageInfo.header.spiSize] ?? formatHex(imageInfo.header.spiSize) }}</el-descriptions-item>
        <el-descriptions-item label="段数">{{ imageInfo.header.segmentCount }}</el-descriptions-item>
        <el-descriptions-item label="WP引脚">{{ formatHex(imageInfo.extendedHeader.wpPin) }}</el-descriptions-item>
        <el-descriptions-item label="SPI引脚驱动">{{ imageInfo.extendedHeader.spiPinDrv.map(formatHex).join(' / ') }}</el-descriptions-item>
        <el-descriptions-item label="最小芯片版本">{{ imageInfo.extendedHeader.minChipRevFull / 100 }}</el-descriptions-item>
        <el-descriptions-item label="最大芯片版本">{{ imageInfo.extendedHeader.maxChipRevFull === 0xFFFF ? '不限' : imageInfo.extendedHeader.maxChipRevFull / 100 }}</el-descriptions-item>
        <el-descriptions-item label="附加哈希" :span="imageInfo.extendedHeader.hashAppended ? 2 : 1">
          {{ imageInfo.extendedHeader.hashAppended ? '是' : '否' }}
          <el-text v-if="imageInfo.extendedHeader.hashAppended && rawData"
                   size="small" class="font-mono" style="margin-left:8px">
            {{ formatSha256(rawData.slice(-32)) }}
          </el-text>
        </el-descriptions-item>
      </el-descriptions>

      <!-- Segments -->
      <el-text tag="b" class="block mb-2">段列表</el-text>
      <el-table :data="imageInfo.segments" border stripe size="small" max-height="300">
        <el-table-column label="#" width="50" type="index" />
        <el-table-column label="加载地址" width="160">
          <template #default="{ row }">{{ formatHex(row.loadAddr) }}</template>
        </el-table-column>
        <el-table-column label="数据大小">
          <template #default="{ row }">
            {{ row.dataLen }} 字节 ({{ (row.dataLen / 1024).toFixed(1) }} KB)
          </template>
        </el-table-column>
      </el-table>

      <!-- Hex dump -->
      <div class="mt-3">
        <el-button size="small" @click="showHex = !showHex">
          {{ showHex ? '隐藏原始字节' : '查看原始字节' }}
        </el-button>
        <template v-if="showHex && rawData">
          <HexFieldPanel
            :groups="fieldGroups"
            :activeRange="activeRange"
            class="mt-2"
            @select="onFieldSelect"
          />
          <HexDump
            ref="hexDumpRef"
            :data="rawData"
            :height="400"
            :highlight="activeRange"
            class="mt-1"
            @byte-hover="onByteHover"
          />
        </template>
      </div>
    </template>

    <el-empty v-else description="请打开一个ESP32固件文件 (.bin)" />
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'Courier New', Courier, monospace;
}
.break-all {
  word-break: break-all;
}
</style>
