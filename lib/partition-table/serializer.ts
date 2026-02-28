import { writeU16, writeU32, writeNullTermString } from '../shared/binary-writer';
import type { PartitionTable } from './types';
import { ENTRY_SIZE, ENTRY_MAGIC, MD5_MAGIC, NAME_FIELD_SIZE, TABLE_MAX_SIZE } from './constants';
import { md5 } from './md5';

const U32_MAX = 0xFFFF_FFFF;

function assertU8(val: number, field: string): void {
  if (!Number.isInteger(val) || val < 0 || val > 0xFF)
    throw new Error(`"${field}" is not a valid byte value (0–255): ${val}`);
}

function assertU32(val: number, field: string): void {
  if (!Number.isInteger(val) || val < 0 || val > U32_MAX)
    throw new Error(`"${field}" is not a valid uint32 (0–0xFFFFFFFF): ${val}`);
}

/**
 * Serialize a PartitionTable to ESP32 binary format.
 * Returns a Uint8Array of TABLE_MAX_SIZE filled with 0xFF for empty space.
 */
export function serializeBinary(table: PartitionTable): Uint8Array {
  const buf = new Uint8Array(TABLE_MAX_SIZE);
  buf.fill(0xFF);

  let offset = 0;
  for (const entry of table.entries) {
    if (offset + ENTRY_SIZE > TABLE_MAX_SIZE - ENTRY_SIZE) {
      throw new Error(`Too many partition table entries (max ${Math.floor((TABLE_MAX_SIZE - ENTRY_SIZE) / ENTRY_SIZE)})`);
    }

    assertU8(entry.type,    'type');
    assertU8(entry.subtype, 'subtype');
    assertU32(entry.offset, 'offset');
    assertU32(entry.size,   'size');
    assertU32(entry.flags,  'flags');

    writeU16(buf, offset, ENTRY_MAGIC);
    buf[offset + 2] = entry.type;
    buf[offset + 3] = entry.subtype;
    writeU32(buf, offset + 4, entry.offset);
    writeU32(buf, offset + 8, entry.size);
    writeNullTermString(buf, offset + 12, entry.name, NAME_FIELD_SIZE);
    writeU32(buf, offset + 28, entry.flags);
    offset += ENTRY_SIZE;
  }

  // Write MD5 checksum entry
  // [0..1] = MD5_MAGIC, [2..15] = 0xFF padding, [16..31] = MD5 hash
  writeU16(buf, offset, MD5_MAGIC);
  // [2..15] already 0xFF from fill
  const hash = md5(buf.subarray(0, offset));
  buf.set(hash, offset + 16);

  return buf;
}
