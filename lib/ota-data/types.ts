/** OTA image state enum matching ESP-IDF esp_ota_img_states_t */
export enum OtaImgState {
  NEW            = 0x0,
  PENDING_VERIFY = 0x1,
  VALID          = 0x2,
  INVALID        = 0x3,
  ABORTED        = 0x4,
  UNDEFINED      = 0xFFFFFFFF,
}

export const OTA_STATE_NAMES: Record<number, string> = {
  [OtaImgState.NEW]:            'new',
  [OtaImgState.PENDING_VERIFY]: 'pending_verify',
  [OtaImgState.VALID]:          'valid',
  [OtaImgState.INVALID]:        'invalid',
  [OtaImgState.ABORTED]:        'aborted',
  [OtaImgState.UNDEFINED]:      'undefined',
};

/** A single OTA select entry (parsed from 32-byte structure) */
export interface OtaSelectEntry {
  seq: number;
  label: string;
  state: OtaImgState;
  crc: number;
  crcValid: boolean;
}

/** Parsed OTA data partition */
export interface OtaData {
  entries: [OtaSelectEntry, OtaSelectEntry];
  /** Index of the active entry (0 or 1), null if neither is valid */
  activeIndex: number | null;
  /** Derived OTA partition name, e.g. "ota_0", "ota_1" */
  activeOtaPartition: string | null;
}
