import { Input, Select } from "antd";

export function TextField({
  label,
  onChange,
  type = "text",
  value
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  const field = type === "password"
    ? (
      <Input.Password
        aria-label={label}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
    : (
      <Input
        aria-label={label}
        autoComplete="off"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );

  return (
    <label className="text-field ant-field">
      <span>{label}</span>
      {field}
    </label>
  );
}

export function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="text-field ant-field">
      <span>{label}</span>
      <Select
        aria-label={label}
        className="navos-select"
        options={options.map((option) => ({ label: option, value: option }))}
        popupMatchSelectWidth={false}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  onChange,
  value,
  className
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
  className?: string;
}) {
  return (
    <label className={`textarea-field ant-field${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      <Input.TextArea
        aria-label={label}
        autoSize={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
