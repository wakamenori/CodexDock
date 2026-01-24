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
          900: "#0b0f14",
          800: "#121923",
          700: "#1b2636",
          600: "#233147",
          300: "#8ea3c4",
        },
        neon: {
          500: "#4fffc1",
          400: "#7cf3ff",
          300: "#9ddcff",
        },
      },
      boxShadow: {
        glow: "0 0 30px rgba(79, 255, 193, 0.15)",
        panel: "0 12px 50px rgba(7, 12, 20, 0.45)",
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
