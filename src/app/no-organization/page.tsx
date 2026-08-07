import { SignOutButton } from "@/components/forms/sign-out-button";

export default function NoOrganizationPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">No organization</h1>
      <p className="text-sm text-ink-muted">
        Your account is not a member of any organization yet. An organization owner needs to invite
        you before you can open a brand.
      </p>
      <SignOutButton />
    </main>
  );
}
