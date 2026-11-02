/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: '#22d3ee',
          magenta: '#f472b6',
        },
      },
    },
  },
  plugins: [],
}
