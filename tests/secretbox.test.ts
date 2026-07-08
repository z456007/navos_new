import { describe, expect, it } from "vitest";
import { SecretBox } from "../src/security/secretbox.js";

describe("SecretBox", () => {
  it("encrypts secrets with authenticated random ciphertext", () => {
    const box = new SecretBox("12345678901234567890123456789012", "navos:test");

    const first = box.encrypt("secret-key");
    const second = box.encrypt("secret-key");

    expect(first).not.toBe("secret-key");
    expect(second).not.toBe("secret-key");
    expect(first).not.toBe(second);
    expect(box.decrypt(first)).toBe("secret-key");
    expect(box.decrypt(second)).toBe("secret-key");
  });

  it("requires a strong root secret", () => {
    expect(() => new SecretBox("short")).toThrow(/at least 32 characters/);
  });
});
