import type { NvsPartition } from './types';
import { NvsType, NvsVersion, PageState } from './types';
import {
  PAGE_SIZE, PAGE_HEADER_SIZE, BITMAP_OFFSET, BITMAP_SIZE,
  FIRST_ENTRY_OFFSET, ENTRY_SIZE, ENTRIES_PER_PAGE,
  KEY_FIELD_SIZE, MIN_PARTITION_SIZE,
} from './constants';
import { crc32 } from '../shared/crc32';
import {
  writeU8, writeU16, writeU32, writeI8, writeI16, writeI32,
  writeU64, writeI64, writeNullTermString,
} from '../shared/binary-writer';

// ── Entry CRC (over bytes [0..3] + [8..31], skipping CRC at [4..7]) ──

function computeEntryCrc(entryBuf: Uint8Array, entryOff: number): number {
  const crcData = new Uint8Array(28);
  crcData.set(entryBuf.subarray(entryOff, entryOff + 4), 0);
  crcData.set(entryBuf.subarray(entryOff + 8, entryOff + 32), 4);
  return crc32(crcData);
}

// ── Page header CRC (over bytes [4..28]) ───────────────────────────

function computePageHeaderCrc(page: Uint8Array, pageOff: number): number {
  return crc32(page.subarray(pageOff + 4, pageOff + 28));
}

// ── Bitmap: set entry state to WRITTEN ─────────────────────────────

function setEntryWritten(page: Uint8Array, pageOff: number, entryIndex: number) {
  // WRITTEN = 0b10, EMPTY = 0b11
  // Clear bit 0 of the 2-bit pair
  const bitPos = entryIndex * 2;
  const byteIdx = BITMAP_OFFSET + Math.floor(bitPos / 8);
  const bitOff = bitPos % 8;
  page[pageOff + byteIdx] &= ~(1 << bitOff);
}

// ── Planned entry to write ─────────────────────────────────────────

interface PlannedEntry {
  nsIndex: number;
  type: NvsType;
  chunkIndex: number;
  key: string;
  span: number;
  // For primitive types: the raw 8-byte data field
  primitiveData?: (buf: Uint8Array, off: number) => void;
  // For variable-length types: the raw payload bytes
  payload?: Uint8Array;
  payloadSize?: number;
  payloadCrc?: number;
  // For BLOB_IDX
  blobIdxData?: { totalSize: number; chunkCount: number; chunkStart: number };
}

/**
 * Serialize NvsPartition to NVS binary format.
 * @param partition The partition data to serialize
 * @param targetSize Target binary size in bytes (must be multiple of 4096, >= 12288)
 */
