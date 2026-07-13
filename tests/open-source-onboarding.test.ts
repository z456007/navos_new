import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("open source onboarding defaults", () => {
  it("keeps .env.example runnable after users only change local keys", async () => {
    const envExample = await readFile(".env.example", "utf8");
    const compose = await readFile("docker-compose.yml", "utf8");
    const env = Object.fromEntries(
      envExample
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => [match[1], match[2]])
    );

    expect(env.PROVIDER_BASE_URL).toBe("https://navos-mind-server-backend.tec-do.com");
    expect(env.VIP_HMAC_SECRET).toBe("5c1d6c1dcd777dbe26f1422f03e5b3749ed87432");
    expect(env.VIP_BASE_URL).toBe("https://navos-mind-server-vip.tec-do.com");
    expect(env.MYSQL_PASSWORD).not.toMatch(/change-me|your-/i);
    expect(env.MASTER_API_KEY).toMatch(/change-me/i);
    expect(env.PUBLIC_PROXY_API_KEYS).toMatch(/change-me/i);
    expect(compose).not.toMatch(/external:\s*true/);
  });
});
