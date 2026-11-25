export const TABLE_PAGE_SIZE = 10;

export function cursorPage<T>(
  items: readonly T[],
  cursor: number,
  limit = TABLE_PAGE_SIZE,
): T[] {
  const pageSize = Math.max(1, Math.floor(limit));
  const lastCursor = Math.floor(Math.max(items.length - 1, 0) / pageSize) * pageSize;
  const start = Math.min(Math.max(0, Math.floor(cursor)), lastCursor);
  return items.slice(start, start + pageSize);
}
