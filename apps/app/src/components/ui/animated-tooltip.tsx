import React, { useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";

export function AnimatedTooltip({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const x = useMotionValue(0);

  const rotate = useSpring(useTransform(x, [-50, 50], [-10, 10]), {
    stiffness: 300,
    damping: 20,
  });

  const translateX = useSpring(useTransform(x, [-50, 50], [-15, 15]), {
    stiffness: 300,
    damping: 20,
  });

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const halfWidth = event.currentTarget.offsetWidth / 2;
    x.set(event.nativeEvent.offsetX - halfWidth);
  }

  return (
    <div
      className="relative group inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseMove={handleMouseMove}
    >
      <AnimatePresence mode="wait">
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.85 }}
            animate={{
              opacity: 1,
              y: -6,
              scale: 1,
              transition: { type: "spring", stiffness: 350, damping: 25 },
            }}
            exit={{ opacity: 0, y: 3, scale: 0.85 }}
            style={{
              translateX,
              rotate,
              whiteSpace: "nowrap",
            }}
            className="absolute -top-9 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center justify-center rounded-lg bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-lg border border-border pointer-events-none"
          >
            <div className="font-semibold text-xs leading-none">{title}</div>
            {subtitle && <div className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </div>
  );
}
