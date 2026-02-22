/** Page size = one flash sector */
export const PAGE_SIZE = 4096;

/** Page header occupies bytes 0..31 */
export const PAGE_HEADER_SIZE = 32;

/** Entry state bitmap at bytes 32..63 */
export const BITMAP_OFFSET = 32;
export const BITMAP_SIZE = 32;

/** First entry starts at byte 64 */
export const FIRST_ENTRY_OFFSET = 64;

/** Each entry is 32 bytes */
export const ENTRY_SIZE = 32;

/** 126 entries per page: (4096 - 64) / 32 */
export const ENTRIES_PER_PAGE = 126;

/** Maximum key length (excluding null terminator) */
export const MAX_KEY_LENGTH = 15;

/** Key field size in entry (including null terminator padding) */
export const KEY_FIELD_SIZE = 16;

/** Data field size in entry */
export const DATA_FIELD_SIZE = 8;

/** Maximum string length including null terminator */
export const MAX_STRING_LENGTH = 4000;

/** Maximum blob data size V1 (single page, legacy) */
export const MAX_BLOB_SIZE_V1 = 1984;

/** Maximum blob data size V2 (multi-page) */
export const MAX_BLOB_SIZE_V2 = 508000;

/** Chunk index value meaning "not applicable" */
export const CHUNK_ANY = 0xFF;

/** Minimum partition size: 3 pages (12KB) */
export const MIN_PARTITION_SIZE = 3 * PAGE_SIZE;

/** Maximum number of namespaces per partition */
export const MAX_NAMESPACES = 254;
