export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function toHttpError(error: unknown): {
  status: number;
  body: { code: string; message: string };
} {
  if (error instanceof DomainError) {
    return {
      status: error.httpStatus,
      body: { code: error.code, message: error.message },
    };
  }
  return {
    status: 500,
    body: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  };
}
