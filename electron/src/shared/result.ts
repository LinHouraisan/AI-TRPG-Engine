import type { OperationId } from "./ids";

export interface PublicError {
  code: string;
  messageKey: string;
  retryable: boolean;
  operationId: OperationId;
  details?: Record<string, string | number | boolean>;
}

export type Result<T, E extends PublicError = PublicError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(
  error: Omit<PublicError, "operationId"> & { operationId?: OperationId },
): Result<never> {
  return {
    ok: false,
    error: {
      ...error,
      operationId: error.operationId ?? ("00000000-0000-7000-8000-000000000000" as OperationId),
    },
  };
}

export function unavailable(code = "IPC_METHOD_UNAVAILABLE"): Result<never> {
  return fail({
    code,
    messageKey: "ipc.method_unavailable",
    retryable: false,
  });
}
