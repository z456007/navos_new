import { describe, expect, it } from "vitest";
import { SecretBox } from "../src/security/secretbox.js";
import { YydsMailConfigService } from "../src/services/yyds-mail-config-service.js";
import { InMemoryYydsMailConfigStore } from "../src/store/yyds-mail-config-store.js";

describe("YydsMailConfigService", () => {
  it("reports an actionable error when the stored YYDS key was encrypted with another secret", async () => {
    const store = new InMemoryYydsMailConfigStore();
    const oldBox = new SecretBox("old-config-secret-12345678901234567890", "navos:yyds_mail_config:v1");
    await store.saveRaw({
      enabled: true,
      apiKeyEnc: oldBox.encrypt("ac-old-mail-key")
    });

    const service = new YydsMailConfigService(
      store,
      new SecretBox("new-config-secret-12345678901234567890", "navos:yyds_mail_config:v1")
    );

    await expect(service.enabledApiKey()).rejects.toThrow(
      /YYDS Mail API key cannot be decrypted; re-save YYDS Mail config/
    );
  });
});
