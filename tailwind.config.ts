import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: "#0a0028",
          blue: "#2246fa",
          "blue-1": "#001eb2",
          "blue-2": "#000d4d",
          "blue-tint-1": "#94dbff",
          "blue-tint-2": "#d1f0ff",
          "blue-tint-3": "#ebf8ff",
          pink: "#eb33ff",
        },
        ink: { DEFAULT: "#0a0028", muted: "#4f4f70", subtle: "#9393b8" },
        surface: { DEFAULT: "#ffffff", sunken: "#f5f5fa", raised: "#ffffff", border: "#ddddeb" },
        accent: { DEFAULT: "#2246fa", soft: "#ebf8ff", ink: "#001eb2" },
        observed: { DEFAULT: "#008738", soft: "#e8f6ed" },
        external: { DEFAULT: "#faa614", soft: "#fff4dc" },
        inferred: { DEFAULT: "#eb33ff", soft: "#fdeaff" },
        danger: { DEFAULT: "#ad0322", soft: "#fdecef" },
        warn: { DEFAULT: "#faa614", soft: "#fff4dc" },
        success: { DEFAULT: "#008738", soft: "#e8f6ed" },
        information: { DEFAULT: "#006bb2", soft: "#e8f4fc" },
        neutral: {
          1: "#0a0028",
          2: "#141429",
          3: "#1f1f3d",
          4: "#313152",
          5: "#4f4f70",
          6: "#9393b8",
          7: "#adadcc",
          8: "#cacae0",
          9: "#ddddeb",
          10: "#ebebf5",
          11: "#f5f5fa",
        },
      },
      fontFamily: { sans: ["Onest", "ui-sans-serif", "system-ui", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
    },
  },
  plugins: [],
} satisfies Config;
