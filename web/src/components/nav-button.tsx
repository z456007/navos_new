import type { ReactNode } from "react";

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
    <button className={`nav-button${active ? " active" : ""}`} onClick={onClick} type="button">
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  );
}
