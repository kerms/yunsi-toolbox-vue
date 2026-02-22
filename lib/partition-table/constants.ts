/** Each partition entry is 32 bytes */
export const ENTRY_SIZE = 32;

/** Magic bytes marking a valid entry (little-endian 0xAA50) */
export const ENTRY_MAGIC = 0x50AA;

/** MD5 checksum marker (little-endian 0xEBEB) */
export const MD5_MAGIC = 0xEBEB;

/** Default partition table offset in flash */
export const DEFAULT_TABLE_OFFSET = 0x8000;

/** Maximum number of partition entries */
export const MAX_ENTRIES = 95;

/** Name field size in bytes */
export const NAME_FIELD_SIZE = 16;

/** Partition table maximum binary size (3KB) */
export const TABLE_MAX_SIZE = 0xC00;
