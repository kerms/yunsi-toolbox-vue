import type { NvsEntry, NvsPartition, NvsFlashStats } from './types';
import { NvsType, NvsVersion, isPrimitiveType } from './types';
import { ENTRIES_PER_PAGE, ENTRY_SIZE, PAGE_SIZE, MAX_KEY_LENGTH, MAX_NAMESPACES, MAX_STRING_LENGTH, MAX_BLOB_SIZE_V1, MAX_BLOB_SIZE_V2 } from './constants';

/** Result of normalizing a raw deserialized partition. */
export interface NormalizeResult {
  partition: NvsPartition;
  /** Entries that were completely unsalvageable and removed. */
  dropped: number;
  /** Entries whose numeric values were clamped to fit the type range. */
  clamped: number;
}

/** Generate a random unique ID for client-side entry tracking */
export function generateEntryId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Create an empty partition with default V2 version */
export function createEmptyPartition(version: NvsVersion = NvsVersion.V2): NvsPartition {
  return { entries: [], namespaces: [], version };
}

/** Add a new entry. Returns a new NvsPartition (immutable). */
export function addEntry(
  partition: NvsPartition,
  entry: Omit<NvsEntry, 'id'>,
): NvsPartition {
  const newEntry: NvsEntry = { ...entry, id: generateEntryId() };
  const namespaces = partition.namespaces.includes(entry.namespace)
    ? partition.namespaces
    : [...partition.namespaces, entry.namespace];
  return {
    ...partition,
    entries: [...partition.entries, newEntry],
    namespaces,
  };
}

/** Remove an entry by ID. Returns a new NvsPartition. */
export function removeEntry(partition: NvsPartition, entryId: string): NvsPartition {
  const entries = partition.entries.filter(e => e.id !== entryId);
  // Clean up namespaces that have no remaining entries
  const usedNs = new Set(entries.map(e => e.namespace));
  const namespaces = partition.namespaces.filter(ns => usedNs.has(ns));
  return { ...partition, entries, namespaces };
}

/** Update an existing entry. Returns a new NvsPartition. */
export function updateEntry(
  partition: NvsPartition,
  entryId: string,
  updates: Partial<Omit<NvsEntry, 'id'>>,
): NvsPartition {
  const entries = partition.entries.map(e =>
    e.id === entryId ? { ...e, ...updates } : e,
  );
  // If namespace changed, add it. Intentionally does NOT remove the old namespace:
  // partition.namespaces doubles as a UI dropdown convenience list; orphaned entries
  // are silently filtered out at serialization/validation/restore boundaries.
  let namespaces = partition.namespaces;
  if (updates.namespace && !namespaces.includes(updates.namespace)) {
    namespaces = [...namespaces, updates.namespace];
  }
  return { ...partition, entries, namespaces };
}

/** Duplicate an entry with a new ID. */
export function duplicateEntry(partition: NvsPartition, entryId: string): NvsPartition {
  const source = partition.entries.find(e => e.id === entryId);
  if (!source) return partition;
  const clone: NvsEntry = {
    ...source,
    id: generateEntryId(),
    key: source.key,
    // Deep copy Uint8Array values
    value: source.value instanceof Uint8Array
      ? new Uint8Array(source.value)
      : source.value,
  };
  return { ...partition, entries: [...partition.entries, clone] };
}

/**
 * Merge source into target by (namespace, key) match.
 * @param mode 'overwrite' replaces matching entries; 'skip' keeps target's value
 */
export function mergePartitions(
  target: NvsPartition,
  source: NvsPartition,
  mode: 'overwrite' | 'skip' = 'overwrite',
): NvsPartition {
  const entries = [...target.entries];
  const namespaces = [...target.namespaces];

  for (const srcEntry of source.entries) {
    if (!namespaces.includes(srcEntry.namespace)) {
      namespaces.push(srcEntry.namespace);
    }
    const idx = entries.findIndex(
      e => e.namespace === srcEntry.namespace && e.key === srcEntry.key,
    );
    if (idx >= 0) {
      if (mode === 'overwrite') {
        entries[idx] = { ...srcEntry, id: entries[idx].id };
      }
      // skip: do nothing
    } else {
      entries.push({ ...srcEntry, id: generateEntryId() });
    }
  }

  return { ...target, entries: reconcileBlobTypes(entries, target.version), namespaces };
}

