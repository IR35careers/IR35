import type { ReactNode } from "react";

export function AppMotion({ children }: { children: ReactNode }) {
  return <div className="ir35-route-frame">{children}</div>;
}
