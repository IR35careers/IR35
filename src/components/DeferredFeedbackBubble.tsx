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

    let timer: number | undefined;
    let idleCallback: number | undefined;
    const showFeedback = () => setReady(true);

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      idleCallback = idleWindow.requestIdleCallback(showFeedback, { timeout: 3_000 });
    } else {
      timer = window.setTimeout(showFeedback, 2_000);
    }

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (idleCallback !== undefined && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleCallback);
      }
    };
  }, [isWorkspaceRoute]);

  return ready ? <FeedbackBubble /> : null;
}
