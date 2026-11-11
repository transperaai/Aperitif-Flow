"use client";

// The sidebar's Issues item opens a tab of the map's side panel when you are already on the map
// (issue #93). The sidebar and the map are far apart in the tree, so the request travels through this context.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type PanelTab = "issues";

/** `nonce` changes on every request, so asking for the same tab twice still registers. */
export interface MapPanelRequest {
  tab: PanelTab;
  nonce: number;
}

interface Value {
  request: MapPanelRequest | null;
  requestPanel: (tab: PanelTab) => void;
}

const Context = createContext<Value>({ request: null, requestPanel: () => {} });

export function MapPanelRequestProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<MapPanelRequest | null>(null);
  const requestPanel = useCallback((tab: PanelTab) => setRequest({ tab, nonce: Date.now() }), []);
  const value = useMemo(() => ({ request, requestPanel }), [request, requestPanel]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useMapPanelRequest = () => useContext(Context);
