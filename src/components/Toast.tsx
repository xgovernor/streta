import { Info } from "lucide-react";
import { useUiStore } from "../state/uiStore";

export function Toast() {
  const toast = useUiStore((state) => state.toast);

  if (!toast) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute bottom-[calc(var(--footer-h)+10px)] left-1/2 z-[60] flex animate-toast items-center gap-[7px] rounded-[7px] border border-line bg-raised px-2.5 py-[7px] text-[10.5px] text-ink-soft shadow-panel backdrop-blur-[20px] backdrop-saturate-[1.2]"
      role="status"
      aria-live="polite"
    >
      <Info size={13} strokeWidth={1.8} aria-hidden="true" />
      {toast}
    </div>
  );
}
