import type { Transform } from "node:stream";

export interface PipeProviderStreamOptions {
  onError?: (error: unknown) => void;
}

export function pipeProviderStream(
  source: NodeJS.ReadableStream,
  transform: Transform,
  options: PipeProviderStreamOptions = {}
): NodeJS.ReadableStream {
  const finishSafely = (error: unknown): void => {
    options.onError?.(error);
    source.unpipe(transform);
    if (!transform.destroyed && !transform.writableEnded) {
      transform.end();
    }
  };

  const observeTransformError = (error: unknown): void => {
    options.onError?.(error);
  };

  source.once("error", finishSafely);
  transform.once("error", observeTransformError);
  transform.once("close", () => {
    source.off("error", finishSafely);
    transform.off("error", observeTransformError);
  });

  return source.pipe(transform);
}
