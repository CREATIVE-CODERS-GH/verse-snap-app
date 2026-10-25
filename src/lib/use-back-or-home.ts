import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

/** Back goes to the previous screen, or to Home when this page was opened directly. */
export function useBackOrHome(): () => void {
  const router = useRouter();
  const navigate = useNavigate();
  return useCallback(() => {
    if (router.history.canGoBack()) router.history.back();
    else navigate({ to: "/", replace: true });
  }, [router, navigate]);
}
