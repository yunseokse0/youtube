/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        glass: {
          light: "rgba(255,255,255,0.08)",
          dark: "rgba(0,0,0,0.35)"
        }
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(31, 38, 135, 0.37)"
      },
      backdropBlur: {
        xs: "2px"
      },
      keyframes: {
        flashGold: {
          "0%": { color: "#e6b400", textShadow: "0 0 8px rgba(230,180,0,0.8)" },
          "100%": { color: "inherit", textShadow: "0 0 0 rgba(0,0,0,0)" }
        }
      },
      animation: {
        flashGold: "flashGold 0.8s ease-out"
      }
    },
  },
  darkMode: "class",
  plugins: [],
};
