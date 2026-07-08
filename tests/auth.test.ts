import { describe, expect, it } from "vitest";
import { buildProviderAuthHeaders, isClientAuthorized } from "../src/protocols/auth.js";

describe("client auth", () => {
  it("accepts x-api-key and bearer forms", () => {
    expect(isClientAuthorized({ "x-api-key": "sk-test" }, "sk-test")).toBe(true);
    expect(isClientAuthorized({ authorization: "Bearer sk-test" }, "sk-test")).toBe(true);
  });

  it("rejects missing or wrong credentials", () => {
    expect(isClientAuthorized({}, "sk-test")).toBe(false);
    expect(isClientAuthorized({ authorization: "Bearer wrong" }, "sk-test")).toBe(false);
  });
});

describe("provider auth headers", () => {
  it("builds uid-token authorization without leaking local api key", () => {
    const headers = buildProviderAuthHeaders({ uid: "u1", token: "t1" }, "uid-token");
    expect(headers.authorization).toBe("Bearer u1:t1");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("supports bearer-token mode", () => {
    const headers = buildProviderAuthHeaders({ uid: "u1", token: "t1" }, "bearer-token");
    expect(headers.authorization).toBe("Bearer t1");
  });
});

