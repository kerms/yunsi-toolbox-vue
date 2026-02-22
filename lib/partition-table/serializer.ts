import { writeU16, writeU32, writeNullTermString } from '../shared/binary-writer';
import { PartitionTable } from './types';
import { ENTRY_SIZE, ENTRY_MAGIC, MD5_MAGIC, NAME_FIELD_SIZE, TABLE_MAX_SIZE } from './constants';
import { md5 } from './md5';

const U32_MAX = 0xFFFF_FFFF;

function assertU8(val: number, field: string): void {
  if (!Number.isInteger(val) || val < 0 || val > 0xFF)
    throw new Error(`"${field}" 不是有效的字节值 (0–255): ${val}`);
}

function assertU32(val: number, field: string): void {
  if (!Number.isInteger(val) || val < 0 || val > U32_MAX)
    throw new Error(`"${field}" 不是有效的 32 位无符号整数 (0–0xFFFFFFFF): ${val}`);
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
      throw new Error(`分区表条目过多，超过最大容量 (最多 ${Math.floor((TABLE_MAX_SIZE - ENTRY_SIZE) / ENTRY_SIZE)} 条)`);
    }

    assertU8(entry.type,    '类型');
    assertU8(entry.subtype, '子类型');
    assertU32(entry.offset, '偏移量');
    assertU32(entry.size,   '大小');
    assertU32(entry.flags,  '标志');

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
