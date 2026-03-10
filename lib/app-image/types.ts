export enum SpiFlashMode {
  QIO  = 0,
  QOUT = 1,
  DIO  = 2,
  DOUT = 3,
}

export enum SpiFlashSpeed {
  SPEED_40M = 0x0,
  SPEED_26M = 0x1,
  SPEED_20M = 0x2,
  SPEED_80M = 0xF,
}

export enum SpiFlashSize {
  SIZE_1MB   = 0x0,
  SIZE_2MB   = 0x1,
  SIZE_4MB   = 0x2,
  SIZE_8MB   = 0x3,
  SIZE_16MB  = 0x4,
  SIZE_32MB  = 0x5,
  SIZE_64MB  = 0x6,
  SIZE_128MB = 0x7,
}

export interface ImageHeader {
  magic: number;
  segmentCount: number;
  spiMode: SpiFlashMode;
  spiSpeed: SpiFlashSpeed;
  spiSize: SpiFlashSize;
  entryPoint: number;
}

export interface ExtendedHeader {
  wpPin: number;
  spiPinDrv: [number, number, number];
  chipId: number;
  minChipRev: number;
  minChipRevFull: number;
  maxChipRevFull: number;
  hashAppended: boolean;
}

export interface SegmentHeader {
  loadAddr: number;
  dataLen: number;
}

export interface AppDescription {
  magicWord: number;
  secureVersion: number;
  version: string;
  projectName: string;
  compileTime: string;
  compileDate: string;
  idfVersion: string;
  appElfSha256: Uint8Array;
}

export interface AppImageInfo {
  header: ImageHeader;
  extendedHeader: ExtendedHeader;
  segments: SegmentHeader[];
  appDescription: AppDescription | null;
  valid: boolean;
  chipName: string;
}

export const SPI_FLASH_MODE_NAMES: Record<number, string> = {
  [SpiFlashMode.QIO]:  'QIO',
  [SpiFlashMode.QOUT]: 'QOUT',
  [SpiFlashMode.DIO]:  'DIO',
  [SpiFlashMode.DOUT]: 'DOUT',
};

export const SPI_FLASH_SPEED_NAMES: Record<number, string> = {
  [SpiFlashSpeed.SPEED_40M]: '40MHz',
  [SpiFlashSpeed.SPEED_26M]: '26MHz',
  [SpiFlashSpeed.SPEED_20M]: '20MHz',
  [SpiFlashSpeed.SPEED_80M]: '80MHz',
};

export const SPI_FLASH_SIZE_NAMES: Record<number, string> = {
  [SpiFlashSize.SIZE_1MB]:   '1MB',
  [SpiFlashSize.SIZE_2MB]:   '2MB',
  [SpiFlashSize.SIZE_4MB]:   '4MB',
  [SpiFlashSize.SIZE_8MB]:   '8MB',
  [SpiFlashSize.SIZE_16MB]:  '16MB',
  [SpiFlashSize.SIZE_32MB]:  '32MB',
  [SpiFlashSize.SIZE_64MB]:  '64MB',
  [SpiFlashSize.SIZE_128MB]: '128MB',
};
