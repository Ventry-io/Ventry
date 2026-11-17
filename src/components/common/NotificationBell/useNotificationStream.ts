"use client";

import { useEffect, useRef } from "react";

type Listener = () => void;

// One EventSource per tab, shared by every component that wants live notification updates.
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function notifyAll() {
  for (const listener of listeners) listener();
}

function onVisible() {
  if (document.visibilityState === "visible") notifyAll();
}

function connect() {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/notifications/stream");
  source.addEventListener("notification", notifyAll);
  window.addEventListener("focus", notifyAll);
  document.addEventListener("visibilitychange", onVisible);
}

function disconnect() {
  source?.close();
  source = null;
  window.removeEventListener("focus", notifyAll);
  document.removeEventListener("visibilitychange", onVisible);
}

/** Calls `onChange` when a notification arrives (server push) or the tab regains focus. */
export function useNotificationStream(onChange: Listener) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const listener = () => latest.current();
    listeners.add(listener);
    connect();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) disconnect();
    };
  }, []);
}
