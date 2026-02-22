// Types and interfaces
export type {
  NvsEntry,
  NvsPartition,
  NvsFlashStats,
  NvsCsvRow,
  NvsEncoding,
} from './types';

export {
  NvsType,
  NvsVersion,
  PageState,
  EntryState,
  TYPE_TO_ENCODING,
  ENCODING_TO_TYPE,
  ENCODING_OPTIONS,
  isPrimitiveType,
  isVariableLengthType,
  primitiveSize,
} from './types';

// Constants
export {
  PAGE_SIZE, PAGE_HEADER_SIZE, BITMAP_OFFSET, BITMAP_SIZE,
  FIRST_ENTRY_OFFSET, ENTRY_SIZE, ENTRIES_PER_PAGE,
  MAX_KEY_LENGTH, KEY_FIELD_SIZE, DATA_FIELD_SIZE,
  MAX_STRING_LENGTH, MAX_BLOB_SIZE_V1, MAX_BLOB_SIZE_V2,
  CHUNK_ANY, MIN_PARTITION_SIZE, MAX_NAMESPACES,
} from './constants';

// CRC32 utility (re-exported from shared for backward compatibility)
export { crc32 } from '../shared/crc32';

// Binary operations
export { parseBinary } from './nvs-binary-parser';
export { serializeBinary } from './nvs-binary-serializer';

// CSV operations
export { parseCsv } from './nvs-csv-parser';
export { serializeCsv } from './nvs-csv-serializer';

// Partition manipulation
export {
  createEmptyPartition,
  addEntry,
  removeEntry,
  updateEntry,
  duplicateEntry,
  mergePartitions,
  entrySpan,
  calculateFlashStats,
  validatePartition,
  sortEntries,
  generateEntryId,
} from './nvs-partition';
