import { readU32 } from '../shared/binary-reader';
import { readNullTermString } from '../shared/binary-reader';
import { crc32 } from '../shared/crc32';
import { OTA_SELECT_ENTRY_SIZE, OTA_DATA_MIN_SIZE, DEFAULT_NUM_OTA_PARTITIONS } from './constants';
import { OtaImgState } from './types';
import type { OtaSelectEntry, OtaData } from './types';

/**
 * Parse a single esp_ota_select_entry_t (32 bytes):
 *   uint32_t ota_seq       [0..3]
 *   uint8_t  seq_label[20] [4..23]
 *   uint32_t ota_state     [24..27]
 *   uint32_t crc           [28..31]
 *
 * CRC is computed over the first 28 bytes.
 */
function parseEntry(data: Uint8Array, offset: number): OtaSelectEntry {
  const seq = readU32(data, offset);
  const label = readNullTermString(data, offset + 4, 20);
  const state = readU32(data, offset + 24) as OtaImgState;
  const storedCrc = readU32(data, offset + 28);
  const computedCrc = crc32(data.subarray(offset, offset + 28));

  return {
    seq,
    label,
    state,
    crc: storedCrc,
    crcValid: storedCrc === computedCrc,
  };
}

/** Check if an entry represents a valid (non-empty) OTA selection */
function isEntryValid(entry: OtaSelectEntry): boolean {
  // seq of 0 or 0xFFFFFFFF means empty/erased
  return entry.crcValid && entry.seq !== 0 && entry.seq !== 0xFFFFFFFF;
}

/**
 * Parse OTA data partition binary.
 *
 * @param data - Raw bytes of the otadata partition (typically 0x2000 bytes, only first 64 used)
 * @param numOtaPartitions - Number of OTA app partitions (default 2, used for partition name derivation)
 */
export function parseOtaData(data: Uint8Array, numOtaPartitions = DEFAULT_NUM_OTA_PARTITIONS): OtaData {
  if (data.length < OTA_DATA_MIN_SIZE) {
    throw new Error(`OTA data too short: ${data.length} bytes, need at least ${OTA_DATA_MIN_SIZE}`);
  }

  const entry0 = parseEntry(data, 0);
  const entry1 = parseEntry(data, OTA_SELECT_ENTRY_SIZE);

  // Determine active entry: the one with the higher valid seq
  let activeIndex: number | null = null;
  const valid0 = isEntryValid(entry0);
  const valid1 = isEntryValid(entry1);

  if (valid0 && valid1) {
    activeIndex = entry0.seq >= entry1.seq ? 0 : 1;
  } else if (valid0) {
    activeIndex = 0;
  } else if (valid1) {
    activeIndex = 1;
  }

  let activeOtaPartition: string | null = null;
  if (activeIndex !== null) {
    const activeSeq = activeIndex === 0 ? entry0.seq : entry1.seq;
    const partitionIndex = (activeSeq - 1) % numOtaPartitions;
    activeOtaPartition = `ota_${partitionIndex}`;
  }

  return {
    entries: [entry0, entry1],
    activeIndex,
    activeOtaPartition,
  };
}
