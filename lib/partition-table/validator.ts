import { PartitionEntry, PartitionTable } from './types';

export interface PartitionValidationError {
  type: 'overlap' | 'alignment' | 'duplicate_name';
  message: string;
  entryA?: PartitionEntry;
  entryB?: PartitionEntry;
}

const SECTOR_SIZE = 0x1000; // 4KB

export function validateTable(table: PartitionTable): PartitionValidationError[] {
  const errors: PartitionValidationError[] = [];
  const entries = table.entries;

  // Duplicate name detection
  const names = new Map<string, PartitionEntry>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      errors.push({
        type: 'duplicate_name',
        message: `分区名称重复: "${entry.name}"`,
        entryA: names.get(entry.name),
        entryB: entry,
      });
    } else {
      names.set(entry.name, entry);
    }
  }

  // Alignment validation
  for (const entry of entries) {
    if (entry.offset !== 0 && entry.offset % SECTOR_SIZE !== 0) {
      errors.push({
        type: 'alignment',
        message: `"${entry.name}" 偏移 0x${entry.offset.toString(16)} 未对齐到 4KB 边界`,
        entryA: entry,
      });
    }
    if (entry.size !== 0 && entry.size % SECTOR_SIZE !== 0) {
      errors.push({
        type: 'alignment',
        message: `"${entry.name}" 大小 0x${entry.size.toString(16)} 未对齐到 4KB 边界`,
        entryA: entry,
      });
    }
  }

  // Overlap detection (skip entries with offset === 0 — they may be auto-assigned)
  const nonZeroEntries = entries.filter(e => e.offset !== 0 && e.size !== 0);
  for (let i = 0; i < nonZeroEntries.length; i++) {
    const a = nonZeroEntries[i];
    const aEnd = a.offset + a.size;
    for (let j = i + 1; j < nonZeroEntries.length; j++) {
      const b = nonZeroEntries[j];
      const bEnd = b.offset + b.size;
      if (a.offset < bEnd && b.offset < aEnd) {
        errors.push({
          type: 'overlap',
          message: `"${a.name}" [0x${a.offset.toString(16)}..0x${aEnd.toString(16)}] 与 "${b.name}" [0x${b.offset.toString(16)}..0x${bEnd.toString(16)}] 重叠`,
          entryA: a,
          entryB: b,
        });
      }
    }
  }

  return errors;
}
