"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { createSeedWorkspaceState } from "@/lib/workspace/seed";
import type { WorkspaceState } from "@/lib/workspace/types";

const STORAGE_KEY = "ir35careers.workspace.v1";
const listeners = new Set<() => void>();
let memoryState: WorkspaceState | null = null;
let cloudUserId: string | null = null;
let cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;
let cloudLoadUserId: string | null = null;
let cloudLoadPromise: Promise<WorkspaceState> | null = null;
let cloudSaveChain: Promise<void> = Promise.resolve();
let cloudSyncError: string | null = null;
let cloudSaving = 0;

const CLOUD_LOAD_TIMEOUT_MS = 20_000;

function loadCloudState(userId: string, email: string): Promise<WorkspaceState> {
  if (cloudLoadPromise && cloudLoadUserId === userId) return cloudLoadPromise;
  cloudLoadUserId = userId;
  const request = import("@/lib/workspace/repository").then(({ loadCloudWorkspace }) => loadCloudWorkspace(userId, email));
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const current = Promise.race([
    request,
    new Promise<WorkspaceState>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Your workspace took too long to load. Check your connection and try again.")), CLOUD_LOAD_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
    if (cloudLoadPromise === current) {
      cloudLoadPromise = null;
      cloudLoadUserId = null;
    }
  });
  cloudLoadPromise = current;
  return current;
}

function readState(): WorkspaceState {
  if (memoryState) return memoryState;
  if (typeof window !== "undefined" && !isSupabaseConfigured()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WorkspaceState;
        if (parsed.version === 1) {
          memoryState = parsed;
          return parsed;
        }
      }
    } catch {
      // Recover with labelled preview data if storage is blocked or corrupt.
    }
  }
  memoryState = createSeedWorkspaceState();
  return memoryState;
}

function persist(state: WorkspaceState, save = true): void {
  memoryState = state;
  if (typeof window !== "undefined") {
    try {
      if (isSupabaseConfigured()) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The in-memory session remains usable when storage is unavailable.
    }
  }
  listeners.forEach((listener) => listener());
  if (cloudUserId && save) {
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
      void enqueueCloudSave().catch(() => undefined);
    }, 350);
  }
}

function enqueueCloudSave(): Promise<void> {
  const userId = cloudUserId;
  const work = cloudSaveChain.then(async () => {
    if (!userId || cloudUserId !== userId) return;
    cloudSaving++;
    try {
      const snapshot = readState();
      const { saveCloudWorkspace } = await import("@/lib/workspace/repository");
      const saved = await saveCloudWorkspace(userId, snapshot);
      if (cloudUserId !== userId) return;
      const current = readState();
      persist({ ...current, applications: current.applications.map(application => {
        const acknowledged = saved.find(item => item.id === application.id);
        if (!acknowledged || (application.deliveryVersion ?? 0) > (acknowledged.deliveryVersion ?? 0)) return application;
        const sent = snapshot.applications.find(item => item.id === application.id);
        return sent === application ? acknowledged : { ...application,
          deliveryVersion: acknowledged.deliveryVersion, deliveryStatus: acknowledged.deliveryStatus };
      }) }, false);
      cloudSyncError = null;
    } finally { cloudSaving--; }
  });
  cloudSaveChain = work.catch(() => {
    cloudSyncError = "Some changes could not be saved. Reload the saved application status before submitting or editing again.";
  }).finally(() => listeners.forEach(listener => listener()));
  return work;
}

export async function flushWorkspaceChanges(): Promise<WorkspaceState> {
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  await enqueueCloudSave();
  return readState();
}

export function updateWorkspace(updater: (current: WorkspaceState) => WorkspaceState): void {
  const current = readState();
  const next = updater(current);
  if (next === current) return;
  persist({ ...next, applications: next.applications.map(application => {
    const stored = current.applications.find(item => item.id === application.id);
    // A component holding an older copy cannot erase a Realtime update.
    return stored && (stored.deliveryVersion ?? 0) > (application.deliveryVersion ?? 0) ? stored : application;
  }) });
}

export async function refreshWorkspaceApplications(): Promise<void> {
  const userId = cloudUserId;
  if (!userId || cloudSaving) return;
  const { loadCloudApplications } = await import("@/lib/workspace/repository");
  const applications = await loadCloudApplications(userId);
  if (cloudUserId !== userId || cloudSaving) return;
  const current = readState();
  persist({ ...current, applications: [
    ...applications.map(remote => {
      const local = current.applications.find(item => item.id === remote.id);
      return local && (local.deliveryVersion ?? 0) >= (remote.deliveryVersion ?? 0) ? local : remote;
    }),
    ...current.applications.filter(item => !item.deliveryVersion && !applications.some(remote => remote.id === item.id)),
  ] }, false);
}

export function resetWorkspace(): void {
  persist(createSeedWorkspaceState());
}

export function clearWorkspaceForSignOut(): void {
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  cloudUserId = null;
  cloudLoadUserId = null;
  cloudLoadPromise = null;
  cloudSyncError = null;
  memoryState = createSeedWorkspaceState();
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot = createSeedWorkspaceState();

export function useWorkspaceState(): WorkspaceState {
  return useSyncExternalStore(subscribe, readState, () => serverSnapshot);
}

export function useWorkspaceCloudSync(userId: string | null, email: string): { loading: boolean; error: string | null; syncError: string | null } {
  const [loading, setLoading] = useState(Boolean(userId && cloudUserId !== userId));
  const [error, setError] = useState<string | null>(null);
  const syncError = useSyncExternalStore(subscribe, () => cloudSyncError, () => null);

  useEffect(() => {
    if (!userId || cloudUserId === userId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void loadCloudState(userId, email)
      .then((state) => {
        if (!active) return;
        cloudUserId = userId;
        persist(state, false);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Cloud workspace could not be loaded.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [email, userId]);

  useEffect(() => {
    if (!userId || loading || error) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dispose = () => {};
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) void refreshWorkspaceApplications().catch(() => {
          cloudSyncError = "Live status is reconnecting. Your saved application has not been reset.";
          listeners.forEach(listener => listener());
        });
      }, 250);
    };
    void import("@/lib/supabase").then(({ getSupabase }) => {
      if (!active) return;
      const client = getSupabase();
      const channel = client.channel(`application-delivery:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "application_packets", filter: `user_id=eq.${userId}` }, refresh)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "application_packets", filter: `user_id=eq.${userId}` }, refresh)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "application_events", filter: `user_id=eq.${userId}` }, refresh)
        .subscribe(status => { if (status === "SUBSCRIBED") refresh(); });
      dispose = () => { void client.removeChannel(channel); };
    });
    // Reconnect/focus fallback covers missed events and sleeping mobile tabs.
    window.addEventListener("focus", refresh);
    const fallback = setInterval(refresh, 30_000);
    return () => { active = false; dispose(); if (timer) clearTimeout(timer); clearInterval(fallback); window.removeEventListener("focus", refresh); };
  }, [userId, loading, error]);

  return { loading, error, syncError };
}
