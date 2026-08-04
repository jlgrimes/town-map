import React from "react";
import { motion } from "framer-motion";

export function MovingBorderCard({
  children,
  className = "",
  containerClassName = "",
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) {
  return (
    <div className={`relative p-[1.5px] overflow-hidden rounded-2xl ${containerClassName}`}>
      <motion.div
        className="absolute inset-[-100%] z-0"
        style={{
          background: `conic-gradient(from 90deg at 50% 50%, oklch(0.74 0.17 68) 0%, transparent 35%, oklch(0.74 0.17 68) 50%, transparent 85%)`,
        }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 7, ease: "linear" }}
      />
      <div className={`relative z-10 rounded-[calc(1rem-1.5px)] bg-card text-card-foreground ${className}`}>
        {children}
      </div>
    </div>
  );
}
