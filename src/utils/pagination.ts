export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginationResult {
  skip: number;
  take: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export const getPagination = (query: PaginationQuery): PaginationResult => {
  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? query.limit : 10;
  const skip = (page - 1) * limit;

  return {
    skip,
    take: limit,
  };
};

export const getPaginationMeta = (
  page: number,
  limit: number,
  totalItems: number,
): PaginationMeta => {
  const totalPages = Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};
