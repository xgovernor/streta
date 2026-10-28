import type { LucideIcon } from "lucide-react";
import { RailButton } from "./RailButton";

interface ToolButtonProps {
  label: string;
  icon: LucideIcon;
  side: "left" | "right";
  active?: boolean;
  shortcut?: string;
  onClick: () => void;
}

export function ToolButton({
  label,
  icon: Icon,
  side,
  active,
  shortcut,
  onClick,
}: ToolButtonProps) {
  return (
    <RailButton
      label={label}
      side={side}
      active={active}
      shortcut={shortcut}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
    </RailButton>
  );
}
