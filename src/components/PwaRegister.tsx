"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => undefined);
    };
    const register = () => void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((value) => {
        registration = value;
        return value.update();
      })
      .catch(() => undefined);

    document.addEventListener("visibilitychange", checkForUpdate);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);
  return null;
}
