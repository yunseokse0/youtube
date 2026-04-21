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
          dark: "rgba(0,0,0,0.35)",
        },
        "pink-light": "#FFF1F2",
        "pink-pastel": "#FCE4EC",
        "pink-accent": "#F8BBD0",
        "pink-deep": "#F06292",
        "white-glass": "rgba(255, 255, 255, 0.7)",
        /** 서비스 공통 파스텔 팔레트 (원색 대신 이 토큰만 사용) */
        "pastel-red": "#FFB7B2",
        "pastel-orange": "#FFDAC1",
        "pastel-yellow": "#E2F0CB",
        "pastel-green": "#B5EAD7",
        "pastel-blue": "#C7CEEA",
        "soft-bg": "#FDFCF0",
        /** 본문·숫자용 짙은 톤 */
        "pastel-ink": "#343A40",
        /** 타이머 10초 미만 등 부드러운 경고색 */
        "pastel-alert": "#a86b6a",
      },
      borderRadius: {
        /** 엑셀형 표·카드 공통 */
        excel: "12px",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        flashGold: {
          "0%": { color: "#e6b400", textShadow: "0 0 8px rgba(230,180,0,0.8)" },
          "100%": { color: "inherit", textShadow: "0 0 0 rgba(0,0,0,0)" },
        },
        pastelTimerLow: {
          "0%, 100%": { opacity: "1", color: "#a86b6a" },
          "50%": { opacity: "0.72", color: "#FFB7B2" },
        },
      },
      animation: {
        flashGold: "flashGold 0.8s ease-out",
        "pastel-timer-low": "pastelTimerLow 1.1s ease-in-out infinite",
      },
    },
  },
  darkMode: "class",
  plugins: [],
};
