// Module shims for vendored/untyped packages used by esp-flasher
declare module 'crypto-js'

// Global ambient Web Serial API types consumed by lib_esptools-js/webserial.d.ts and EspFlasher.vue.
// This file must have no imports/exports so declarations are ambient (global scope).
// This file has no imports/exports so all declarations are ambient (global).
// navigator.serial is not yet part of TypeScript's lib.dom.d.ts.

type ParityType = 'none' | 'even' | 'odd'
type FlowControlType = 'none' | 'hardware'

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[]
}

interface SerialPort extends EventTarget {
  open(options: { baudRate: number; [k: string]: unknown }): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  getInfo(): SerialPortInfo
}

interface Navigator {
  readonly serial: {
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
    getPorts(): Promise<SerialPort[]>
  }
}
