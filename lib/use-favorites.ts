"use client";

import { useMemo, useSyncExternalStore } from "react";
import { FAVORITES_KEY, parseFavoriteIds, toggleFavoriteId } from "./favorites";

const listeners = new Set<() => void>();
let memory = "[]";
let memoryOnly = false;
const notify = () => { for (const fn of listeners) fn(); };
const onStorage = (event: StorageEvent) => { if (event.key === FAVORITES_KEY || event.key == null) notify(); };
function subscribe(fn: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(fn);
  return () => { listeners.delete(fn); if (!listeners.size) window.removeEventListener("storage", onStorage); };
}
function snapshot() {
  if (!memoryOnly) {
    try { return `stored:${window.localStorage.getItem(FAVORITES_KEY) ?? "[]"}`; }
    catch { /* хранилище запрещено настройками браузера */ }
  }
  return `memory:${memory}`;
}
const serverSnapshot = () => "stored:[]";

export function useFavorites() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const ids = useMemo(() => parseFavoriteIds(state.slice(7)), [state]);
  return { ids, persistent: state.startsWith("stored:") };
}

export function toggleFavorite(id: string) {
  const ids = parseFavoriteIds(snapshot().slice(7));
  const next = toggleFavoriteId(ids, id);
  memory = JSON.stringify(next);
  try { window.localStorage.setItem(FAVORITES_KEY, memory); memoryOnly = false; }
  catch { memoryOnly = true; }
  notify();
}
