/** Partition type */
export enum PartitionType {
  APP             = 0x00,
  DATA            = 0x01,
  BOOTLOADER      = 0x02,
  PARTITION_TABLE = 0x03,
}

/** App subtypes */
export enum AppSubtype {
  FACTORY   = 0x00,
  OTA_0     = 0x10,
  OTA_1     = 0x11,
  OTA_2     = 0x12,
  OTA_3     = 0x13,
  OTA_4     = 0x14,
  OTA_5     = 0x15,
  OTA_6     = 0x16,
  OTA_7     = 0x17,
  OTA_8     = 0x18,
  OTA_9     = 0x19,
  OTA_10    = 0x1A,
  OTA_11    = 0x1B,
  OTA_12    = 0x1C,
  OTA_13    = 0x1D,
  OTA_14    = 0x1E,
  OTA_15    = 0x1F,
  TEST      = 0x20,
}

/** Data subtypes */
export enum DataSubtype {
  OTA       = 0x00,
  PHY       = 0x01,
  NVS       = 0x02,
  COREDUMP  = 0x03,
  NVS_KEYS  = 0x04,
  EFUSE_EM  = 0x05,
  UNDEFINED = 0x06,
  FAT       = 0x81,
  SPIFFS    = 0x82,
  LITTLEFS  = 0x83,
}

/** Bootloader subtypes */
export enum BootloaderSubtype {
  PRIMARY  = 0x00,
  OTA      = 0x01,
  RECOVERY = 0x02,
}

/** Partition table subtypes */
export enum PartTableSubtype {
  PRIMARY = 0x00,
  OTA     = 0x01,
}

/** Partition flags */
export enum PartitionFlags {
  NONE      = 0x00,
  ENCRYPTED = 0x01,
  READONLY  = 0x02,
}

/** A single parsed partition entry */
export interface PartitionEntry {
  name: string;
  type: PartitionType;
  subtype: number;
  offset: number;
  size: number;
  flags: number;
}

/** The complete partition table */
export interface PartitionTable {
  entries: PartitionEntry[];
  md5Valid: boolean;
  /** True if an unexpected magic value was found mid-table (indicates binary corruption) */
  corrupted?: boolean;
}

/** Human-readable type name map */
export const TYPE_NAMES: Record<number, string> = {
  [PartitionType.APP]:             'app',
  [PartitionType.DATA]:            'data',
  [PartitionType.BOOTLOADER]:      'bootloader',
  [PartitionType.PARTITION_TABLE]: 'partition_table',
};

/** Human-readable app subtype name map */
export const APP_SUBTYPE_NAMES: Record<number, string> = {
  [AppSubtype.FACTORY]: 'factory',
  [AppSubtype.TEST]:    'test',
};
// OTA_0..OTA_15
for (let i = 0; i <= 15; i++) {
  APP_SUBTYPE_NAMES[0x10 + i] = `ota_${i}`;
}

/** Human-readable data subtype name map */
export const DATA_SUBTYPE_NAMES: Record<number, string> = {
  [DataSubtype.OTA]:      'ota',
  [DataSubtype.PHY]:      'phy',
  [DataSubtype.NVS]:      'nvs',
  [DataSubtype.COREDUMP]: 'coredump',
  [DataSubtype.NVS_KEYS]: 'nvs_keys',
  [DataSubtype.EFUSE_EM]: 'efuse',
  [DataSubtype.UNDEFINED]: 'undefined',
  [DataSubtype.FAT]:      'fat',
  [DataSubtype.SPIFFS]:   'spiffs',
  [DataSubtype.LITTLEFS]: 'littlefs',
};

/** Human-readable bootloader subtype name map */
export const BOOTLOADER_SUBTYPE_NAMES: Record<number, string> = {
  [BootloaderSubtype.PRIMARY]:  'primary',
  [BootloaderSubtype.OTA]:      'ota',
  [BootloaderSubtype.RECOVERY]: 'recovery',
};

/** Human-readable partition table subtype name map */
export const PART_TABLE_SUBTYPE_NAMES: Record<number, string> = {
  [PartTableSubtype.PRIMARY]: 'primary',
  [PartTableSubtype.OTA]:     'ota',
};

/** Subtype name maps keyed by PartitionType */
const SUBTYPE_NAME_MAPS: Partial<Record<PartitionType, Record<number, string>>> = {
  [PartitionType.APP]:             APP_SUBTYPE_NAMES,
  [PartitionType.DATA]:            DATA_SUBTYPE_NAMES,
  [PartitionType.BOOTLOADER]:      BOOTLOADER_SUBTYPE_NAMES,
  [PartitionType.PARTITION_TABLE]: PART_TABLE_SUBTYPE_NAMES,
};

/** Get human-readable subtype name */
export function getSubtypeName(type: PartitionType, subtype: number): string {
  const map = SUBTYPE_NAME_MAPS[type];
  return map?.[subtype] ?? `0x${subtype.toString(16).padStart(2, '0')}`;
}

/** Reverse lookup: type name string → PartitionType */
export const NAME_TO_TYPE: Record<string, PartitionType> = {
  'app':             PartitionType.APP,
  'data':            PartitionType.DATA,
  'bootloader':      PartitionType.BOOTLOADER,
  'partition_table': PartitionType.PARTITION_TABLE,
};

/** Reverse lookup: subtype name → number, keyed by parent type */
export function subtypeFromName(type: PartitionType, name: string): number {
  const normalized = name.trim().toLowerCase();
  const map = SUBTYPE_NAME_MAPS[type];
  if (map) {
    for (const [val, n] of Object.entries(map)) {
      if (n === normalized) return Number(val);
    }
  }
  // Try numeric parse (decimal or hex) — full-string, byte-range validated
  if (normalized.startsWith('0x')) {
    if (!/^0x[0-9a-f]+$/i.test(normalized)) throw new Error(`Unknown partition subtype: "${name}"`);
    const v = parseInt(normalized, 16);
    if (isNaN(v) || v < 0 || v > 255) throw new Error(`Subtype value out of byte range: "${name}"`);
    return v;
  } else {
    if (!/^\d+$/.test(normalized)) throw new Error(`Unknown partition subtype: "${name}"`);
    const v = parseInt(normalized, 10);
    if (v > 255) throw new Error(`Subtype value out of byte range: "${name}"`);
    return v;
  }
  throw new Error(`Unknown partition subtype: "${name}"`);
}
