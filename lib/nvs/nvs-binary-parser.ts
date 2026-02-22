import { NvsPartition, NvsEntry, NvsType, NvsVersion, PageState, EntryState } from './types';
import {
  PAGE_SIZE, PAGE_HEADER_SIZE, BITMAP_OFFSET, BITMAP_SIZE,
  FIRST_ENTRY_OFFSET, ENTRY_SIZE, ENTRIES_PER_PAGE, KEY_FIELD_SIZE,
} from './constants';
import { crc32 } from '../shared/crc32';
import {
  readU8, readU16, readU32, readI8, readI16, readI32, readU64, readI64,
  readNullTermString,
} from '../shared/binary-reader';
import { generateEntryId } from './nvs-partition';

// ── Entry state bitmap ─────────────────────────────────────────────

function getEntryState(bitmap: Uint8Array, index: number): EntryState {
  const bitPos = index * 2;
  const byteIdx = Math.floor(bitPos / 8);
  const bitOff = bitPos % 8;
  return ((bitmap[byteIdx] >> bitOff) & 0x3) as EntryState;
}

// ── Entry CRC verification ─────────────────────────────────────────

/** Entry CRC is over bytes [0..3] + [8..31], skipping the CRC field [4..7] */
function computeEntryCrc(entryBytes: Uint8Array): number {
  const crcData = new Uint8Array(28);
  crcData.set(entryBytes.subarray(0, 4), 0);     // nsIndex, type, span, chunkIndex
  crcData.set(entryBytes.subarray(8, 32), 4);     // key[16] + data[8]
  return crc32(crcData);
}

// ── Page header CRC ────────────────────────────────────────────────

/** Page header CRC is over bytes [4..27] (seqNum, version, reserved) */
function computePageHeaderCrc(page: Uint8Array): number {
  return crc32(page.subarray(4, 28));
}

// ── Raw parsed structures ──────────────────────────────────────────

interface RawEntry {
  nsIndex: number;
  type: number;
  span: number;
  chunkIndex: number;
  crc: number;
  key: string;
  data: Uint8Array; // 8 bytes
  // Additional data for multi-span entries
  extraData: Uint8Array | null;
}

interface ParsedPage {
  state: PageState;
  seqNumber: number;
  version: number;
  entries: (RawEntry | null)[]; // null = EMPTY or ERASED
}

// ── Main parser ────────────────────────────────────────────────────

/**
 * Parse an NVS binary partition into NvsPartition.
 * @param data Raw binary data (must be multiple of 4096 bytes)
 */
