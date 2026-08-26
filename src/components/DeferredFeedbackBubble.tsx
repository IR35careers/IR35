"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const FeedbackBubble = dynamic(
  () => import("@/components/FeedbackBubble").then((module) => module.FeedbackBubble),
  { ssr: false },
);

const WORKSPACE_PATHS = [
  "/dashboard",
  "/jobs",
  "/applications",
  "/automation",
  "/alerts",
  "/inbox",
  "/network",
  "/analytics",
  "/profile",
  "/settings",
  "/saved",
] as const;

export function DeferredFeedbackBubble() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const isWorkspaceRoute = WORKSPACE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  useEffect(() => {
    if (!isWorkspaceRoute) {
      setReady(false);
      return;
    }

    const timer = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(timer);
  }, [isWorkspaceRoute]);

  return ready ? <FeedbackBubble /> : null;
}
