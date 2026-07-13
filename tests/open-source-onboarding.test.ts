import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("open source onboarding defaults", () => {
  it("keeps .env.example runnable after users only change local keys", async () => {
    const envExample = await readFile(".env.example", "utf8");
    const compose = await readFile("docker-compose.yml", "utf8");
    const readme = await readFile("README.md", "utf8");
    const webDockerfile = await readFile("Dockerfile.web", "utf8").catch(() => "");
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
    expect(compose).not.toMatch(/docker network create/i);
    expect(compose).toMatch(/navos-web:/);
    expect(compose).toMatch(/15173\}:80|15173:80/);
    expect(webDockerfile).toContain("dist-admin");
    expect(readme.split(/\r?\n/)[0]).toBe("推荐站点：https://linux.do/");
    expect(readme).toMatch(/只需要改\s*`MASTER_API_KEY`\s*和\s*`PUBLIC_PROXY_API_KEYS`/);
    expect(readme).toMatch(/YYDS Mail Key.*Web 控制台/s);
    expect(readme).not.toMatch(/MYSQL_PASSWORD=your-|VIP_HMAC_SECRET=.*your-|PROVIDER_BASE_URL=.*your-/i);
    expect(readme).not.toMatch(/docker network create/i);
  });
});
