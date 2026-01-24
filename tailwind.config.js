/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "ui-sans-serif", "system-ui"],
        mono: [
          "'IBM Plex Mono'",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        ink: {
          950: "#0f111a",
          900: "#16161e",
          800: "#1a1b26",
          700: "#24283b",
          600: "#292e42",
          500: "#3b4261",
          400: "#565f89",
          300: "#a9b1d6",
          200: "#c0caf5",
          100: "#d5dcf8",
        },
        neon: {
          500: "#7aa2f7",
          400: "#7dcfff",
          300: "#bb9af7",
        },
      },
      boxShadow: {
        glow: "0 0 32px rgba(122, 162, 247, 0.22)",
        panel: "0 14px 48px rgba(10, 12, 20, 0.55)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.7" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        rise: "rise 0.35s ease-out",
        pulseSoft: "pulseSoft 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