/** Calculate the entry span for a single NvsEntry */
export function entrySpan(entry: NvsEntry, version: NvsVersion): number {
  if (isPrimitiveType(entry.type)) return 1;

  if (entry.type === NvsType.SZ) {
    const strBytes = new TextEncoder().encode(entry.value as string);
    const dataLen = strBytes.length + 1; // +1 for null terminator
    return 1 + Math.ceil(dataLen / ENTRY_SIZE);
  }

  // BLOB / BLOB_DATA
  const data = entry.value as Uint8Array;
  if (version === NvsVersion.V1 || entry.type === NvsType.BLOB) {
    return 1 + Math.ceil(data.length / ENTRY_SIZE);
  }

  // V2: BLOB_DATA chunks + BLOB_IDX — each chunk has its own header entry
  const maxChunkPayload = (ENTRIES_PER_PAGE - 1) * ENTRY_SIZE;
  const chunkCount = Math.max(1, Math.ceil(data.length / maxChunkPayload));
  let totalSpan = 0;
  let remaining = data.length;
  for (let i = 0; i < chunkCount; i++) {
    const chunkLen = Math.min(remaining, maxChunkPayload);
    totalSpan += 1 + Math.ceil(chunkLen / ENTRY_SIZE);
    remaining -= chunkLen;
  }
  return totalSpan + 1; // +1 for BLOB_IDX entry
}

/** Calculate flash usage statistics for a given partition at a target size */
export function calculateFlashStats(
  partition: NvsPartition,
  targetSizeBytes: number,
): NvsFlashStats {
  const totalPages = Math.floor(targetSizeBytes / PAGE_SIZE);
  const usablePages = Math.max(totalPages - 1, 0); // reserve 1 for GC
  const maxEntries = usablePages * ENTRIES_PER_PAGE;

  // Build a flat list of entry spans (namespace defs + data entries)
  // Derive used namespaces from entries (ignores orphaned namespaces)
  const usedNs = new Set(partition.entries.map(e => e.namespace));
  const activeNs = partition.namespaces.filter(ns => usedNs.has(ns));
  const spans: number[] = [];
  for (const _ns of activeNs) spans.push(1);
  for (const entry of partition.entries) spans.push(entrySpan(entry, partition.version));

  // Simulate page-packing to count actual slot consumption (including fragmentation waste).
  // Entries cannot span page boundaries; remaining slots on a page are wasted when an entry
  // doesn't fit, identical to the serializer's behaviour.
  let currentEntryIdx = 0;
  let totalSlotsUsed = 0;
  for (const span of spans) {
    if (currentEntryIdx + span > ENTRIES_PER_PAGE) {
      totalSlotsUsed += ENTRIES_PER_PAGE - currentEntryIdx; // wasted slots
      currentEntryIdx = 0;
    }
    totalSlotsUsed += span;
    currentEntryIdx += span;
    if (currentEntryIdx >= ENTRIES_PER_PAGE) currentEntryIdx = 0;
  }

  const logicalEntries = spans.reduce((a, b) => a + b, 0);
  const usedBytes = totalSlotsUsed * ENTRY_SIZE + totalPages * 64; // 64 = header + bitmap
  const usagePercent = maxEntries > 0 ? Math.min((totalSlotsUsed / maxEntries) * 100, 100) : 0;

  return {
    totalBytes: targetSizeBytes,
    totalPages,
    usedEntries: logicalEntries,
    maxEntries,
    usedBytes,
    usagePercent: Math.round(usagePercent * 10) / 10,
  };
}

/** Structured validation error with optional entry ID for precise highlighting. */
export interface ValidationError {
  message: string;
  /** Entry ID that caused the error, undefined for partition-level errors. */
  entryId?: string;
}

