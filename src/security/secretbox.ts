import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const DEFAULT_PURPOSE = "navos:secretbox:v1";

export class SecretBox {
  private readonly key: Buffer;

  constructor(rootSecret: string, purpose: string = DEFAULT_PURPOSE) {
    if (rootSecret.length < 32) {
      throw new Error("root secret must be at least 32 characters");
    }
    this.key = Buffer.from(hkdfSync(
      "sha256",
      Buffer.from(rootSecret),
      Buffer.alloc(0),
      Buffer.from(purpose),
      32
    ));
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, tag, encrypted]).toString("base64");
  }

  decrypt(ciphertext: string): string {
    const payload = Buffer.from(ciphertext, "base64");
    if (payload.length <= 28) {
      throw new Error("ciphertext too short");
    }
    const nonce = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}
