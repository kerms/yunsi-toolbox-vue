import type { NvsPartition } from './types';
import { NvsType, NvsVersion, TYPE_TO_ENCODING, isPrimitiveType } from './types';

/** Convert Uint8Array to hex string */
function bytesToHex(data: Uint8Array): string {
  return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Escape a CSV field if it contains commas, quotes, or newlines */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Serialize NvsPartition to ESP-IDF NVS CSV format.
 *
 * Output format:
 *   key,type,encoding,value
 *   namespace_name,namespace,,
 *   wifi_ssid,data,string,MyNetwork
 */
export function serializeCsv(partition: NvsPartition): string {
  const lines: string[] = ['key,type,encoding,value'];

  // Group entries by namespace
  const grouped = new Map<string, typeof partition.entries>();
  for (const ns of partition.namespaces) {
    grouped.set(ns, []);
  }
  for (const entry of partition.entries) {
    let list = grouped.get(entry.namespace);
    if (!list) {
      list = [];
      grouped.set(entry.namespace, list);
    }
    list.push(entry);
  }

  for (const [ns, entries] of grouped) {
    // Namespace declaration line
    lines.push(`${escapeCsvField(ns)},namespace,,`);

    for (const entry of entries) {
      const encoding = TYPE_TO_ENCODING[entry.type];
      let valueStr: string;

      if (isPrimitiveType(entry.type)) {
        valueStr = String(entry.value);
      } else if (entry.type === NvsType.SZ) {
        valueStr = escapeCsvField(entry.value as string);
      } else {
        // BLOB / BLOB_DATA — version-aware encoding
        const hex = bytesToHex(entry.value as Uint8Array);
        // V1 uses 'blob' (monolithic single entry in binary).
        // V2 uses 'hex2bin' (chunked BLOB_DATA + BLOB_IDX); nvs_partition_gen.py
        // rejects 'blob' for V2 and would produce a V1 binary from it.
        const csvEncoding = partition.version === NvsVersion.V1 ? 'blob' : 'hex2bin';
        lines.push(`${escapeCsvField(entry.key)},data,${csvEncoding},${hex}`);
        continue;
      }

      lines.push(`${escapeCsvField(entry.key)},data,${encoding},${valueStr}`);
    }
  }

  return lines.join('\n') + '\n';
}
