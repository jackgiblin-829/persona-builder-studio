import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm" className="text-white hover:text-white">
        Sign out
      </Button>
    </form>
  );
}
