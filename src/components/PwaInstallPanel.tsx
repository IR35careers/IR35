"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, LoaderCircle, Smartphone, Wifi, WifiOff } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type InstallState = "checking" | "available" | "installed" | "manual" | "dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

export function PwaInstallPanel() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<InstallState>("checking");
  const [online, setOnline] = useState(true);
  const [workerReady, setWorkerReady] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    setInstallState(isStandalone() ? "installed" : "manual");

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setInstallState("available");
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setInstallState("installed");
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    let active = true;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready.then(() => {
        if (active) setWorkerReady(true);
      }).catch(() => undefined);
    }

    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    setInstallState(choice.outcome === "accepted" ? "installed" : "dismissed");
  }

  const copy = installState === "installed"
    ? { title: "Installed on this device", body: "Open IR35Careers from your app list or home screen.", icon: CheckCircle2 }
    : installState === "available"
      ? { title: "Ready to install", body: "Install the standalone workspace without an app-store download.", icon: Download }
      : installState === "dismissed"
        ? { title: "Installation cancelled", body: "Nothing changed. You can install later from your browser menu.", icon: Smartphone }
        : installState === "checking"
          ? { title: "Checking this browser", body: "Looking for a supported installation option.", icon: LoaderCircle }
          : { title: "Install from your browser", body: "Use Add to Home Screen or Install app in the browser menu.", icon: Smartphone };
  const Icon = copy.icon;

  return (
    <section aria-labelledby="install-panel-title" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Icon className={installState === "checking" ? "animate-spin" : ""} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">This device</p>
            <h2 id="install-panel-title" className="mt-1 text-xl font-bold text-slate-950">{copy.title}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{copy.body}</p>
          </div>
        </div>
        {installState === "available" && (
          <button type="button" onClick={() => void install()} className={buttonClassName({ size: "lg", className: "shrink-0" })}>
            <Download size={17} aria-hidden="true" /> Install IR35Careers
          </button>
        )}
      </div>

      <div role="status" aria-label="Mobile app readiness" aria-live="polite" className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className={`flex items-center gap-3 rounded-2xl p-4 ${online ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}>
          {online ? <Wifi size={18} aria-hidden="true" /> : <WifiOff size={18} aria-hidden="true" />}
          <div><p className="text-sm font-bold">{online ? "Online" : "Offline"}</p><p className="mt-0.5 text-xs opacity-75">{online ? "Live contract data is reachable." : "Reconnect before relying on job freshness."}</p></div>
        </div>
        <div className={`flex items-center gap-3 rounded-2xl p-4 ${workerReady ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>
          {workerReady ? <CheckCircle2 size={18} aria-hidden="true" /> : <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}
          <div><p className="text-sm font-bold">{workerReady ? "Offline recovery ready" : "Preparing offline recovery"}</p><p className="mt-0.5 text-xs opacity-75">The recovery screen is cached; live jobs still require a connection.</p></div>
        </div>
      </div>
    </section>
  );
}
