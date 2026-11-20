import type { Config } from "tailwindcss";
// HORUS Engage — black / charcoal / gold (EchoWave), status colours separate from brand.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: {
      coal: { 950: "#0B0B0C", 900: "#121214", 800: "#1A1B1E", 700: "#232428", 600: "#303238", 500: "#454852" },
      gold: { 100: "#F5E6C4", 300: "#E4C27A", 500: "#B8872F", 700: "#8A6420" },
      ivory: { 50: "#FFFDF8", 100: "#FBF7EF", 200: "#F3ECDD", 300: "#E8DCC4" },
    },
    fontFamily: { sans: ["IBM Plex Sans Arabic", "Segoe UI", "Tahoma", "sans-serif"] },
  } },
  plugins: [],
};
export default config;
