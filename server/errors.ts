import type { Context } from "hono";

export type ErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  status: number;
  payload: ErrorPayload;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.payload = { code, message, details };
  }
}

export const jsonError = (c: Context, error: ApiError | Error) => {
  if (error instanceof ApiError) {
    return c.json(
      { error: error.payload },
      error.status as 400 | 404 | 409 | 422 | 500,
    );
  }
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    },
    500 as const,
  );
};

export const badRequest = (
  message: string,
  details?: Record<string, unknown>,
) => new ApiError(400, "invalid_request", message, details);

export const notFound = (message: string, details?: Record<string, unknown>) =>
  new ApiError(404, "not_found", message, details);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError(409, "conflict", message, details);

export const unprocessable = (
  message: string,
  details?: Record<string, unknown>,
) => new ApiError(422, "unprocessable_entity", message, details);
