import React from "react";
import { motion } from "framer-motion";

export interface TabOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

interface AnimatedTabsProps<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  layoutId?: string;
  className?: string;
  buttonClassName?: string;
}

export function AnimatedTabs<T extends string>({
  options,
  value,
  onChange,
  layoutId = "animated-tab-pill",
  className = "",
  buttonClassName = "",
}: AnimatedTabsProps<T>) {
  return (
    <div className={`relative inline-flex items-center rounded-xl bg-muted/60 p-1 border border-border/50 ${className}`}>
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition-colors duration-200 focus-visible:outline-hidden ${
              isActive ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            } ${buttonClassName}`}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="absolute inset-0 z-[-1] rounded-lg bg-background shadow-xs ring-1 ring-border"
              />
            )}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
