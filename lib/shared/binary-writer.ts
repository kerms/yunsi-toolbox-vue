// ── Little-endian write helpers ────────────────────────────────────

export function writeU8(buf: Uint8Array, off: number, val: number) {
  buf[off] = val & 0xFF;
}

export function writeU16(buf: Uint8Array, off: number, val: number) {
  buf[off] = val & 0xFF;
  buf[off + 1] = (val >> 8) & 0xFF;
}

export function writeU32(buf: Uint8Array, off: number, val: number) {
  buf[off] = val & 0xFF;
  buf[off + 1] = (val >> 8) & 0xFF;
  buf[off + 2] = (val >> 16) & 0xFF;
  buf[off + 3] = (val >> 24) & 0xFF;
}

export function writeI8(buf: Uint8Array, off: number, val: number) {
  buf[off] = val < 0 ? val + 256 : val;
}

export function writeI16(buf: Uint8Array, off: number, val: number) {
  const u = val < 0 ? val + 65536 : val;
  writeU16(buf, off, u);
}

export function writeI32(buf: Uint8Array, off: number, val: number) {
  writeU32(buf, off, val < 0 ? val + 0x100000000 : val);
}

export function writeU64(buf: Uint8Array, off: number, val: bigint) {
  const lo = Number(val & 0xFFFFFFFFn);
  const hi = Number((val >> 32n) & 0xFFFFFFFFn);
  writeU32(buf, off, lo);
  writeU32(buf, off + 4, hi);
}

export function writeI64(buf: Uint8Array, off: number, val: bigint) {
  const u = val < 0n ? val + 0x10000000000000000n : val;
  writeU64(buf, off, u);
}

/** Write null-terminated byte string padded to `fieldSize` bytes, preserving all byte values 0x01–0xFF */
export function writeNullTermString(buf: Uint8Array, off: number, str: string, fieldSize: number) {
  buf.fill(0, off, off + fieldSize);
  const len = Math.min(str.length, fieldSize - 1);
  for (let i = 0; i < len; i++) {
    buf[off + i] = str.charCodeAt(i) & 0xFF;
  }
}
