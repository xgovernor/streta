import { useEffect, useState } from "react";
import { motion, AnimatePresence, useSpring } from "motion/react";
import { useMapStore } from "../state/mapStore";
import { useUiStore } from "../state/uiStore";

/**
 * High-fidelity macOS boot splash screen powered by Motion spring physics.
 * Replaces Frame 0 static DOM seamlessly upon React mount, animates the
 * progress bar via natural spring momentum, and dissolves with an Apple-style
 * defocus exit when the map canvas reports ready.
 */
export function BootSplashScreen() {
  const ready = useMapStore((state) => state.ready);
  const [visible, setVisible] = useState(true);

  // Natural spring physics: momentum-driven, critically damped
  const progress = useSpring(0.12, {
    stiffness: 70,
    damping: 18,
    mass: 0.6,
  });

  useEffect(() => {
    // Seamless handover: remove Frame 0 static splash once React component mounts
    const staticSplash = document.getElementById("boot-splash");
    if (staticSplash) {
      staticSplash.remove();
    }

    // Stage 1: Advance spring smoothly to ~60% during store & font hydration
    const t1 = setTimeout(() => {
      progress.set(0.6);
    }, 70);

    // Stage 2: Advance spring to ~85% while map shaders & workers initialize
    const t2 = setTimeout(() => {
      progress.set(0.85);
    }, 260);

    // Safety fallback: dismiss after 2.5s even if map postrender is delayed
    const tFallback = setTimeout(() => {
      setVisible(false);
      useUiStore.getState().setBooted(true);
    }, 2500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(tFallback);
    };
  }, [progress]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    // Surge smoothly into 100%
    progress.set(1.0);

    // Hold at 100% for an authentic macOS beat (160ms), then trigger AnimatePresence exit
    // and launch layout chrome entrance animation simultaneously
    const tDone = setTimeout(() => {
      setVisible(false);
      useUiStore.getState().setBooted(true);
    }, 160);

    return () => clearTimeout(tDone);
  }, [ready, progress]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="boot-splash-container"
          initial={{ opacity: 1 }}
          exit={{
            opacity: 0,
            scale: 1.018,
            filter: "blur(3px)",
            transition: {
              duration: 0.45,
              ease: [0.16, 1, 0.3, 1],
            },
          }}
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-black select-none cursor-default"
          aria-hidden="true"
        >
          {/* Centered Optical Logo */}
          <motion.div
            initial={{ opacity: 0.96, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex items-center justify-center -translate-y-6"
          >
            <svg
              width="68"
              height="68"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              shapeRendering="geometricPrecision"
            >
              <circle cx="24" cy="24" r="13" stroke="#ffffff" strokeWidth="2.2" />
              <path
                d="M24 4.5v39M4.5 24h39"
                stroke="#ffffff"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <circle cx="24" cy="24" r="3.2" fill="#ffffff" />
            </svg>
          </motion.div>

          {/* macOS-Style Boot Progress Bar with real spring physics */}
          <div className="absolute bottom-[14%] w-[154px] h-1 rounded-full bg-white/20 overflow-hidden">
            <motion.div
              className="h-full w-full rounded-full bg-white origin-left"
              style={{ scaleX: progress }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
