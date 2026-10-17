export type ButtonVariant = "primary" | "secondary" | "quiet" | "accent" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClassName({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "ir35-gradient-primary text-white hover:-translate-y-0.5 active:bg-brand-800 disabled:bg-slate-300 disabled:shadow-none",
    secondary:
      "border border-slate-300 bg-white text-slate-800 shadow-sm hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:shadow-md",
    quiet: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950",
    accent: "border border-emerald-300 bg-emerald-300 text-slate-950 shadow-sm hover:-translate-y-0.5 hover:bg-emerald-200 hover:shadow-md",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "min-h-10 px-3.5 text-sm",
    md: "min-h-11 px-4 text-sm",
    lg: "min-h-12 px-5 text-[15px]",
  };
  return `ir35-focus inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out active:translate-y-px disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 ${variants[variant]} ${sizes[size]} ${className}`;
}
