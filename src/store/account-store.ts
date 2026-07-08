import type { AccountIdentity } from "../protocols/auth.js";

export class InMemoryAccountStore {
  private defaultAccount?: AccountIdentity;

  constructor(defaultAccount?: AccountIdentity) {
    this.defaultAccount = defaultAccount;
  }

  getDefault(): AccountIdentity | undefined {
    return this.defaultAccount;
  }

  setDefault(account: AccountIdentity): void {
    this.defaultAccount = account;
  }
}

