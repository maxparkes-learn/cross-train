import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Clutch design tokens, per the v3 matrix design handoff. Named rather than
      // inlined as hex so the two halves of the reskin cannot drift apart unnoticed.
      colors: {
        plum: '#550E30', // header bar, apprentice pill text
        wine: '#800040', // lead-hand labels, role text, "Add station"
        brand: {
          DEFAULT: '#FF464C', // active nav, primary buttons, avatar, focus
          hover: '#ED3239',
        },
        lilac: '#E6D6F9',
        ink: {
          DEFAULT: '#272727', // body text — never pure black
          muted: '#606060',
          faint: '#ABABAB',
        },
        line: {
          DEFAULT: '#DDDDDD', // inputs, header rules
          soft: '#EEEEEE', // dividers, card borders
        },
        canvas: '#FAFAFA', // page background, hover fill
        lead: '#FFFBEB', // lead-hand row tint
      },
      fontFamily: {
        // Circular is licensed and cannot be embedded; Poppins is the official
        // Clutch backup for generated files.
        sans: ['var(--font-poppins)', ...defaultTheme.fontFamily.sans],
      },
      fontSize: {
        // The handoff specs these half-pixel sizes; keep them as tokens so call
        // sites don't sprout arbitrary values.
        '2xs': ['10.5px', { lineHeight: '1.3' }],
        'xs-plus': ['11.5px', { lineHeight: '1.3' }],
        menu: ['13px', { lineHeight: '1.4' }],
      },
      boxShadow: {
        menu: '0 8px 24px rgba(39,39,39,0.14)',
        card: '0 2px 8px rgba(39,39,39,0.06)',
        focus: '0 0 0 3px rgba(255,70,76,0.30)',
      },
      screens: {
        // Where the header's nav links collapse into a hamburger. Distinct from
        // Tailwind's lg (1024px), which the old sidebar used.
        nav: '1100px',
      },
    },
  },
  plugins: [],
}

export default config
