import type { StatusState } from "../types";

export function StatusLine({ status }: { status: StatusState }) {
  if (!status.message) {
    return null;
  }
  return <p className={`status ${status.kind}`}>{status.message}</p>;
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="json-block">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
