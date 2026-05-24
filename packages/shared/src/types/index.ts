export type ApiEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
  warnings?: string[];
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
