"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const reloadMarker = "ir35careers-sw-reload";
    let registration: ServiceWorkerRegistration | null = null;
    let reloading = false;

    if (window.sessionStorage.getItem(reloadMarker) === "1") {
      window.sessionStorage.removeItem(reloadMarker);
    }

    const handleControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.sessionStorage.setItem(reloadMarker, "1");
      window.location.reload();
    };
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => undefined);
    };
    const register = () => void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((value) => {
        registration = value;
        return value.update();
      })
      .catch(() => undefined);

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    document.addEventListener("visibilitychange", checkForUpdate);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", checkForUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);
  return null;
}