export function parseBinary(data: Uint8Array): NvsPartition {
  if (data.length % PAGE_SIZE !== 0) {
    throw new Error(`二进制数据大小 (${data.length}) 不是页大小 (${PAGE_SIZE}) 的倍数`);
  }
  if (data.length === 0) {
    throw new Error('二进制数据为空');
  }

  const pageCount = data.length / PAGE_SIZE;
  const pages: ParsedPage[] = [];

  // ── Phase 1: Parse all pages ──

  for (let p = 0; p < pageCount; p++) {
    const pageOff = p * PAGE_SIZE;
    const pageData = data.subarray(pageOff, pageOff + PAGE_SIZE);

    // Read page header
    const state = readU32(pageData, 0) as PageState;
    const seqNumber = readU32(pageData, 4);
    const version = readU8(pageData, 8);
    const storedCrc = readU32(pageData, 28);

    // Skip EMPTY pages
    if (state === PageState.EMPTY) continue;

    // Verify page header CRC
    const calcCrc = computePageHeaderCrc(pageData);
    if (calcCrc !== storedCrc) {
      // Corrupted page, skip
      continue;
    }

    // Parse bitmap
    const bitmap = pageData.subarray(BITMAP_OFFSET, BITMAP_OFFSET + BITMAP_SIZE);

    // Parse entries
    const rawEntries: (RawEntry | null)[] = [];
    let entryIdx = 0;

    while (entryIdx < ENTRIES_PER_PAGE) {
      const entState = getEntryState(bitmap, entryIdx);

      if (entState === EntryState.EMPTY) {
        // All remaining entries are EMPTY
        break;
      }

      if (entState === EntryState.ERASED) {
        rawEntries.push(null);
        entryIdx++;
        continue;
      }

      // WRITTEN entry
      const entOff = FIRST_ENTRY_OFFSET + entryIdx * ENTRY_SIZE;
      const entryBytes = pageData.subarray(entOff, entOff + ENTRY_SIZE);

      const nsIndex = readU8(entryBytes, 0);
      const type = readU8(entryBytes, 1);
      const span = readU8(entryBytes, 2);
      const chunkIndex = readU8(entryBytes, 3);
      const entryCrc = readU32(entryBytes, 4);
      const key = readNullTermString(entryBytes, 8, KEY_FIELD_SIZE);
      const entryData = new Uint8Array(entryBytes.subarray(24, 32));

      // Reject nonsensical spans before CRC check
      if (span < 1 || entryIdx + span > ENTRIES_PER_PAGE) {
        entryIdx++; // skip this entry slot
        continue;
      }

      // Verify entry CRC
      const calcEntryCrc = computeEntryCrc(entryBytes);
      if (calcEntryCrc !== entryCrc) {
        // Corrupted entry, skip the span
        entryIdx += span;
        continue;
      }

      // Collect extra data for multi-span entries (SZ, BLOB, BLOB_DATA)
      let extraData: Uint8Array | null = null;
      if (span > 1) {
        const extraLen = (span - 1) * ENTRY_SIZE;
        const extraOff = FIRST_ENTRY_OFFSET + (entryIdx + 1) * ENTRY_SIZE;
        if (extraOff + extraLen <= PAGE_SIZE) {
          extraData = new Uint8Array(pageData.subarray(extraOff, extraOff + extraLen));
        }
      }

      rawEntries.push({ nsIndex, type, span, chunkIndex, crc: entryCrc, key, data: entryData, extraData });

      // Skip past the span (span >= 1 is guaranteed above)
      entryIdx += span;
    }

    pages.push({ state, seqNumber, version, entries: rawEntries });
  }

  // Sort pages by sequence number (ascending) for proper deduplication
  pages.sort((a, b) => a.seqNumber - b.seqNumber);

  // Detect version from first valid page
  const detectedVersion: NvsVersion = pages.length > 0 && pages[0].version === NvsVersion.V2
    ? NvsVersion.V2
    : NvsVersion.V1;

  // ── Phase 2: Build namespace map ──

  const nsMap = new Map<number, string>(); // nsIndex → namespace name
  const namespaces: string[] = [];

  for (const page of pages) {
    for (const entry of page.entries) {
      if (!entry) continue;
      // Namespace definitions have nsIndex=0 and type=U8
      if (entry.nsIndex === 0 && entry.type === NvsType.U8) {
        const assignedIdx = readU8(entry.data, 0);
        nsMap.set(assignedIdx, entry.key);
        if (!namespaces.includes(entry.key)) {
          namespaces.push(entry.key);
        }
      }
    }
  }

  // ── Phase 3: Resolve data entries (deduplication by last-write-wins) ──

  // For V2 blobs, we need to collect BLOB_DATA and BLOB_IDX separately.
  // Keys use \x00 as separator (NVS key/namespace names are C strings and cannot contain null bytes).
  const blobDataChunks = new Map<string, Map<number, Uint8Array>>(); // "ns\x00key" → chunkIndex → data
  const blobIdxEntries = new Map<string, { size: number; chunkCount: number; chunkStart: number }>();

  const entryMap = new Map<string, NvsEntry>(); // "ns\x00key" → NvsEntry (last wins)

  for (const page of pages) {
    for (const entry of page.entries) {
      if (!entry) continue;
      if (entry.nsIndex === 0) continue; // Skip namespace definitions

      const nsName = nsMap.get(entry.nsIndex);
      if (!nsName) continue; // Unknown namespace, skip

      const compositeKey = `${nsName}\x00${entry.key}`;

      switch (entry.type) {
        case NvsType.U8:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.U8, value: readU8(entry.data, 0),
          });
          break;

        case NvsType.I8:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.I8, value: readI8(entry.data, 0),
          });
          break;

        case NvsType.U16:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.U16, value: readU16(entry.data, 0),
          });
          break;

        case NvsType.I16:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.I16, value: readI16(entry.data, 0),
          });
          break;

        case NvsType.U32:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.U32, value: readU32(entry.data, 0),
          });
          break;

        case NvsType.I32:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.I32, value: readI32(entry.data, 0),
          });
          break;

        case NvsType.U64:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.U64, value: readU64(entry.data, 0),
          });
          break;

        case NvsType.I64:
          entryMap.set(compositeKey, {
            id: generateEntryId(), namespace: nsName, key: entry.key,
            type: NvsType.I64, value: readI64(entry.data, 0),
          });
          break;

        case NvsType.SZ: {
          // String: size at data[0..1], dataCrc at data[4..7]
          const size = readU16(entry.data, 0);
          if (entry.extraData && size > 0) {
            const payload = entry.extraData.subarray(0, size);
            const storedDataCrc = readU32(entry.data, 4);
            if (crc32(payload) !== storedDataCrc) break; // corrupted payload, skip
            // Decode string (remove null terminator)
            const str = new TextDecoder('utf-8').decode(payload.subarray(0, size - 1));
            entryMap.set(compositeKey, {
              id: generateEntryId(), namespace: nsName, key: entry.key,
              type: NvsType.SZ, value: str,
            });
          }
          break;
        }

        case NvsType.BLOB: {
          // Legacy V1 blob: size at data[0..1], dataCrc at data[4..7]
          const size = readU16(entry.data, 0);
          if (entry.extraData && size > 0) {
            const payload = entry.extraData.subarray(0, size);
            const storedDataCrc = readU32(entry.data, 4);
            if (crc32(payload) !== storedDataCrc) break; // corrupted payload, skip
            entryMap.set(compositeKey, {
              id: generateEntryId(), namespace: nsName, key: entry.key,
              type: NvsType.BLOB, value: new Uint8Array(payload),
            });
          } else {
            entryMap.set(compositeKey, {
              id: generateEntryId(), namespace: nsName, key: entry.key,
              type: NvsType.BLOB, value: new Uint8Array(0),
            });
          }
          break;
        }

        case NvsType.BLOB_DATA: {
          // V2 blob data chunk
          const size = readU16(entry.data, 0);
          if (!blobDataChunks.has(compositeKey)) {
            blobDataChunks.set(compositeKey, new Map());
          }
          if (entry.extraData && size > 0) {
            const payload = entry.extraData.subarray(0, size);
            const storedDataCrc = readU32(entry.data, 4);
            if (crc32(payload) !== storedDataCrc) break; // corrupted chunk, skip
            blobDataChunks.get(compositeKey)!.set(entry.chunkIndex, new Uint8Array(payload));
          } else {
            blobDataChunks.get(compositeKey)!.set(entry.chunkIndex, new Uint8Array(0));
          }
          break;
        }

        case NvsType.BLOB_IDX: {
          // V2 blob index
          const totalSize = readU32(entry.data, 0);
          const chunkCount = readU8(entry.data, 4);
          const chunkStart = readU8(entry.data, 5);
          blobIdxEntries.set(compositeKey, { size: totalSize, chunkCount, chunkStart });
          break;
        }
      }
    }
  }

  // ── Phase 4: Reassemble V2 blobs ──

  for (const [compositeKey, idxInfo] of blobIdxEntries) {
    const chunks = blobDataChunks.get(compositeKey);
    if (!chunks) continue;

    const assembled = new Uint8Array(idxInfo.size);
    let offset = 0;
    let chunksValid = true;

    for (let i = idxInfo.chunkStart; i < idxInfo.chunkStart + idxInfo.chunkCount; i++) {
      const chunk = chunks.get(i);
      if (!chunk) {
        chunksValid = false; // missing chunk — cannot reassemble correctly
        break;
      }
      assembled.set(chunk, offset);
      offset += chunk.length;
    }

    if (!chunksValid) continue; // skip blob with missing chunks rather than return corrupted data
    if (offset !== idxInfo.size) continue; // chunk sizes don't match declared total — zero tail would result

    const sepIdx = compositeKey.indexOf('\x00');
    const nsName = compositeKey.substring(0, sepIdx);
    const key = compositeKey.substring(sepIdx + 1);
    entryMap.set(compositeKey, {
      id: generateEntryId(),
      namespace: nsName,
      key,
      type: NvsType.BLOB_DATA,
      value: assembled,
    });
  }

  return {
    entries: Array.from(entryMap.values()),
    namespaces,
    version: detectedVersion,
  };
}
