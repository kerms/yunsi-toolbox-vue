/**
 * Pre-computed CRC32 lookup table using reflected polynomial 0xEDB88320.
 * Compatible with zlib.crc32() used by ESP-IDF.
 */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
    table[i] = crc;
  }
  return table;
})();

/** Compute CRC32 of a Uint8Array. Returns unsigned 32-bit integer. */
export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
