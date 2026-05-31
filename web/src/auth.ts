import { useSyncExternalStore } from "react";
import { getToken } from "./api/client";

const TOKEN_KEY = "lettuce.auth.token";
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  listeners.add(cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    listeners.delete(cb);
  };
}

export function notifyAuthChange(): void {
  listeners.forEach((cb) => cb());
}

export function useAuth(): { token: string | null; isAuthenticated: boolean } {
  const token = useSyncExternalStore(subscribe, getToken, () => null);
  return { token, isAuthenticated: token !== null };
}
