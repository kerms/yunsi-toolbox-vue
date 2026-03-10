import { readU32 } from '../shared/binary-reader';
import {
  IMAGE_HEADER_SIZE, EXTENDED_HEADER_SIZE, SEGMENT_HEADER_SIZE,
  APP_DESC_MAGIC, APP_DESC_SIZE,
} from './constants';
import {
  SPI_FLASH_MODE_NAMES, SPI_FLASH_SPEED_NAMES, SPI_FLASH_SIZE_NAMES,
} from './types';
import type { AppImageInfo } from './types';

export interface FieldDef {
  label: string;
  start: number;
  end: number;    // exclusive
  value: string;
}

export interface FieldGroup {
  label: string;
  start: number;
  end: number;    // exclusive
  fields: FieldDef[];
}

function h(n: number, pad = 2): string {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

export function computeFieldRanges(data: Uint8Array, info: AppImageInfo): FieldGroup[] {
  const groups: FieldGroup[] = [];

  // ── Image Header (bytes 0–7) ──
  const spiSpeedSize = data[3];
  groups.push({
    label: '镜像头 (Image Header)',
    start: 0,
    end: IMAGE_HEADER_SIZE,
    fields: [
      { label: 'magic',        start: 0, end: 1, value: h(info.header.magic) },
      { label: 'segmentCount', start: 1, end: 2, value: String(info.header.segmentCount) },
      { label: 'spiMode',      start: 2, end: 3, value: SPI_FLASH_MODE_NAMES[info.header.spiMode] ?? h(info.header.spiMode) },
      {
        label: 'spiSpeed / spiSize',
        start: 3,
        end: 4,
        value: `${SPI_FLASH_SPEED_NAMES[info.header.spiSpeed] ?? h(spiSpeedSize & 0x0F)} / ${SPI_FLASH_SIZE_NAMES[info.header.spiSize] ?? h((spiSpeedSize >> 4) & 0x0F)}`,
      },
      { label: 'entryPoint', start: 4, end: 8, value: h(info.header.entryPoint, 8) },
    ],
  });

  // ── Extended Header (bytes 8–23) ──
  const extOff = IMAGE_HEADER_SIZE;
  groups.push({
    label: '扩展头 (Extended Header)',
    start: extOff,
    end: extOff + EXTENDED_HEADER_SIZE,
    fields: [
      { label: 'wpPin',         start: extOff,      end: extOff + 1,  value: h(info.extendedHeader.wpPin) },
      { label: 'spiPinDrv[0]', start: extOff + 1,  end: extOff + 2,  value: h(info.extendedHeader.spiPinDrv[0]) },
      { label: 'spiPinDrv[1]', start: extOff + 2,  end: extOff + 3,  value: h(info.extendedHeader.spiPinDrv[1]) },
      { label: 'spiPinDrv[2]', start: extOff + 3,  end: extOff + 4,  value: h(info.extendedHeader.spiPinDrv[2]) },
      { label: 'chipId',        start: extOff + 4,  end: extOff + 6,  value: `${h(info.extendedHeader.chipId, 4)} (${info.chipName})` },
      { label: 'minChipRev',    start: extOff + 6,  end: extOff + 7,  value: h(info.extendedHeader.minChipRev) },
      { label: 'minChipRevFull',start: extOff + 7,  end: extOff + 9,  value: String(info.extendedHeader.minChipRevFull / 100) },
      { label: 'maxChipRevFull',start: extOff + 9,  end: extOff + 11, value: info.extendedHeader.maxChipRevFull === 0xFFFF ? '不限' : String(info.extendedHeader.maxChipRevFull / 100) },
      { label: 'reserved',      start: extOff + 11, end: extOff + 15, value: '(reserved)' },
      { label: 'hashAppended',  start: extOff + 15, end: extOff + 16, value: info.extendedHeader.hashAppended ? '是' : '否' },
    ],
  });

  // ── Segments ──
  let segOff = IMAGE_HEADER_SIZE + EXTENDED_HEADER_SIZE;
  for (let i = 0; i < info.segments.length; i++) {
    const seg = info.segments[i];
    const hdrEnd = segOff + SEGMENT_HEADER_SIZE;
    const dataEnd = hdrEnd + seg.dataLen;

    groups.push({
      label: `段 ${i} 头 (Segment ${i} Header)`,
      start: segOff,
      end: hdrEnd,
      fields: [
        { label: 'loadAddr', start: segOff,     end: segOff + 4, value: h(seg.loadAddr, 8) },
        { label: 'dataLen',  start: segOff + 4, end: hdrEnd,     value: `${seg.dataLen} 字节` },
      ],
    });

    groups.push({
      label: `段 ${i} 数据 (Segment ${i} Data)`,
      start: hdrEnd,
      end: dataEnd,
      fields: [],
    });

    segOff = dataEnd;
  }

  // ── App Description — walk segments to find the offset ──
  if (info.appDescription) {
    let appDescOff: number | null = null;
    let scanOff = IMAGE_HEADER_SIZE + EXTENDED_HEADER_SIZE;
    for (const seg of info.segments) {
      const dataOff = scanOff + SEGMENT_HEADER_SIZE;
      if (dataOff + 4 <= data.length && readU32(data, dataOff) === APP_DESC_MAGIC) {
        appDescOff = dataOff;
        break;
      }
      scanOff = dataOff + seg.dataLen;
    }

    if (appDescOff !== null) {
      const o = appDescOff;
      const d = info.appDescription;
      groups.push({
        label: '应用信息 (App Description)',
        start: o,
        end: o + APP_DESC_SIZE,
        fields: [
          { label: 'magicWord',     start: o,       end: o + 4,   value: h(d.magicWord, 8) },
          { label: 'secureVersion', start: o + 4,   end: o + 8,   value: String(d.secureVersion) },
          { label: 'version',       start: o + 16,  end: o + 48,  value: d.version },
          { label: 'projectName',   start: o + 48,  end: o + 80,  value: d.projectName },
          { label: 'compileTime',   start: o + 80,  end: o + 96,  value: d.compileTime },
          { label: 'compileDate',   start: o + 96,  end: o + 112, value: d.compileDate },
          { label: 'idfVersion',    start: o + 112, end: o + 144, value: d.idfVersion },
          { label: 'appElfSha256',  start: o + 144, end: o + 176, value: Array.from(d.appElfSha256).map(b => b.toString(16).padStart(2, '0')).join('') },
        ],
      });
    }
  }

  // ── Appended SHA256 ──
  if (info.extendedHeader.hashAppended && data.length >= 32) {
    groups.push({
      label: '附加 SHA256 (Appended Hash)',
      start: data.length - 32,
      end: data.length,
      fields: [
        {
          label: 'sha256',
          start: data.length - 32,
          end: data.length,
          value: Array.from(data.slice(-32)).map(b => b.toString(16).padStart(2, '0')).join(''),
        },
      ],
    });
  }

  return groups;
}