/** Validate partition data. Returns array of validation errors (empty = valid). */
export function validatePartition(partition: NvsPartition): ValidationError[] {
  const errors: ValidationError[] = [];

  // Derive active namespaces from entries (ignore orphaned namespaces left by updateEntry)
  const usedNs = new Set(partition.entries.map(e => e.namespace));
  const activeNs = partition.namespaces.filter(ns => usedNs.has(ns));

  if (activeNs.length > MAX_NAMESPACES) {
    errors.push({ message: `Namespace count exceeds limit ${MAX_NAMESPACES}` });
  }

  for (const ns of activeNs) {
    if (ns.length === 0) {
      errors.push({ message: 'Namespace name cannot be empty' });
    }
    if (ns.length > MAX_KEY_LENGTH) {
      errors.push({ message: `Namespace "${ns}" exceeds ${MAX_KEY_LENGTH} characters` });
    }
    if ([...ns].some(c => c.charCodeAt(0) > 0xFF)) {
      errors.push({ message: `Namespace "${ns}" contains non-Latin-1 characters (binary format only supports 8-bit characters)` });
    }
  }

  for (const entry of partition.entries) {
    const eid = entry.id;
    if (entry.key.length === 0) {
      errors.push({ message: `Empty key in namespace "${entry.namespace}"`, entryId: eid });
    }
    if (entry.key.length > MAX_KEY_LENGTH) {
      errors.push({ message: `Key "${entry.key}" exceeds ${MAX_KEY_LENGTH} characters`, entryId: eid });
    }
    if ([...entry.key].some(c => c.charCodeAt(0) > 0xFF)) {
      errors.push({ message: `Key "${entry.key}" contains non-Latin-1 characters`, entryId: eid });
    }
    if (!partition.namespaces.includes(entry.namespace)) {
      errors.push({ message: `Key "${entry.key}" references unregistered namespace "${entry.namespace}"`, entryId: eid });
    }

    // Validate value ranges for primitive types
    if (isPrimitiveType(entry.type)) {
      if (typeof entry.value === 'number') {
        const v = entry.value;
        switch (entry.type) {
          case NvsType.U8:  if (v < 0 || v > 0xFF) errors.push({ message: `"${entry.key}" U8 value out of range`, entryId: eid }); break;
          case NvsType.I8:  if (v < -128 || v > 127) errors.push({ message: `"${entry.key}" I8 value out of range`, entryId: eid }); break;
          case NvsType.U16: if (v < 0 || v > 0xFFFF) errors.push({ message: `"${entry.key}" U16 value out of range`, entryId: eid }); break;
          case NvsType.I16: if (v < -32768 || v > 32767) errors.push({ message: `"${entry.key}" I16 value out of range`, entryId: eid }); break;
          case NvsType.U32: if (v < 0 || v > 0xFFFFFFFF) errors.push({ message: `"${entry.key}" U32 value out of range`, entryId: eid }); break;
          case NvsType.I32: if (v < -2147483648 || v > 2147483647) errors.push({ message: `"${entry.key}" I32 value out of range`, entryId: eid }); break;
        }
      } else if (typeof entry.value === 'bigint') {
        const v = entry.value;
        switch (entry.type) {
          case NvsType.U64:
            if (v < 0n || v > 0xFFFFFFFFFFFFFFFFn) errors.push({ message: `"${entry.key}" U64 value out of range`, entryId: eid });
            break;
          case NvsType.I64:
            if (v < -9223372036854775808n || v > 9223372036854775807n) errors.push({ message: `"${entry.key}" I64 value out of range`, entryId: eid });
            break;
        }
      }
    }

    // Validate string length
    if (entry.type === NvsType.SZ && typeof entry.value === 'string') {
      const byteLen = new TextEncoder().encode(entry.value).length;
      if (byteLen >= MAX_STRING_LENGTH) {
        errors.push({ message: `"${entry.key}" string length ${byteLen} bytes exceeds limit ${MAX_STRING_LENGTH - 1}`, entryId: eid });
      }
    }

    // Validate blob size
    if (entry.type === NvsType.BLOB && entry.value instanceof Uint8Array) {
      if (entry.value.length > MAX_BLOB_SIZE_V1) {
        errors.push({ message: `"${entry.key}" BLOB ${entry.value.length} bytes exceeds limit ${MAX_BLOB_SIZE_V1}`, entryId: eid });
      }
    } else if (entry.type === NvsType.BLOB_DATA && entry.value instanceof Uint8Array) {
      if (entry.value.length > MAX_BLOB_SIZE_V2) {
        errors.push({ message: `"${entry.key}" BLOB ${entry.value.length} bytes exceeds V2 limit ${MAX_BLOB_SIZE_V2}`, entryId: eid });
      }
    }

    if (entry.type === NvsType.BLOB_IDX) {
      errors.push({ message: `"${entry.key}" has internal-only type BLOB_IDX`, entryId: eid });
    }
    if (entry.type === NvsType.BLOB_DATA && partition.version === NvsVersion.V1) {
      errors.push({ message: `"${entry.key}" has V2-only type BLOB_DATA in a V1 partition`, entryId: eid });
    }
    if (entry.type === NvsType.BLOB && partition.version === NvsVersion.V2) {
      errors.push({ message: `"${entry.key}" has V1-only type BLOB in a V2 partition`, entryId: eid });
    }
  }

  // Check for duplicate (namespace, key) pairs
  const seen = new Map<string, string>(); // composite key → first entry ID
  const alreadyFlagged = new Set<string>(); // first-entry IDs already given one error
  for (const entry of partition.entries) {
    const k = `${entry.namespace}::${entry.key}`;
    if (seen.has(k)) {
      errors.push({ message: `Duplicate key: ${entry.namespace}/${entry.key}`, entryId: entry.id });
      const firstId = seen.get(k)!;
      if (!alreadyFlagged.has(firstId)) {
        errors.push({ message: `Duplicate key: ${entry.namespace}/${entry.key}`, entryId: firstId });
        alreadyFlagged.add(firstId);
      }
    } else {
      seen.set(k, entry.id);
    }
  }

  return errors;
}

