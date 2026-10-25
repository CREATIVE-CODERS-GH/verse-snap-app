import { useEffect } from "react";
import { toast } from "sonner";
import { consumeOAuthReturnError } from "@/lib/oauth-return";

/**
 * Renders nothing. On app load, explains a cancelled or failed Google sign-in
 * (see src/lib/oauth-return.ts). Mounted once in the root component.
 */
export function OAuthReturnNotice() {
  useEffect(() => {
    const failure = consumeOAuthReturnError();
    if (!failure) return;
    // Let the toaster mount first so the message is not dropped.
    const timer = window.setTimeout(() => {
      toast(
        failure.cancelled
          ? "Google sign-in was cancelled"
          : "Google sign-in did not complete. Please try again.",
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
