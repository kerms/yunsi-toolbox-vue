// Types and interfaces
export type { PartitionEntry, PartitionTable } from './types';

export {
  PartitionType, AppSubtype, DataSubtype, BootloaderSubtype, PartTableSubtype, PartitionFlags,
  TYPE_NAMES, APP_SUBTYPE_NAMES, DATA_SUBTYPE_NAMES, BOOTLOADER_SUBTYPE_NAMES, PART_TABLE_SUBTYPE_NAMES,
  NAME_TO_TYPE,
  getSubtypeName, subtypeFromName,
} from './types';

// Constants
export {
  ENTRY_SIZE, ENTRY_MAGIC, MD5_MAGIC,
  DEFAULT_TABLE_OFFSET, MAX_ENTRIES, NAME_FIELD_SIZE, TABLE_MAX_SIZE,
} from './constants';

// Binary operations
export { parseBinary } from './parser';
export { serializeBinary } from './serializer';

// CSV operations
export { parseCsv } from './csv-parser';
export { serializeCsv } from './csv-serializer';

// Validation
export { validateTable, type PartitionValidationError } from './validator';
