import type { NvsPartition, NvsEntry, NvsEncoding } from './types';
import { NvsType, NvsVersion, ENCODING_TO_TYPE } from './types';
import { generateEntryId, reconcileBlobTypes } from './nvs-partition';

/**
 * Parse a line respecting quoted fields.
 * Handles fields with commas inside double quotes.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let wasQuoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
        if (inQuotes) wasQuoted = true;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(wasQuoted ? current : current.trim());
      current = '';
      wasQuoted = false;
    } else {
      current += ch;
    }
  }
  fields.push(wasQuoted ? current : current.trim());
  return fields;
}

/** Parse an integer value from CSV, supporting decimal and 0x hex. Rejects partial matches like "12abc". */
function parseIntValue(str: string): number {
  str = str.trim();
  let val: number;
  if (str.startsWith('0x') || str.startsWith('0X')) {
    if (!/^-?0[xX][0-9a-fA-F]+$/.test(str)) {
      throw new Error(`Invalid integer value: "${str}"`);
    }
    val = parseInt(str, 16);
  } else {
    if (!/^-?\d+$/.test(str)) {
      throw new Error(`Invalid integer value: "${str}"`);
    }
    val = parseInt(str, 10);
  }
  if (Number.isNaN(val)) {
    throw new Error(`Invalid integer value: "${str}"`);
  }
  return val;
}

/** Parse a bigint value from CSV, supporting decimal and 0x hex (including negative hex like -0x1A). */
function parseBigIntValue(str: string): bigint {
  str = str.trim();
  // JS BigInt() accepts decimal and positive hex (0x...) but throws on negative hex (-0x...).
  // Handle negative hex explicitly.
  if (str.startsWith('-0x') || str.startsWith('-0X')) {
    if (!/^-0[xX][0-9a-fA-F]+$/.test(str)) {
      throw new Error(`Invalid integer value: "${str}"`);
    }
    return -BigInt(str.slice(1));
  }
  try {
    return BigInt(str);
  } catch {
    throw new Error(`Invalid integer value: "${str}"`);
  }
}

/** Decode hex string (e.g. "48656c6c6f") to Uint8Array. Throws on non-hex characters. */
function hexToBytes(hex: string): Uint8Array {
  hex = hex.replace(/\s/g, '');
  if (hex.length > 0 && !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid hex string: contains non-hex characters');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Try to decode a base64 string to Uint8Array.
 * Returns null if the string doesn't look like valid base64.
 */
function tryBase64Decode(str: string): Uint8Array | null {
  try {
    if (!/^[A-Za-z0-9+/=]+$/.test(str.trim())) return null;
    const bin = atob(str.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Parse ESP-IDF NVS CSV format into NvsPartition.
 *
 * CSV format:
 *   key,type,encoding,value
 *   namespace_name,namespace,,
 *   wifi_ssid,data,string,MyNetwork
 *   boot_count,data,u8,0
 */
/**
 * Split CSV text into logical lines, respecting double-quoted fields that may
 * span multiple physical lines (RFC 4180 multiline support).
 */
function splitCsvLines(text: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Check for escaped quote ""
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) && !inQuotes) {
      if (ch === '\r') i++; // consume \n of \r\n
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

export function parseCsv(text: string): NvsPartition {
  const lines = splitCsvLines(text);
  const entries: NvsEntry[] = [];
  const namespaces: string[] = [];
  let currentNamespace = '';
  let inferredVersion = NvsVersion.V2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const fields = splitCsvLine(line);
    if (fields.length < 2) continue;

    // Skip header line
    if (fields[0] === 'key' && fields[1] === 'type') continue;

    const key = fields[0];
    const type = fields[1];
    const rawEncoding = (fields[2] || '').toLowerCase();
    const encoding = rawEncoding as NvsEncoding | '';
    const value = fields[3] || '';

    if (type === 'namespace') {
      currentNamespace = key;
      if (!namespaces.includes(key)) {
        namespaces.push(key);
      }
      continue;
    }

    if (!currentNamespace) {
      throw new Error(`Line ${i + 1}: data entry "${key}" appears before any namespace`);
    }

    if (type !== 'data' && type !== 'file') {
      throw new Error(`Line ${i + 1}: unknown type "${type}"`);
    }

    if (!encoding) {
      throw new Error(`Line ${i + 1}: key "${key}" missing encoding`);
    }

    // --- nvs_partition_gen.py-compatible encodings (not in NvsEncoding) ---
    if (rawEncoding === 'hex2bin') {
      const hexClean = value.replace(/\s/g, '');
      if (hexClean.length % 2 !== 0) throw new Error(`Line ${i + 1}: hex2bin value must have even number of hex chars`);
      entries.push({
        id: generateEntryId(),
        namespace: currentNamespace,
        key,
        type: NvsType.BLOB_DATA,
        value: hexClean.length === 0 ? new Uint8Array(0) : hexToBytes(hexClean),
      });
      continue;
    }
    if (rawEncoding === 'base64') {
      const decoded = tryBase64Decode(value);
      if (!decoded) throw new Error(`Line ${i + 1}: invalid base64 value for key "${key}"`);
      entries.push({
        id: generateEntryId(),
        namespace: currentNamespace,
        key,
        type: NvsType.BLOB_DATA,
        value: decoded,
      });
      continue;
    }
    // --- end nvs_partition_gen.py encodings ---

    const nvsType = ENCODING_TO_TYPE[encoding as NvsEncoding];
    if (nvsType === undefined) {
      throw new Error(`Line ${i + 1}: unknown encoding "${encoding}"`);
    }

    let parsedValue: number | bigint | string | Uint8Array;

    switch (encoding) {
      case 'u8': case 'u16': case 'u32':
      case 'i8': case 'i16': case 'i32':
        parsedValue = parseIntValue(value);
        break;
      case 'u64': case 'i64':
        parsedValue = parseBigIntValue(value);
        break;
      case 'string':
        parsedValue = value;
        break;
      case 'blob':
      case 'binary': {
        if (encoding === 'blob') inferredVersion = NvsVersion.V1;
        if (type === 'file') {
          // In browser context, file paths can't be resolved.
          // Store an empty Uint8Array — the UI should handle file picking.
          parsedValue = new Uint8Array(0);
        } else {
          // Try hex decode first (strip whitespace before checking), then base64
          const hexClean = value.replace(/\s/g, '');
          if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length % 2 === 0 && hexClean.length > 0) {
            parsedValue = hexToBytes(value);
          } else {
            const b64 = tryBase64Decode(value);
            parsedValue = b64 ?? new TextEncoder().encode(value);
          }
        }
        break;
      }
      default:
        parsedValue = value;
    }

    entries.push({
      id: generateEntryId(),
      namespace: currentNamespace,
      key,
      type: nvsType,
      value: parsedValue,
    });
  }

  return { entries: reconcileBlobTypes(entries, inferredVersion), namespaces, version: inferredVersion };
}