export function serializeBinary(partition: NvsPartition, targetSize: number): Uint8Array {
  if (targetSize % PAGE_SIZE !== 0) {
    throw new Error(`Target size (${targetSize}) is not a multiple of page size (${PAGE_SIZE})`);
  }
  if (targetSize < MIN_PARTITION_SIZE) {
    throw new Error(`Target size (${targetSize}) is less than minimum partition size (${MIN_PARTITION_SIZE})`);
  }

  // Allocate buffer filled with 0xFF (erased flash state)
  const buf = new Uint8Array(targetSize);
  buf.fill(0xFF);

  // ── Step 1: Assign namespace indices ──

  const nsToIndex = new Map<string, number>();
  let nextNsIdx = 1;
  for (const ns of partition.namespaces) {
    nsToIndex.set(ns, nextNsIdx++);
  }

  // ── Step 2: Plan all entries ──

  const planned: PlannedEntry[] = [];

  // Namespace definition entries
  for (const [ns, idx] of nsToIndex) {
    planned.push({
      nsIndex: 0,
      type: NvsType.U8,
      chunkIndex: 0xFF,
      key: ns,
      span: 1,
      primitiveData: (b, o) => writeU8(b, o, idx),
    });
  }

  // Data entries
  for (const entry of partition.entries) {
    const nsIdx = nsToIndex.get(entry.namespace);
    if (nsIdx === undefined) continue;

    switch (entry.type) {
      case NvsType.U8:
        planned.push({
          nsIndex: nsIdx, type: NvsType.U8, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeU8(b, o, entry.value as number),
        });
        break;

      case NvsType.I8:
        planned.push({
          nsIndex: nsIdx, type: NvsType.I8, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeI8(b, o, entry.value as number),
        });
        break;

      case NvsType.U16:
        planned.push({
          nsIndex: nsIdx, type: NvsType.U16, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeU16(b, o, entry.value as number),
        });
        break;

      case NvsType.I16:
        planned.push({
          nsIndex: nsIdx, type: NvsType.I16, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeI16(b, o, entry.value as number),
        });
        break;

      case NvsType.U32:
        planned.push({
          nsIndex: nsIdx, type: NvsType.U32, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeU32(b, o, entry.value as number),
        });
        break;

      case NvsType.I32:
        planned.push({
          nsIndex: nsIdx, type: NvsType.I32, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeI32(b, o, entry.value as number),
        });
        break;

      case NvsType.U64:
        planned.push({
          nsIndex: nsIdx, type: NvsType.U64, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeU64(b, o, entry.value as bigint),
        });
        break;

      case NvsType.I64:
        planned.push({
          nsIndex: nsIdx, type: NvsType.I64, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          primitiveData: (b, o) => writeI64(b, o, entry.value as bigint),
        });
        break;

      case NvsType.SZ: {
        const strBytes = new TextEncoder().encode(entry.value as string);
        // +1 for null terminator
        const payload = new Uint8Array(strBytes.length + 1);
        payload.set(strBytes);
        payload[strBytes.length] = 0;

        const span = 1 + Math.ceil(payload.length / ENTRY_SIZE);
        planned.push({
          nsIndex: nsIdx, type: NvsType.SZ, chunkIndex: 0xFF,
          key: entry.key, span,
          payload,
          payloadSize: payload.length,
          payloadCrc: crc32(payload),
        });
        break;
      }

      case NvsType.BLOB: {
        // Legacy V1 blob (single-page)
        const blobData = entry.value as Uint8Array;
        const span = 1 + Math.ceil(blobData.length / ENTRY_SIZE);
        planned.push({
          nsIndex: nsIdx, type: NvsType.BLOB, chunkIndex: 0xFF,
          key: entry.key, span,
          payload: blobData,
          payloadSize: blobData.length,
          payloadCrc: crc32(blobData),
        });
        break;
      }

      case NvsType.BLOB_DATA: {
        // V2 multi-page blob: split into chunks that fit in a single page
        const blobData = entry.value as Uint8Array;
        const maxChunkPayload = (ENTRIES_PER_PAGE - 1) * ENTRY_SIZE;
        const chunkCount = Math.max(1, Math.ceil(blobData.length / maxChunkPayload));

        let dataOffset = 0;
        for (let ci = 0; ci < chunkCount; ci++) {
          const chunkEnd = Math.min(dataOffset + maxChunkPayload, blobData.length);
          const chunkData = blobData.subarray(dataOffset, chunkEnd);
          const chunkSpan = 1 + Math.ceil(chunkData.length / ENTRY_SIZE);

          planned.push({
            nsIndex: nsIdx, type: NvsType.BLOB_DATA, chunkIndex: ci,
            key: entry.key, span: chunkSpan,
            payload: new Uint8Array(chunkData),
            payloadSize: chunkData.length,
            payloadCrc: crc32(chunkData),
          });
          dataOffset = chunkEnd;
        }

        // BLOB_IDX entry
        planned.push({
          nsIndex: nsIdx, type: NvsType.BLOB_IDX, chunkIndex: 0xFF,
          key: entry.key, span: 1,
          blobIdxData: { totalSize: blobData.length, chunkCount, chunkStart: 0 },
        });
        break;
      }
    }
  }

  // ── Step 3: Write entries into pages ──

  const totalPages = targetSize / PAGE_SIZE;
  let currentPage = 0;
  let currentEntryIdx = 0;
  let seqNumber = 0;

  let plannedIdx = 0;

  while (plannedIdx < planned.length && currentPage < totalPages) {
    const pageOff = currentPage * PAGE_SIZE;

    // Initialize page: already 0xFF (EMPTY state)
    // Write page state = ACTIVE
    writeU32(buf, pageOff, PageStateVal.ACTIVE);
    // Write sequence number
    writeU32(buf, pageOff + 4, seqNumber);
    // Write version
    writeU8(buf, pageOff + 8, partition.version);

    currentEntryIdx = 0;

    while (plannedIdx < planned.length && currentEntryIdx < ENTRIES_PER_PAGE) {
      const pe = planned[plannedIdx];

      // Check if this entry fits in the remaining slots of the current page
      if (currentEntryIdx + pe.span > ENTRIES_PER_PAGE) {
        // Does not fit — move to next page
        break;
      }

      const entOff = pageOff + FIRST_ENTRY_OFFSET + currentEntryIdx * ENTRY_SIZE;

      // Clear the entry area (set to 0x00, not 0xFF, for entry data)
      buf.fill(0x00, entOff, entOff + pe.span * ENTRY_SIZE);

      // Write entry header (32 bytes)
      writeU8(buf, entOff + 0, pe.nsIndex);
      writeU8(buf, entOff + 1, pe.type);
      writeU8(buf, entOff + 2, pe.span);
      writeU8(buf, entOff + 3, pe.chunkIndex);
      // CRC at [4..7] will be computed after writing key+data

      // Write key
      writeNullTermString(buf, entOff + 8, pe.key, KEY_FIELD_SIZE);

      // Write data field (8 bytes at offset 24)
      if (pe.primitiveData) {
        // Primitive type: write value into data field
        pe.primitiveData(buf, entOff + 24);
      } else if (pe.payload !== undefined && pe.payloadSize !== undefined) {
        // Variable-length: size at [24..25], reserved [26..27]=0, dataCrc at [28..31]
        writeU16(buf, entOff + 24, pe.payloadSize);
        // [26..27] already 0
        writeU32(buf, entOff + 28, pe.payloadCrc!);

        // Write payload into subsequent entries
        const payloadOff = entOff + ENTRY_SIZE;
        buf.set(pe.payload.subarray(0, (pe.span - 1) * ENTRY_SIZE), payloadOff);
      } else if (pe.blobIdxData) {
        // BLOB_IDX: totalSize[24..27], chunkCount[28], chunkStart[29]
        writeU32(buf, entOff + 24, pe.blobIdxData.totalSize);
        writeU8(buf, entOff + 28, pe.blobIdxData.chunkCount);
        writeU8(buf, entOff + 29, pe.blobIdxData.chunkStart);
      }

      // Compute and write entry CRC
      const entryCrc = computeEntryCrc(buf, entOff);
      writeU32(buf, entOff + 4, entryCrc);

      // Update bitmap: mark all entries in span as WRITTEN
      for (let s = 0; s < pe.span; s++) {
        setEntryWritten(buf, pageOff, currentEntryIdx + s);
      }

      currentEntryIdx += pe.span;
      plannedIdx++;
    }

    // Compute and write page header CRC
    const headerCrc = computePageHeaderCrc(buf, pageOff);
    writeU32(buf, pageOff + 28, headerCrc);

    // If there are more entries, mark this page as FULL
    if (plannedIdx < planned.length) {
      writeU32(buf, pageOff, PageStateVal.FULL);
      // Recompute header CRC after state change
      const newHeaderCrc = computePageHeaderCrc(buf, pageOff);
      writeU32(buf, pageOff + 28, newHeaderCrc);
    }

    currentPage++;
    seqNumber++;
  }

  if (plannedIdx < planned.length) {
    throw new Error(
      `Partition space exhausted: ${planned.length - plannedIdx} entries could not be written. ` +
      `Increase partition size.`
    );
  }

  return buf;
}

/** Numeric values for page states (matching PageState enum but as regular numbers for writeU32) */
const PageStateVal = {
  EMPTY:   0xFFFFFFFF,
  ACTIVE:  0xFFFFFFFE,
  FULL:    0xFFFFFFFC,
  FREEING: 0xFFFFFFFA,
} as const;
