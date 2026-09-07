/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F172A",
        "ink-soft": "#54607A",
        muted: "#8791A6",
        surface: "#FFFFFF",
        "surface-alt": "#F6F8FA",
        bg: "#EEF1F5",
        border: "#E2E6EC",
        primary: { DEFAULT: "#0B3D5C", dark: "#082A40", tint: "#E9F0F5" },
        accent: { DEFAULT: "#B08D57", dark: "#93733F", tint: "#F6EFE3" },
        sage: "#1F8A57",
        ochre: "#C1810B",
        rust: "#C43C3C",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "Segoe UI", "Arial", "sans-serif"],
      },
      borderRadius: { DEFAULT: "10px", sm: "6px", lg: "16px", xl: "20px" },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.04), 0 8px 24px -8px rgba(15,23,42,.12)",
        "card-hover": "0 4px 8px rgba(15,23,42,.06), 0 16px 40px -12px rgba(15,23,42,.18)",
        modal: "0 24px 64px -12px rgba(15,23,42,.35)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "scale-in": { from: { opacity: 0, transform: "scale(.96)" }, to: { opacity: 1, transform: "scale(1)" } },
        "slide-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "scale-in": "scale-in .18s cubic-bezier(.16,1,.3,1)",
        "slide-up": "slide-up .28s cubic-bezier(.16,1,.3,1)",
        "slide-in-left": "slide-in-left .22s cubic-bezier(.16,1,.3,1)",
      },
    },
  },
  plugins: [],
};
