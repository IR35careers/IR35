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

function persist(state: WorkspaceState): void {
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
  if (cloudUserId) {
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
      void import("@/lib/workspace/repository").then(({ saveCloudWorkspace }) => saveCloudWorkspace(cloudUserId as string, state)).catch(() => undefined);
    }, 350);
  }
}

export function updateWorkspace(updater: (current: WorkspaceState) => WorkspaceState): void {
  persist(updater(readState()));
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

export function useWorkspaceCloudSync(userId: string | null, email: string): { loading: boolean; error: string | null } {
  const [loading, setLoading] = useState(Boolean(userId && cloudUserId !== userId));
  const [error, setError] = useState<string | null>(null);

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
        persist(state);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Cloud workspace could not be loaded.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [email, userId]);

  return { loading, error };
}
