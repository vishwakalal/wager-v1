/**
 * Visual design tokens (spec §13.1). Dark and sleek, mint-green accent —
 * inspired by Robinhood / Polymarket. Single source of truth for colors so
 * every screen stays consistent.
 */
export const colors = {
  background: "#0F0F0F", // near-black app background
  surface: "#1A1A1A", // dark card surfaces
  accent: "#3DFFC0", // bright mint — primary accent / "Active"
  text: "#FFFFFF",
  textMuted: "#8A8A8A",

  // Status colors (spec §13.1 / §5.3)
  statusActive: "#3DFFC0", // mint
  statusStaking: "#EF9F27", // amber
  statusDispute: "#F09595", // red-tint
  statusResolved: "#85B7EB", // blue-tint
} as const;
