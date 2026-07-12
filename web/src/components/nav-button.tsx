import type { ReactNode } from "react";
import { Button as AntButton } from "antd";

export function NavButton({
  active,
  children,
  icon,
  onClick
}: {
  active: boolean;
  children: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <AntButton className={`nav-button${active ? " active" : ""}`} htmlType="button" onClick={onClick} type="text">
      <span aria-hidden="true">{icon}</span>
      {children}
    </AntButton>
  );
}
