import type { PartitionEntry, PartitionTable } from './types';
import { PartitionFlags, PartitionType, NAME_TO_TYPE, subtypeFromName } from './types';

const U32_MAX = 0xFFFF_FFFF;

/** Parse partition flags: handles numeric values, single names, and combined forms like "encrypted readonly" */
function parseFlags(str: string): number {
  if (!str) return 0;
  const normalized = str.trim().toLowerCase();
  // Numeric values (hex or decimal) take priority
  if (/^0x[\da-f]+$/i.test(normalized) || /^\d+$/.test(normalized)) {
    return parseSize(str);
  }
  // Split on whitespace, pipe, or comma to support combined flags
  let result = 0;
  for (const part of normalized.split(/[\s|,]+/).filter(Boolean)) {
    if (part === 'encrypted') result |= PartitionFlags.ENCRYPTED;
    else if (part === 'readonly') result |= PartitionFlags.READONLY;
    else throw new Error(`未知标志: "${part}"`);
  }
  return result;
}

/** Parse a size string like "0x6000", "1M", "32K", "4096" */
function parseSize(str: string): number {
  str = str.trim();
  if (!str) return 0;
  if (str.startsWith('0x') || str.startsWith('0X')) {
    if (!/^0x[0-9a-f]+$/i.test(str)) throw new Error(`无效的大小/偏移值: "${str}"`);
    const v = parseInt(str, 16);
    if (isNaN(v) || v < 0 || v > U32_MAX) throw new Error(`无效的大小/偏移值: "${str}"`);
    return v;
  }

  const match = str.match(/^(\d+(?:\.\d+)?)\s*([KkMm])?$/);
  if (match) {
    const num = parseFloat(match[1]);
    const unit = (match[2] || '').toUpperCase();
    let result: number;
    if (unit === 'K') result = Math.floor(num * 1024);
    else if (unit === 'M') result = Math.floor(num * 1024 * 1024);
    else result = Math.floor(num);
    if (result > U32_MAX) throw new Error(`无效的大小/偏移值: "${str}" (超出 32 位范围)`);
    return result;
  }

  throw new Error(`无效的大小/偏移值: "${str}"`);
}

/**
 * Split one CSV line into trimmed fields, respecting RFC-4180 quoting and
 * treating an unquoted '#' as the start of an inline comment (discards rest).
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { // escaped quote ""
        current += '"';
        i += 2;
      } else if (ch === '"') {
        inQuotes = false;
        i++;
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
        i++;
      } else if (ch === '#') {
        break; // inline comment — discard rest of line
      } else {
        current += ch;
        i++;
      }
    }
  }
  if (inQuotes) throw new Error('引号未闭合');
  fields.push(current.trim());
  return fields;
}

/**
 * Parse ESP-IDF partition table CSV format.
 *
 * Format:
 *   # Name,   Type, SubType,  Offset,   Size,  Flags
 *   nvs,      data, nvs,      0x9000,   0x6000,
 *   phy_init, data, phy,      0xf000,   0x1000,
 *   factory,  app,  factory,  0x10000,  1M,
 */
export function parseCsv(text: string, onWarning?: (line: number, message: string) => void): PartitionTable {
  const lines = text.split(/\r?\n/);
  const entries: PartitionEntry[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (!line || line.startsWith('#')) continue;

    try {
      const fields = splitCsvLine(line);
      if (fields.length < 5) {
        onWarning?.(lineIdx + 1, `字段数量不足 (需要 5，实际 ${fields.length}): "${line}"`);
        continue;
      }

      // Skip header line
      if (fields[0].toLowerCase() === 'name' && fields[1].toLowerCase() === 'type') continue;

      const name = fields[0];
      const typeName = fields[1].toLowerCase();
      const subtypeName = fields[2];
      const offsetStr = fields[3];
      const sizeStr = fields[4];
      const flagsStr = fields[5] || '';

      const type = NAME_TO_TYPE[typeName];
      if (type === undefined) {
        onWarning?.(lineIdx + 1, `未知分区类型: "${typeName}"`);
        continue;
      }

      const subtype = subtypeFromName(type, subtypeName);
      const offset = parseSize(offsetStr);
      const size = parseSize(sizeStr);
      const flags = parseFlags(flagsStr);
      entries.push({ name, type, subtype, offset, size, flags });
    } catch (e) {
      onWarning?.(lineIdx + 1, `解析失败: ${(e as Error).message}`);
    }
  }

  return { entries, md5Valid: false };
}
