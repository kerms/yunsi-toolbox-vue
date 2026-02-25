/** Size of one esp_ota_select_entry_t structure in bytes */
export const OTA_SELECT_ENTRY_SIZE = 32;

/** Minimum data needed: two entries */
export const OTA_DATA_MIN_SIZE = 2 * OTA_SELECT_ENTRY_SIZE;

/** Default number of OTA app partitions (used to derive partition name from seq) */
export const DEFAULT_NUM_OTA_PARTITIONS = 2;
