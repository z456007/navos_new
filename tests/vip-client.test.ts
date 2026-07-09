import { describe, expect, it, vi } from "vitest";
import { VipClient } from "../src/protocols/vip-client.js";

describe("VipClient", () => {
  it("queries both available and total balance", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        currency_id: 1,
        uid: "uid-1",
        common: {
          token: "token-1",
          uid: "uid-1",
          open_id: "uid-1"
        }
      });
      return Response.json({
        resp_common: { ret: 0 },
        data: {
          available_balance: 1500,
          total_balance: 2000
        }
      });
    });

    const client = new VipClient({
      baseUrl: "https://vip.test",
      hmacSecret: "test-secret",
      fetchImpl
    });

    await expect(client.queryBalance("uid-1", "token-1")).resolves.toEqual({
      availableBalance: 1500,
      totalBalance: 2000
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
