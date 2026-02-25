import type { PartitionTable } from './types';
import { TYPE_NAMES, getSubtypeName } from './types';

/** Format a number as hex with 0x prefix */
function toHex(val: number): string {
  return '0x' + val.toString(16);
}

/** Format size with human-readable suffix if aligned */
function formatSize(size: number): string {
  if (size >= 1024 * 1024 && size % (1024 * 1024) === 0) {
    return `${size / (1024 * 1024)}M`;
  }
  if (size >= 1024 && size % 1024 === 0) {
    return `${size / 1024}K`;
  }
  return toHex(size);
}

/**
 * Serialize a PartitionTable to ESP-IDF CSV format.
 *
 * Output:
 *   # Name, Type, SubType, Offset, Size, Flags
 *   nvs,      data, nvs,      0x9000,   0x6000,
 */
export function serializeCsv(table: PartitionTable): string {
  const lines: string[] = ['# Name, Type, SubType, Offset, Size, Flags'];

  for (const entry of table.entries) {
    const typeName = TYPE_NAMES[entry.type] ?? `0x${entry.type.toString(16).padStart(2, '0')}`;
    const subtypeName = getSubtypeName(entry.type, entry.subtype);
    const offset = toHex(entry.offset);
    const size = formatSize(entry.size);
    const flags = entry.flags ? toHex(entry.flags) : '';

    lines.push(`${entry.name}, ${typeName}, ${subtypeName}, ${offset}, ${size}, ${flags}`);
  }

  return lines.join('\n') + '\n';
}
