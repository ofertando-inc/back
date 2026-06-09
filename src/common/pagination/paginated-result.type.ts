export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

// A paginated result that also carries the total count of matching rows
// (used where the client needs a real result counter, e.g. the offers search).
export interface CountedPaginatedResult<T> extends PaginatedResult<T> {
  total: number;
}
