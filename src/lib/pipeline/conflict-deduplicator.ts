export interface ConflictKeyRecord {
  source_domain: string;
  source_identifier: string;
}

export interface ConflictDeduplicationResult<T> {
  records: T[];
  collapsed: number;
}

/**
 * PostgreSQL cannot update the same conflict target twice within one upsert
 * statement. Collapse repeated source keys across the entire run before the
 * records are divided into database chunks.
 */
export function collapseConflictKeyDuplicates<T extends ConflictKeyRecord>(
  records: readonly T[],
  prefer: (current: T, candidate: T) => T = (current) => current
): ConflictDeduplicationResult<T> {
  const deduplicated: T[] = [];
  const indexByConflictKey = new Map<string, number>();
  let collapsed = 0;

  for (const record of records) {
    const key = `${record.source_domain}\u0000${record.source_identifier}`;
    const existingIndex = indexByConflictKey.get(key);

    if (existingIndex === undefined) {
      indexByConflictKey.set(key, deduplicated.length);
      deduplicated.push(record);
      continue;
    }

    collapsed++;
    deduplicated[existingIndex] = prefer(deduplicated[existingIndex], record);
  }

  return { records: deduplicated, collapsed };
}
