import type { Span } from "@cloudydeno/opentelemetry/pkg/api";

export type AsyncHandle<T=void> = {
  ok: (value: T) => void;
  fail: (reason: unknown) => void;
  span: Span | null;
  promise: Promise<T>;
};

export function createAsyncHandle<T=void>(span: Span | null): AsyncHandle<T> {
  let handle: Pick<AsyncHandle<T>, 'ok' | 'fail'> | null = null;
  const promise = new Promise<T>((ok, fail) => {
    handle = {ok, fail};
    // }, span ? trace.setSpan(context.active(), span) : context.active()).catch(fail);
  });
  return {
    ...handle!,
    span,
    promise,
  }
}
