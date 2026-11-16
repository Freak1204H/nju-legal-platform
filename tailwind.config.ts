import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 司法/法律主题色 —— 深蓝 + 金，传达专业、权威感
        primary: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8eb7ff',
          400: '#598fff',
          500: '#3366ff',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#1e3a8a',
          900: '#1e2a5e',
        },
        accent: {
          DEFAULT: '#c9a227',
          light: '#e6c76a',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
