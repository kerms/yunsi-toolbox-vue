import { readU8, readU16, readU32, readNullTermString } from '../shared/binary-reader';
import type {
  AppImageInfo, ImageHeader, ExtendedHeader, SegmentHeader, AppDescription,
} from './types';
import {
  IMAGE_MAGIC, IMAGE_HEADER_SIZE, EXTENDED_HEADER_SIZE,
  SEGMENT_HEADER_SIZE, APP_DESC_MAGIC, APP_DESC_SIZE, CHIP_ID_NAMES,
} from './constants';

/**
 * Parse an ESP32 app image binary.
 * Read-only parser — extracts headers, segment info, and app description.
 *
 * @param data Raw binary data of the app image
 */
export function parseAppImage(data: Uint8Array): AppImageInfo {
  if (data.length < IMAGE_HEADER_SIZE + EXTENDED_HEADER_SIZE) {
    throw new Error(`数据太短: ${data.length} 字节 (最少需要 ${IMAGE_HEADER_SIZE + EXTENDED_HEADER_SIZE} 字节)`);
  }

  // ── Image Header (8 bytes: magic + segments + spi_mode + spi_speed_size + entry_addr) ──
  const magic = readU8(data, 0);
  if (magic !== IMAGE_MAGIC) {
    throw new Error(`无效的魔数: 0x${magic.toString(16)} (应为 0xE9)`);
  }

  const segmentCount = readU8(data, 1);
  const spiModeRaw = readU8(data, 2);
  const spiSpeedSize = readU8(data, 3);
  const entryPoint = readU32(data, 4);

  const header: ImageHeader = {
    magic,
    segmentCount,
    spiMode: spiModeRaw,
    spiSpeed: spiSpeedSize & 0x0F,
    spiSize: (spiSpeedSize >> 4) & 0x0F,
    entryPoint,
  };

  // ── Extended Header (16 bytes at offset 8) ──
  const extOff = IMAGE_HEADER_SIZE;
  const wpPin = readU8(data, extOff);          // +0  = offset 8
  const chipId = readU16(data, extOff + 4);    // +4  = offset 12
  const minChipRev = readU8(data, extOff + 6); // +6  = offset 14
  const minChipRevFull = readU16(data, extOff + 7);  // +7  = offset 15 (packed)
  const maxChipRevFull = readU16(data, extOff + 9);  // +9  = offset 17 (packed)
  const hashAppended = readU8(data, extOff + 15) === 1; // +15 = offset 23

  const extendedHeader: ExtendedHeader = {
    wpPin,
    spiPinDrv: [readU8(data, extOff + 1), readU8(data, extOff + 2), readU8(data, extOff + 3)],
    chipId,
    minChipRev,
    minChipRevFull,
    maxChipRevFull,
    hashAppended,
  };

  // ── Segment Headers ──
  const segments: SegmentHeader[] = [];
  // Track each segment's data start offset internally (not exposed in public API)
  const segDataOffsets: number[] = [];
  let segOff = IMAGE_HEADER_SIZE + EXTENDED_HEADER_SIZE;

  for (let i = 0; i < segmentCount && segOff + SEGMENT_HEADER_SIZE <= data.length; i++) {
    const loadAddr = readU32(data, segOff);
    const dataLen = readU32(data, segOff + 4);
    const dataOffset = segOff + SEGMENT_HEADER_SIZE;
    if (dataOffset + dataLen > data.length) break; // truncated image
    segments.push({ loadAddr, dataLen });
    segDataOffsets.push(dataOffset);
    segOff = dataOffset + dataLen; // advance past segment data
  }

  // ── App Description — scan all segments for APP_DESC_MAGIC ──
  let appDescription: AppDescription | null = null;
  for (const off of segDataOffsets) {
    if (off + 4 > data.length) continue;
    const descMagic = readU32(data, off);
    if (descMagic === APP_DESC_MAGIC && off + APP_DESC_SIZE <= data.length) {
      appDescription = {
        magicWord: descMagic,
        secureVersion: readU32(data, off + 4),
        version: readNullTermString(data, off + 16, 32),
        projectName: readNullTermString(data, off + 48, 32),
        compileTime: readNullTermString(data, off + 80, 16),
        compileDate: readNullTermString(data, off + 96, 16),
        idfVersion: readNullTermString(data, off + 112, 32),
        appElfSha256: new Uint8Array(data.subarray(off + 144, off + 176)),
      };
      break;
    }
  }

  return {
    header,
    extendedHeader,
    segments,
    appDescription,
    valid: segments.length === segmentCount, // false if image was truncated mid-segment
    chipName: CHIP_ID_NAMES[chipId] ?? `Unknown (0x${chipId.toString(16)})`,
  };
}
