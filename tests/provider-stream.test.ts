import { Readable, Transform } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { pipeProviderStream } from "../src/protocols/provider-stream.js";

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      text += chunk;
    });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

describe("pipeProviderStream", () => {
  it("ends the downstream stream instead of throwing an unhandled error when the provider body errors", async () => {
    const onError = vi.fn();
    let pushed = false;
    const source = new Readable({
      read() {
        if (pushed) {
          return;
        }
        pushed = true;
        this.push("data: first\n\n");
        this.destroy(new Error("UND_ERR_BODY_TIMEOUT"));
      }
    });
    const passThrough = new Transform({
      transform(chunk, _encoding, callback) {
        this.push(chunk);
        callback();
      }
    });

    const output = pipeProviderStream(source, passThrough, { onError });
    const text = await collect(output);

    expect(text).toBe("data: first\n\n");
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]?.[0])).toContain("UND_ERR_BODY_TIMEOUT");
  });
});
