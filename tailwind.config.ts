import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0f1720", muted: "#5b6673", subtle: "#8b95a1" },
        surface: { DEFAULT: "#ffffff", sunken: "#f6f7f9", raised: "#ffffff", border: "#e3e6ea" },
        accent: { DEFAULT: "#1f5eff", soft: "#eaf0ff", ink: "#123ba8" },
        observed: { DEFAULT: "#0d7a5f", soft: "#e6f5f0" },
        external: { DEFAULT: "#8a5a00", soft: "#fdf3e0" },
        inferred: { DEFAULT: "#6b46c1", soft: "#f1ebfc" },
        danger: { DEFAULT: "#b3261e", soft: "#fdecea" },
        warn: { DEFAULT: "#8a5a00", soft: "#fdf3e0" },
      },
      fontFamily: { sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
    },
  },
  plugins: [],
} satisfies Config;