/** Sort entries by namespace, then by key */
export function sortEntries(partition: NvsPartition): NvsPartition {
  const entries = [...partition.entries].sort((a, b) => {
    const nsCmp = a.namespace.localeCompare(b.namespace);
    return nsCmp !== 0 ? nsCmp : a.key.localeCompare(b.key);
  });
  return { ...partition, entries };
}

/**
 * Coerce BLOB/BLOB_DATA types to match partition version.
 * V1 partitions use monolithic BLOB (0x41); V2 partitions use chunked BLOB_DATA (0x42).
 * Must be called at every import boundary (JSON, localStorage, binary parser).
 */
export function reconcileBlobTypes(entries: NvsEntry[], version: NvsVersion): NvsEntry[] {
  return entries.map(e => {
    if (version === NvsVersion.V1 && e.type === NvsType.BLOB_DATA) return { ...e, type: NvsType.BLOB };
    if (version === NvsVersion.V2 && e.type === NvsType.BLOB)      return { ...e, type: NvsType.BLOB_DATA };
    return e;
  });
}

/**
 * Normalize and validate a raw deserialized object into a well-formed NvsPartition.
 * Single gate for all deserialization paths (localStorage restore + JSON import/merge).
 * Never throws. Regenerates missing/duplicate ids. Strips NUL bytes from keys and namespaces.
 * Returns metadata about dropped and clamped entries for UI warnings.
 */
export function normalizePartition(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { partition: createEmptyPartition(), dropped: 0, clamped: 0 };
  }
  const obj = raw as Record<string, unknown>;

  const VALID_VERSIONS = new Set<number>([NvsVersion.V1, NvsVersion.V2]);
  const version: NvsVersion =
    typeof obj.version === 'number' && VALID_VERSIONS.has(obj.version)
      ? (obj.version as NvsVersion)
      : NvsVersion.V2;

  // BLOB_IDX (0x48) is synthesized internally by the serializer; it is never a valid
  // user entry. All other NvsType values are acceptable user input.
  const VALID_TYPES = new Set<number>([
    NvsType.U8, NvsType.I8, NvsType.U16, NvsType.I16,
    NvsType.U32, NvsType.I32, NvsType.U64, NvsType.I64,
    NvsType.SZ, NvsType.BLOB, NvsType.BLOB_DATA,
  ]);
  const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
  const seenIds = new Set<string>();
  const entries: NvsEntry[] = [];
  let dropped = 0;
  let clamped = 0;

  for (const re of rawEntries) {
    if (!re || typeof re !== 'object' || Array.isArray(re)) { dropped++; continue; }
    const r = re as Record<string, unknown>;
    if (typeof r.type !== 'number' || !VALID_TYPES.has(r.type)) { dropped++; continue; }
    const type = r.type as NvsType;
    const namespace = typeof r.namespace === 'string' ? r.namespace.replace(/\0/g, '') : '';
    if (typeof r.key !== 'string') { dropped++; continue; }
    const key = r.key.replace(/\0/g, '');
    if (key.length === 0) { dropped++; continue; }
    const result = _normalizeEntryValue(type, r.value);
    if (result === null) { dropped++; continue; }
    if (result.clamped) clamped++;
    let id = typeof r.id === 'string' && r.id.length > 0 ? r.id : '';
    if (!id || seenIds.has(id)) id = generateEntryId();
    seenIds.add(id);
    entries.push({ id, namespace, key, type, value: result.value });
  }

  const reconciledEntries = reconcileBlobTypes(entries, version);

  // Rebuild namespaces: preserve stored order, deduplicate, add missing, drop unused
  const rawNs = Array.isArray(obj.namespaces) ? obj.namespaces : [];
  const orderedNs = (rawNs.filter((n): n is string => typeof n === 'string'))
    .reduce<string[]>((acc, n) => { if (!acc.includes(n)) acc.push(n); return acc; }, []);
  for (const e of reconciledEntries) {
    if (e.namespace && !orderedNs.includes(e.namespace)) orderedNs.push(e.namespace);
  }
  const usedNs = new Set(reconciledEntries.map(e => e.namespace));
  const namespaces = orderedNs.filter(n => usedNs.has(n));

  return { partition: { entries: reconciledEntries, namespaces, version }, dropped, clamped };
}

