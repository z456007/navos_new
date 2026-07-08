import { Card, Statistic } from "antd";

export function Metric({ label, value, tone }: { label: string; value: number; tone?: "ok" | "wait" | "bad" }) {
  const color = tone === "ok" ? "#1a7f55" : tone === "wait" ? "#a15c07" : tone === "bad" ? "#b42318" : "#182230";
  return (
    <Card className={`metric${tone ? ` ${tone}` : ""}`} size="small">
      <Statistic title={label} value={value} styles={{ content: { color, fontSize: 25, lineHeight: 1 } }} />
    </Card>
  );
}
