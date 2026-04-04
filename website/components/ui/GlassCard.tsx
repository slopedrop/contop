interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassCard({ children, className = "" }: GlassCardProps) {
  return (
    <div
      className={`rounded-lg border border-white/[0.06] bg-glass-bg backdrop-blur-[16px] ${className}`}
      style={{ WebkitBackdropFilter: "blur(16px)" }}
    >
      {children}
    </div>
  );
}
