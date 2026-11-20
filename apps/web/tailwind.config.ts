import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0F1B2D", 50: "#EEF1F6", 100: "#D7DEEA", 200: "#AEBBD3", 300: "#7F92B5", 400: "#4F6690", 500: "#2D436B", 600: "#1E3052", 700: "#162540", 800: "#0F1B2D", 900: "#09111D" },
        ivory: { DEFAULT: "#F7F4EE", 100: "#FBFAF7", 200: "#F7F4EE", 300: "#ECE6DA" },
        brass: { DEFAULT: "#B08D57", 50: "#F7F1E7", 100: "#EBDDC4", 400: "#C4A475", 500: "#B08D57", 600: "#8F7044", 700: "#6E5634" },
        ink: "#1B2230",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(15,27,45,.06), 0 4px 16px rgba(15,27,45,.05)" },
    },
  },
  plugins: [],
} satisfies Config;
