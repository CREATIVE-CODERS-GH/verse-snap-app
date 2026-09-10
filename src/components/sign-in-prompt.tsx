import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function SignInPrompt({ message }: { message: string }) {
  return (
    <div className="border-t border-border pt-8">
      <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{message}</p>
      <Button asChild className="mt-5 h-11 w-full">
        <Link to="/auth">Sign in</Link>
      </Button>
    </div>
  );
}
