import { Readable } from "node:stream";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ProviderResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export class ProviderHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    init: Omit<RequestInit, "method"> = {}
  ): Promise<ProviderResult<T>> {
    const response = await this.fetchImpl(this.resolve(path), {
      ...init,
      method
    });
    return this.toResult<T>(response);
  }

  async requestJson<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<ProviderResult<T>> {
    const requestHeaders: Record<string, string> = { ...headers };
    const init: RequestInit = { headers: requestHeaders };

    if (body !== undefined) {
      requestHeaders["content-type"] = requestHeaders["content-type"] ?? "application/json";
      init.body = stringifyJsonAsciiSafe(body);
    }

    return this.request<T>(method, path, init);
  }

  private resolve(path: string): string {
    if (!path.startsWith("/")) {
      throw new Error(`Provider path must start with "/": ${path}`);
    }
    return `${this.baseUrl}${path}`;
  }

  private async toResult<T>(response: Response): Promise<ProviderResult<T>> {
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown;

    if (contentType.includes("text/event-stream") && response.body) {
      body = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    } else if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    return {
      status: response.status,
      body: body as T,
      headers: response.headers
    };
  }
}

function stringifyJsonAsciiSafe(value: unknown): string {
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
