/** Erreur destinée au client : le statut HTTP, un code stable et un message en français. */
export class ApiHttpError extends Error {
  status: number;
  code: string;
  retryAfter: number | undefined;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function asApiError(err: unknown): ApiHttpError {
  if (err instanceof ApiHttpError) return err;
  return new ApiHttpError(500, 'internal', 'Erreur interne du serveur.');
}

const STATUS_BY_CODE: Record<string, number> = {
  invalid_key: 401,
  plan_required: 403,
  symbol_not_found: 404,
  no_data: 404,
  rate_limited: 429,
  daily_limit: 429,
  bad_request: 400,
  network: 502,
  upstream: 502,
};

export function statusForCode(code: string): number {
  return STATUS_BY_CODE[code] ?? 500;
}
