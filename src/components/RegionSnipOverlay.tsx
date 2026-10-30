import { useEffect, useRef, useState } from "react";
import { Camera, Check, Copy, Download, X } from "lucide-react";
import { useUiStore } from "../state/uiStore";
import {
  copyMapRegionToClipboard,
  downloadMapRegionCapture,
} from "../map/mapController";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function RegionSnipOverlay() {
  const snipMode = useUiStore((state) => state.snipMode);
  const setSnipMode = useUiStore((state) => state.setSnipMode);
  const flash = useUiStore((state) => state.flash);

  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const [lockedRect, setLockedRect] = useState<Rect | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snipMode) {
      setIsSelecting(false);
      setStartPos(null);
      setCurrentRect(null);
      setLockedRect(null);
      setIsCopied(false);
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSnipMode(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snipMode, setSnipMode]);

  if (!snipMode) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (lockedRect) return; // Allow interaction with action buttons
    setIsSelecting(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setCurrentRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !startPos) return;

    const x = Math.min(startPos.x, e.clientX);
    const y = Math.min(startPos.y, e.clientY);
    const width = Math.abs(e.clientX - startPos.x);
    const height = Math.abs(e.clientY - startPos.y);

    setCurrentRect({ x, y, width, height });
  };

  const handleMouseUp = () => {
    if (!isSelecting || !currentRect) return;
    setIsSelecting(false);
    if (currentRect.width >= 20 && currentRect.height >= 20) {
      setLockedRect(currentRect);
    } else {
      setCurrentRect(null);
      setStartPos(null);
    }
  };

  const activeRect = lockedRect || currentRect;

  const handleDownload = () => {
    if (!activeRect) return;
    const ok = downloadMapRegionCapture(activeRect);
    if (ok) {
      flash("Selective region captured and downloaded");
    } else {
      flash("Failed to capture region");
    }
    setSnipMode(false);
  };

  const handleCopy = async () => {
    if (!activeRect) return;
    const ok = await copyMapRegionToClipboard(activeRect);
    if (ok) {
      setIsCopied(true);
      flash("Region image copied to clipboard");
      setTimeout(() => setSnipMode(false), 800);
    } else {
      flash("Clipboard image write not supported in this environment");
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="fixed inset-0 z-50 cursor-crosshair select-none bg-black/40 backdrop-blur-[0.5px]"
    >
      {/* Top Banner Guide */}
      <div className="pointer-events-auto absolute left-1/2 top-4 -translate-x-1/2 flex items-center gap-3 rounded-[3px] border border-cyan-400/40 bg-solid px-3 py-1.5 font-mono text-[11px] font-semibold text-cyan-400 shadow-panel">
        <Camera size={13} className="text-cyan-400 animate-pulse" />
        <span>DRAG TO SNIP REGION · [ESC] TO CANCEL</span>
        <button
          type="button"
          onClick={() => setSnipMode(false)}
          className="ml-2 text-ink-muted hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>

      {/* Selected Marquee Box */}
      {activeRect && activeRect.width > 0 && activeRect.height > 0 && (
        <div
          style={{
            left: activeRect.x,
            top: activeRect.y,
            width: activeRect.width,
            height: activeRect.height,
          }}
          className="pointer-events-none absolute border-2 border-cyan-400 bg-cyan-400/10 shadow-[0_0_15px_rgba(6,182,212,0.3)]"
        >
          {/* Dimension Tag */}
          <div className="absolute -top-6 left-0 flex items-center gap-1 rounded bg-solid px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-400 border border-cyan-400/30">
            {Math.round(activeRect.width)} × {Math.round(activeRect.height)} px
          </div>

          {/* Corner Crosshair Ticks */}
          <div className="absolute -left-1 -top-1 size-2 border-l-2 border-t-2 border-cyan-400" />
          <div className="absolute -right-1 -top-1 size-2 border-r-2 border-t-2 border-cyan-400" />
          <div className="absolute -bottom-1 -left-1 size-2 border-b-2 border-l-2 border-cyan-400" />
          <div className="absolute -bottom-1 -right-1 size-2 border-b-2 border-r-2 border-cyan-400" />
        </div>
      )}

      {/* Action Menu attached to locked selection */}
      {lockedRect && (
        <div
          style={{
            left: Math.min(lockedRect.x, window.innerWidth - 240),
            top: Math.min(lockedRect.y + lockedRect.height + 8, window.innerHeight - 50),
          }}
          className="pointer-events-auto absolute flex items-center gap-1 rounded-[3px] border border-line bg-solid p-1 shadow-panel"
        >
          <button
            type="button"
            onClick={handleDownload}
            className="flex h-7 items-center gap-1.5 rounded-[2px] bg-accent px-2.5 font-mono text-[10px] font-bold text-shell hover:opacity-90"
          >
            <Download size={12} />
            <span>DOWNLOAD</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex h-7 items-center gap-1.5 rounded-[2px] bg-tint px-2.5 font-mono text-[10px] font-semibold text-ink hover:bg-tint/80"
          >
            {isCopied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
            <span>{isCopied ? "COPIED" : "COPY"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setLockedRect(null);
              setCurrentRect(null);
            }}
            className="flex h-7 items-center justify-center rounded-[2px] px-2 text-ink-muted hover:text-ink"
            title="Reset selection"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
