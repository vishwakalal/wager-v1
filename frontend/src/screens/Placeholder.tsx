import { EmptyState, Screen } from "../ui";

/** Temporary stub for a not-yet-built screen. Replaced screen-by-screen. */
export function Placeholder({ name }: { name: string }) {
  return (
    <Screen>
      <EmptyState title={name} hint="Coming soon — this screen is next on the build list." />
    </Screen>
  );
}
