// ── Little-endian read helpers ─────────────────────────────────────

export function readU8(buf: Uint8Array, off: number): number {
  return buf[off];
}

export function readU16(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

export function readU32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

export function readI8(buf: Uint8Array, off: number): number {
  const v = buf[off];
  return v > 127 ? v - 256 : v;
}

export function readI16(buf: Uint8Array, off: number): number {
  const v = readU16(buf, off);
  return v > 32767 ? v - 65536 : v;
}

export function readI32(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
}

export function readU64(buf: Uint8Array, off: number): bigint {
  const lo = BigInt(readU32(buf, off));
  const hi = BigInt(readU32(buf, off + 4));
  return (hi << 32n) | lo;
}

export function readI64(buf: Uint8Array, off: number): bigint {
  const v = readU64(buf, off);
  return v > 0x7FFFFFFFFFFFFFFFn ? v - 0x10000000000000000n : v;
}

/** Read null-terminated byte string of max `maxLen` bytes, preserving all byte values 0x01–0xFF */
export function readNullTermString(buf: Uint8Array, off: number, maxLen: number): string {
  let result = '';
  for (let i = off; i < off + maxLen; i++) {
    if (buf[i] === 0) break;
    result += String.fromCharCode(buf[i]);
  }
  return result;
}
