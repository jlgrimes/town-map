import React from "react";

export function DotBackground({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative w-full overflow-hidden bg-background ${className}`}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
          backgroundSize: "18px 18px",
          opacity: 0.15,
        }}
      />
      {/* Radial fade mask */}
      <div className="pointer-events-none absolute inset-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_30%,black_90%)]" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
