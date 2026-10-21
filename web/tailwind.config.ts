import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    '../shared/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ice: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0284c7',
          600: '#0369a1',
          700: '#075985',
          800: '#0c4a6e',
          900: '#082f49',
          950: '#031926',
        },
        rink: {
          dark: 'rgb(var(--rink-dark) / <alpha-value>)',
          card: 'rgb(var(--rink-card) / <alpha-value>)',
          border: 'rgb(var(--rink-border) / <alpha-value>)',
          accent: '#48CAE4',
          highlight: '#00B4D8',
          gold: '#FFD166',
          danger: '#EF476F',
          success: '#06D6A0',
        },
      },
    },
  },
  plugins: [],
};

export default config;
