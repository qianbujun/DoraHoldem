/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tableGreen: '#0f3823',
        tableFelt: '#165b38',
        cardBg: '#fefefe',
        doraGold: '#eab308',
      },
    },
  },
  plugins: [],
}

