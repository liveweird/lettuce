import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeSessionBoundary } from "./session";

/** Clears all server-derived query and mutation state before an identity change is rendered. */
export default function SessionCacheBoundary({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(
    () => subscribeSessionBoundary(() => queryClient.clear()),
    [queryClient],
  );

  return children;
}
