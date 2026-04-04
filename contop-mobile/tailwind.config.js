/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./stores/**/*.{js,jsx,ts,tsx}",
    "./hooks/**/*.{js,jsx,ts,tsx}",
    "./services/**/*.{js,jsx,ts,tsx}",
    "./constants/**/*.{js,jsx,ts,tsx}",
    "./types/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBMPlexSans_400Regular'],
        'ibm-light': ['IBMPlexSans_300Light'],
        'ibm-regular': ['IBMPlexSans_400Regular'],
        'ibm-medium': ['IBMPlexSans_500Medium'],
        'ibm-semibold': ['IBMPlexSans_600SemiBold'],
        'ibm-bold': ['IBMPlexSans_700Bold'],
      },
      colors: {
        'space-blue': '#095bb9',
        'space-black': '#000000',
        'glass-dark': '#101113',
        'amber-warn': '#f59e0b',
        'red-critical': '#ef4444',
      },
      spacing: {
        '1u': '8px',
        '2u': '16px',
        '3u': '24px',
        '4u': '32px',
        '5u': '40px',
        '6u': '48px',
      },
      borderRadius: {
        'glass': '16px',
      },
      backdropBlur: {
        'glass': '24px',
      },
    },
  },
  plugins: [],
};
