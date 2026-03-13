import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          card: "var(--bg-card)",
          elevated: "var(--bg-elevated)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
        },
      },
      fontSize: {
        hero: "var(--text-hero)",
        section: "var(--text-section)",
        "card-title": "var(--text-card-title)",
        body: "var(--text-body)",
        small: "var(--text-small)",
      },
      boxShadow: {
        "premium-sm": "var(--shadow-sm)",
        "premium-md": "var(--shadow-md)",
        "premium-lg": "var(--shadow-lg)",
        "premium-xl": "var(--shadow-xl)",
        glow: "var(--shadow-glow)",
      },
      borderColor: {
        subtle: "var(--border-subtle)",
        card: "var(--border-card)",
        "card-hover": "var(--border-hover)",
      },
      animation: {
        "orb-float": "orb-float 20s ease-in-out infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "fade-up": "fade-up 0.8s var(--ease-out-cubic) forwards",
      },
      keyframes: {
        "orb-float": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(30px, -20px) scale(1.05)" },
          "66%": { transform: "translate(-20px, 15px) scale(0.97)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 20px rgba(59,130,246,0.35), 0 0 60px rgba(59,130,246,0.1)",
          },
          "50%": {
            boxShadow:
              "0 0 30px rgba(59,130,246,0.35), 0 0 80px rgba(59,130,246,0.2)",
          },
        },
      },
      transitionTimingFunction: {
        "out-cubic": "cubic-bezier(0.33, 1, 0.68, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