/** Returns normalized value for type, or null if unsalvageable. `clamped` is true if the value was modified. */
function _normalizeEntryValue(type: NvsType, raw: unknown): { value: NvsEntry['value']; clamped: boolean } | null {
  // U64/I64 MUST come before isPrimitiveType() check — isPrimitiveType includes them
  // but they require BigInt to avoid Number() precision loss above 2^53.
  if (type === NvsType.U64 || type === NvsType.I64) {
    if (typeof raw === 'bigint') return _clampBigInt(type, raw);
    if (typeof raw === 'number') return _clampBigInt(type, BigInt(Math.trunc(raw)));
    if (typeof raw === 'string') {
      try { return _clampBigInt(type, BigInt(raw)); } catch { return null; }
    }
    return null;
  }
  if (isPrimitiveType(type)) {
    let n: number;
    if (typeof raw === 'number') n = raw;
    else if (typeof raw === 'string') { n = Number(raw); if (Number.isNaN(n)) return null; }
    else return null;
    return _clampPrimitive(type, Math.trunc(n));
  }
  if (type === NvsType.SZ) return typeof raw === 'string' ? { value: raw, clamped: false } : null;
  // BLOB / BLOB_DATA / BLOB_IDX — already revived by partitionFromJson reviver
  if (raw instanceof Uint8Array) return { value: raw, clamped: false };
  return null; // malformed/missing blob payload — drop the entry
}

function _clampPrimitive(type: NvsType, n: number): { value: number; clamped: boolean } {
  let v: number;
  switch (type) {
    case NvsType.U8:  v = Math.max(0, Math.min(0xFF, n)); break;
    case NvsType.I8:  v = Math.max(-128, Math.min(127, n)); break;
    case NvsType.U16: v = Math.max(0, Math.min(0xFFFF, n)); break;
    case NvsType.I16: v = Math.max(-32768, Math.min(32767, n)); break;
    case NvsType.U32: v = Math.max(0, Math.min(0xFFFFFFFF, n)); break;
    case NvsType.I32: v = Math.max(-2147483648, Math.min(2147483647, n)); break;
    default:          v = n;
  }
  return { value: v, clamped: v !== n };
}

function _clampBigInt(type: NvsType, v: bigint): { value: bigint; clamped: boolean } {
  let r: bigint;
  if (type === NvsType.U64) {
    r = v < 0n ? 0n : v > 0xFFFFFFFFFFFFFFFFn ? 0xFFFFFFFFFFFFFFFFn : v;
  } else {
    // I64
    r = v < -9223372036854775808n ? -9223372036854775808n
      : v >  9223372036854775807n ?  9223372036854775807n : v;
  }
  return { value: r, clamped: r !== v };
}

/**
 * Check blob entries against the target version's size limit.
 * Returns human-readable warnings for each oversized blob.
 */
export function checkBlobCompatibility(
  entries: NvsEntry[],
  targetVersion: NvsVersion,
): string[] {
  const limit = targetVersion === NvsVersion.V1 ? MAX_BLOB_SIZE_V1 : MAX_BLOB_SIZE_V2;
  const warnings: string[] = [];
  for (const e of entries) {
    if ((e.type === NvsType.BLOB || e.type === NvsType.BLOB_DATA) &&
        e.value instanceof Uint8Array && e.value.length > limit) {
      warnings.push(`"${e.key}" (${e.value.length}B) 超出限制 ${limit}B`);
    }
  }
  return warnings;
}
