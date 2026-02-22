import {
  NvsEntry, NvsPartition, NvsFlashStats, NvsType, NvsVersion,
  isPrimitiveType,
} from './types';
import { ENTRIES_PER_PAGE, ENTRY_SIZE, PAGE_SIZE, MAX_KEY_LENGTH, MAX_NAMESPACES, MAX_STRING_LENGTH, MAX_BLOB_SIZE_V1, MAX_BLOB_SIZE_V2 } from './constants';

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
  // If namespace changed, ensure it's in the list
  let namespaces = partition.namespaces;
  if (updates.namespace && !namespaces.includes(updates.namespace)) {
    namespaces = [...namespaces, updates.namespace];
  }
  // Clean up unused namespaces
  const usedNs = new Set(entries.map(e => e.namespace));
  namespaces = namespaces.filter(ns => usedNs.has(ns));
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

  return { ...target, entries, namespaces };
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
  const spans: number[] = [];
  for (const _ns of partition.namespaces) spans.push(1);
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

/** Validate partition data. Returns array of error messages (empty = valid). */
export function validatePartition(partition: NvsPartition): string[] {
  const errors: string[] = [];

  if (partition.namespaces.length > MAX_NAMESPACES) {
    errors.push(`命名空间数量超过上限 ${MAX_NAMESPACES}`);
  }

  for (const ns of partition.namespaces) {
    if (ns.length === 0) {
      errors.push('命名空间名称不能为空');
    }
    if (ns.length > MAX_KEY_LENGTH) {
      errors.push(`命名空间 "${ns}" 名称超过 ${MAX_KEY_LENGTH} 字符`);
    }
  }

  for (const entry of partition.entries) {
    if (entry.key.length === 0) {
      errors.push(`在命名空间 "${entry.namespace}" 中存在空键名`);
    }
    if (entry.key.length > MAX_KEY_LENGTH) {
      errors.push(`键 "${entry.key}" 名称超过 ${MAX_KEY_LENGTH} 字符`);
    }
    if (!partition.namespaces.includes(entry.namespace)) {
      errors.push(`键 "${entry.key}" 的命名空间 "${entry.namespace}" 未注册`);
    }

    // Validate value ranges for primitive types
    if (isPrimitiveType(entry.type)) {
      if (typeof entry.value === 'number') {
        const v = entry.value;
        switch (entry.type) {
          case NvsType.U8:  if (v < 0 || v > 0xFF) errors.push(`"${entry.key}" U8 值超出范围`); break;
          case NvsType.I8:  if (v < -128 || v > 127) errors.push(`"${entry.key}" I8 值超出范围`); break;
          case NvsType.U16: if (v < 0 || v > 0xFFFF) errors.push(`"${entry.key}" U16 值超出范围`); break;
          case NvsType.I16: if (v < -32768 || v > 32767) errors.push(`"${entry.key}" I16 值超出范围`); break;
          case NvsType.U32: if (v < 0 || v > 0xFFFFFFFF) errors.push(`"${entry.key}" U32 值超出范围`); break;
          case NvsType.I32: if (v < -2147483648 || v > 2147483647) errors.push(`"${entry.key}" I32 值超出范围`); break;
        }
      } else if (typeof entry.value === 'bigint') {
        const v = entry.value;
        switch (entry.type) {
          case NvsType.U64:
            if (v < 0n || v > 0xFFFFFFFFFFFFFFFFn) errors.push(`"${entry.key}" U64 值超出范围`);
            break;
          case NvsType.I64:
            if (v < -9223372036854775808n || v > 9223372036854775807n) errors.push(`"${entry.key}" I64 值超出范围`);
            break;
        }
      }
    }

    // Validate string length
    if (entry.type === NvsType.SZ && typeof entry.value === 'string') {
      const byteLen = new TextEncoder().encode(entry.value).length;
      if (byteLen >= MAX_STRING_LENGTH) {
        errors.push(`"${entry.key}" 字符串长度 ${byteLen} 字节超过上限 ${MAX_STRING_LENGTH - 1}`);
      }
    }

    // Validate blob size
    // NvsType.BLOB uses the legacy V1 single-page format regardless of partition version,
    // so it is always capped at MAX_BLOB_SIZE_V1.
    // NvsType.BLOB_DATA uses the V2 chunked format and is capped at MAX_BLOB_SIZE_V2.
    if (entry.type === NvsType.BLOB && entry.value instanceof Uint8Array) {
      if (entry.value.length > MAX_BLOB_SIZE_V1) {
        errors.push(`"${entry.key}" BLOB ${entry.value.length} 字节超过上限 ${MAX_BLOB_SIZE_V1}`);
      }
    } else if (entry.type === NvsType.BLOB_DATA && entry.value instanceof Uint8Array) {
      if (entry.value.length > MAX_BLOB_SIZE_V2) {
        errors.push(`"${entry.key}" BLOB ${entry.value.length} 字节超过 V2 上限 ${MAX_BLOB_SIZE_V2}`);
      }
    }
  }

  // Check for duplicate (namespace, key) pairs
  const seen = new Set<string>();
  for (const entry of partition.entries) {
    const k = `${entry.namespace}::${entry.key}`;
    if (seen.has(k)) {
      errors.push(`重复键: ${entry.namespace}/${entry.key}`);
    }
    seen.add(k);
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
