import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: "1.5rem",
			screens: { "2xl": "1280px" },
		},
		extend: {
			fontFamily: {
				sans: ['"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
				display: ['"Sora Variable"', '"Inter Variable"', "sans-serif"],
			},
			colors: {
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))",
				},
				destructive: {
					DEFAULT: "hsl(var(--destructive))",
					foreground: "hsl(var(--destructive-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--accent-foreground))",
				},
				popover: {
					DEFAULT: "hsl(var(--popover))",
					foreground: "hsl(var(--popover-foreground))",
				},
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))",
				},
				brand: {
					1: "hsl(var(--brand-1))",
					2: "hsl(var(--brand-2))",
					3: "hsl(var(--brand-3))",
					4: "hsl(var(--brand-4))",
				},
				sidebar: {
					DEFAULT: "hsl(var(--sidebar-background))",
					foreground: "hsl(var(--sidebar-foreground))",
					primary: "hsl(var(--sidebar-primary))",
					"primary-foreground": "hsl(var(--sidebar-primary-foreground))",
					accent: "hsl(var(--sidebar-accent))",
					"accent-foreground": "hsl(var(--sidebar-accent-foreground))",
					border: "hsl(var(--sidebar-border))",
					ring: "hsl(var(--sidebar-ring))",
				},
			},
			borderRadius: {
				xl: "calc(var(--radius) + 4px)",
				lg: "var(--radius)",
				md: "calc(var(--radius) - 4px)",
				sm: "calc(var(--radius) - 8px)",
			},
			boxShadow: {
				glow: "0 10px 40px -10px hsl(var(--brand-1) / 0.45)",
				"glow-lg": "0 20px 70px -15px hsl(var(--brand-1) / 0.55)",
			},
			backgroundImage: {
				"brand-gradient":
					"linear-gradient(100deg, hsl(var(--brand-1)), hsl(var(--brand-3)), hsl(var(--brand-4)))",
			},
			keyframes: {
				"accordion-down": {
					from: { height: "0" },
					to: { height: "var(--radix-accordion-content-height)" },
				},
				"accordion-up": {
					from: { height: "var(--radix-accordion-content-height)" },
					to: { height: "0" },
				},
				marquee: {
					from: { transform: "translateX(0)" },
					to: { transform: "translateX(-50%)" },
				},
				float: {
					"0%, 100%": { transform: "translateY(0)" },
					"50%": { transform: "translateY(-12px)" },
				},
				"float-slow": {
					"0%, 100%": { transform: "translateY(0) translateX(0)" },
					"50%": { transform: "translateY(-24px) translateX(10px)" },
				},
				"gradient-pan": {
					"0%, 100%": { backgroundPosition: "0% 50%" },
					"50%": { backgroundPosition: "100% 50%" },
				},
				"aurora-drift": {
					"0%": { transform: "translate(0, 0) scale(1)" },
					"33%": { transform: "translate(6%, -8%) scale(1.1)" },
					"66%": { transform: "translate(-6%, 6%) scale(0.95)" },
					"100%": { transform: "translate(0, 0) scale(1)" },
				},
				shimmer: {
					from: { backgroundPosition: "200% 0" },
					to: { backgroundPosition: "-200% 0" },
				},
				"spin-slow": {
					from: { transform: "rotate(0deg)" },
					to: { transform: "rotate(360deg)" },
				},
			},
			animation: {
				"accordion-down": "accordion-down 0.2s ease-out",
				"accordion-up": "accordion-up 0.2s ease-out",
				marquee: "marquee var(--marquee-duration, 30s) linear infinite",
				float: "float 6s ease-in-out infinite",
				"float-slow": "float-slow 11s ease-in-out infinite",
				"gradient-pan": "gradient-pan 6s ease infinite",
				"aurora-drift": "aurora-drift 18s ease-in-out infinite",
				shimmer: "shimmer 2.2s linear infinite",
				"spin-slow": "spin-slow 14s linear infinite",
			},
		},
	},
	plugins: [tailwindcssAnimate, typography],
} satisfies Config;
