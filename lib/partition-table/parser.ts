import { readU16, readU32, readNullTermString } from '../shared/binary-reader';
import type { PartitionEntry, PartitionTable } from './types';
import { PartitionType } from './types';
import { ENTRY_SIZE, ENTRY_MAGIC, MD5_MAGIC, NAME_FIELD_SIZE, MAX_ENTRIES } from './constants';
import { md5 } from './md5';

/**
 * Parse ESP32 partition table binary.
 * @param data Raw binary data (the partition table region, typically 3KB at offset 0x8000)
 */
export function parseBinary(data: Uint8Array): PartitionTable {
  const entries: PartitionEntry[] = [];
  let md5Valid = false;
  let corrupted = false;
  let offset = 0;

  for (let i = 0; i < MAX_ENTRIES && offset + ENTRY_SIZE <= data.length; i++) {
    const magic = readU16(data, offset);

    if (magic === 0xFFFF) {
      // Empty entry — end of table (erased flash)
      break;
    }

    if (magic === MD5_MAGIC) {
      // MD5 checksum entry
      // Bytes [16..31] contain the stored MD5 hash of all preceding bytes
      const storedMd5 = data.subarray(offset + 16, offset + 32);
      const computedMd5 = md5(data.subarray(0, offset));

      md5Valid = storedMd5.length === 16 && computedMd5.length === 16 &&
        storedMd5.every((v, j) => v === computedMd5[j]);
      break;
    }

    if (magic !== ENTRY_MAGIC) {
      // Unknown magic — binary is corrupted
      corrupted = true;
      break;
    }

    // Parse 32-byte entry:
    //   [0..1]   magic (already read)
    //   [2]      type
    //   [3]      subtype
    //   [4..7]   offset (LE uint32)
    //   [8..11]  size (LE uint32)
    //   [12..27] name (null-terminated, 16 bytes)
    //   [28..31] flags (LE uint32)
    const type = data[offset + 2] as PartitionType;
    const subtype = data[offset + 3];
    const partOffset = readU32(data, offset + 4);
    const size = readU32(data, offset + 8);
    const name = readNullTermString(data, offset + 12, NAME_FIELD_SIZE);
    const flags = readU32(data, offset + 28);

    entries.push({ name, type, subtype, offset: partOffset, size, flags });
    offset += ENTRY_SIZE;
  }

  // When the table is exactly full (MAX_ENTRIES entries), the loop exits on
  // i >= MAX_ENTRIES without ever seeing the MD5 slot. Check it explicitly.
  if (!md5Valid && offset + ENTRY_SIZE <= data.length) {
    const magic = readU16(data, offset);
    if (magic === MD5_MAGIC) {
      const storedMd5 = data.subarray(offset + 16, offset + 32);
      const computedMd5 = md5(data.subarray(0, offset));
      md5Valid = storedMd5.length === 16 && computedMd5.length === 16 &&
        storedMd5.every((v, j) => v === computedMd5[j]);
    }
  }

  return { entries, md5Valid, ...(corrupted ? { corrupted } : {}) };
}
