import { type FormEvent, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { StatusLine } from "../components/feedback";
import type { StatusState } from "../types";

export function AuthGate({
  initialKey,
  status,
  onVerify
}: {
  initialKey: string;
  status: StatusState;
  onVerify: (apiKey: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialKey);

  useEffect(() => {
    setValue(initialKey);
  }, [initialKey]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void onVerify(value);
  }

  return (
    <main className="gate">
      <section className="gate-panel" aria-labelledby="gate-title">
        <div className="brand-lock">
          <span className="brand-mark"><ShieldCheck size={21} aria-hidden="true" /></span>
          <span>Navos</span>
        </div>
        <h1 id="gate-title">进入 Navos 控制台</h1>
        <form className="gate-form" onSubmit={submit}>
          <label>
            <span>Master API Key</span>
            <input
              autoComplete="off"
              autoFocus
              onChange={(event) => setValue(event.target.value)}
              type="password"
              value={value}
            />
          </label>
          <button className="button primary" disabled={status.kind === "loading"} type="submit">
            <KeyRound size={16} aria-hidden="true" />
            进入控制台
          </button>
          <StatusLine status={status} />
        </form>
      </section>
    </main>
  );
}
