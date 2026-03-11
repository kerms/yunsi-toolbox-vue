// Types
export type {
  ImageHeader, ExtendedHeader, SegmentHeader,
  AppDescription, AppImageInfo,
} from './types';

export {
  SpiFlashMode, SpiFlashSpeed, SpiFlashSize,
  SPI_FLASH_MODE_NAMES, SPI_FLASH_SPEED_NAMES, SPI_FLASH_SIZE_NAMES,
} from './types';

// Constants
export {
  IMAGE_MAGIC, IMAGE_HEADER_SIZE, EXTENDED_HEADER_SIZE,
  SEGMENT_HEADER_SIZE, APP_DESC_MAGIC, APP_DESC_SIZE,
  CHIP_ID_NAMES,
} from './constants';

// Parser
export { parseAppImage } from './parser';

// Ranges (field ↔ hex highlighting)
export { computeFieldRanges } from './ranges';
export type { FieldDef, FieldGroup } from './ranges';
