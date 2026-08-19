import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm" className="text-ink-muted hover:text-ink">
        Sign out
      </Button>
    </form>
  );
}
