import { useQuery } from "@tanstack/react-query";
import { listAllUsers } from "../api/users";

type UserPoolRow = Awaited<ReturnType<typeof listAllUsers>>[number];

/**
 * The org-wide user pool under ONE query key, shared by every picker (manager picker,
 * member-add picker, feedback-provider picker) — the pools used to run three parallel
 * caches of the same payload under per-picker key suffixes. ALL pages via listAllUsers
 * (the single-page-picker lesson: one name-sorted page of 100 silently hides people in
 * any larger org); consumers sort/map for their own UI.
 */
export function useAllUsers(enabled = true): {
  userPool: UserPoolRow[] | undefined;
  usersLoading: boolean;
  /** True when the pool failed to load — pickers surface it instead of sitting empty. */
  usersError: boolean;
  /** True once the pool actually loaded — CreateFeedback resolves a URL-carried subject id
   *  against it and falls back to the picker only after this settles (v2.35.0). */
  usersReady: boolean;
} {
  const { data: userPool, isLoading: usersLoading, isError: usersError, isSuccess: usersReady } = useQuery({
    queryKey: ["users", "all"],
    queryFn: () => listAllUsers(),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  return { userPool, usersLoading, usersError, usersReady };
}
