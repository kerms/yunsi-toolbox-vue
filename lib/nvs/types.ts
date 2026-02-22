/** NVS data type enum, matching ESP-IDF binary encoding */
export enum NvsType {
  U8        = 0x01,
  I8        = 0x11,
  U16       = 0x02,
  I16       = 0x12,
  U32       = 0x04,
  I32       = 0x14,
  U64       = 0x08,
  I64       = 0x18,
  SZ        = 0x21,
  BLOB      = 0x41,
  BLOB_DATA = 0x42,
  BLOB_IDX  = 0x48,
}

/** Page states as written to flash (bit-clearing transitions) */
export enum PageState {
  EMPTY   = 0xFFFFFFFF,
  ACTIVE  = 0xFFFFFFFE,
  FULL    = 0xFFFFFFFC,
  FREEING = 0xFFFFFFFA,
  CORRUPT = 0x00000000,
}

/** Entry state in the 2-bit bitmap */
export enum EntryState {
  EMPTY   = 0x3,
  WRITTEN = 0x2,
  ERASED  = 0x0,
}

/** NVS format version */
export enum NvsVersion {
  V1 = 0xFF,
  V2 = 0xFE,
}

/** Human-friendly encoding name for CSV and UI */
export type NvsEncoding =
  | 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64'
  | 'string' | 'blob' | 'binary';

/** A single NVS key-value record (the user-facing data model) */
export interface NvsEntry {
  id: string;
  namespace: string;
  key: string;
  type: NvsType;
  value: number | bigint | string | Uint8Array;
}

/** The top-level partition data model */
export interface NvsPartition {
  entries: NvsEntry[];
  namespaces: string[];
  version: NvsVersion;
}

/** Statistics about flash usage */
export interface NvsFlashStats {
  totalBytes: number;
  totalPages: number;
  usedEntries: number;
  maxEntries: number;
  usedBytes: number;
  usagePercent: number;
}

/** CSV row as parsed from text */
export interface NvsCsvRow {
  key: string;
  type: 'namespace' | 'data' | 'file';
  encoding: NvsEncoding | '';
  value: string;
}

/** Maps NvsType to the human-friendly encoding name */
export const TYPE_TO_ENCODING: Record<NvsType, NvsEncoding> = {
  [NvsType.U8]:        'u8',
  [NvsType.I8]:        'i8',
  [NvsType.U16]:       'u16',
  [NvsType.I16]:       'i16',
  [NvsType.U32]:       'u32',
  [NvsType.I32]:       'i32',
  [NvsType.U64]:       'u64',
  [NvsType.I64]:       'i64',
  [NvsType.SZ]:        'string',
  [NvsType.BLOB]:      'blob',
  [NvsType.BLOB_DATA]: 'binary',
  [NvsType.BLOB_IDX]:  'binary',
};

/** Maps encoding name to NvsType (for new entries, prefer V2 BLOB_DATA over legacy BLOB) */
export const ENCODING_TO_TYPE: Record<NvsEncoding, NvsType> = {
  'u8':     NvsType.U8,
  'i8':     NvsType.I8,
  'u16':    NvsType.U16,
  'i16':    NvsType.I16,
  'u32':    NvsType.U32,
  'i32':    NvsType.I32,
  'u64':    NvsType.U64,
  'i64':    NvsType.I64,
  'string': NvsType.SZ,
  'blob':   NvsType.BLOB,
  'binary': NvsType.BLOB_DATA,
};

/** All encoding options for UI dropdowns */
export const ENCODING_OPTIONS: NvsEncoding[] = [
  'u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'string', 'blob', 'binary',
];

/** Check if a type is a primitive integer */
export function isPrimitiveType(type: NvsType): boolean {
  return type === NvsType.U8  || type === NvsType.I8  ||
         type === NvsType.U16 || type === NvsType.I16 ||
         type === NvsType.U32 || type === NvsType.I32 ||
         type === NvsType.U64 || type === NvsType.I64;
}

/** Check if a type is variable-length (string or blob) */
export function isVariableLengthType(type: NvsType): boolean {
  return type === NvsType.SZ || type === NvsType.BLOB ||
         type === NvsType.BLOB_DATA || type === NvsType.BLOB_IDX;
}

/** Get the byte size of a primitive type's value */
export function primitiveSize(type: NvsType): number {
  switch (type) {
    case NvsType.U8:  case NvsType.I8:  return 1;
    case NvsType.U16: case NvsType.I16: return 2;
    case NvsType.U32: case NvsType.I32: return 4;
    case NvsType.U64: case NvsType.I64: return 8;
    default: return 0;
  }
}
