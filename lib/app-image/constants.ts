/** Magic byte at start of image header */
export const IMAGE_MAGIC = 0xE9;

/** Image header size in bytes (magic, segment_count, spi_mode, spi_speed_size, entry_point, padding) */
export const IMAGE_HEADER_SIZE = 8;

/** Extended header size in bytes */
export const EXTENDED_HEADER_SIZE = 16;

/** Segment header size in bytes */
export const SEGMENT_HEADER_SIZE = 8;

/** Magic word for esp_app_desc_t */
export const APP_DESC_MAGIC = 0xABCD5432;

/** Size of esp_app_desc_t structure */
export const APP_DESC_SIZE = 256;

/** Chip ID to human-readable name */
export const CHIP_ID_NAMES: Record<number, string> = {
  0x0000: 'ESP32',
  0x0002: 'ESP32-S2',
  0x0005: 'ESP32-C3',
  0x0009: 'ESP32-S3',
  0x000C: 'ESP32-C2',
  0x000D: 'ESP32-C6',
  0x0010: 'ESP32-H2',
  0x0012: 'ESP32-P4',
  0x0011: 'ESP32-C61',
  0x0014: 'ESP32-C5',
  0x0016: 'ESP32-H4',
};
