// Tailwind config for the UCA port. Mirrors the original app's config, except that
// every colour resolves to a CSS custom property filled from componentProps.theme
// (zero-fallback: no colour literal is compiled into the stylesheet).
const defaultColors = require("tailwindcss/colors");
const plugin = require("tailwindcss/plugin");

const SKIP = new Set([
  "inherit", "current", "transparent", "lightBlue", "warmGray", "trueGray",
  "coolGray", "blueGray",
]);

function varColor(name) {
  return `rgb(var(--color-${name}) / <alpha-value>)`;
}

const palette = {
  inherit: "inherit",
  current: "currentColor",
  transparent: "transparent",
};
for (const name of Object.keys(defaultColors)) {
  if (SKIP.has(name)) continue;
  const value = defaultColors[name];
  if (typeof value === "string") {
    palette[name] = varColor(name);
  } else {
    palette[name] = Object.fromEntries(
      Object.keys(value).map((shade) => [shade, varColor(`${name}-${shade}`)]),
    );
  }
}

const semantic = (name) => `hsl(var(--${name}) / <alpha-value>)`;

// App accents the original wrote as arbitrary hex values (bg-[#FFE390] …).
const accents = {
  "notes-highlight": varColor("notes-highlight"),
  "notes-highlight-dark": varColor("notes-highlight-dark"),
  "notes-search-dark": varColor("notes-search-dark"),
  "notes-link": varColor("notes-link"),
  "calendar-red": varColor("calendar-red"),
  "calendar-ink": varColor("calendar-ink"),
  "accent-blue": varColor("accent-blue"),
};

module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,html}"],
  corePlugins: {
    // Opacity plugins compile var(--tw-*-opacity, 1) fallbacks; colours carry alpha instead.
    textOpacity: false,
    backgroundOpacity: false,
    borderOpacity: false,
    divideOpacity: false,
    placeholderOpacity: false,
    ringOpacity: false,
  },
  theme: {
    colors: {
      ...palette,
      ...accents,
      border: semantic("border"),
      input: semantic("input"),
      ring: semantic("ring"),
      background: semantic("background"),
      foreground: semantic("foreground"),
      primary: { DEFAULT: semantic("primary"), foreground: semantic("primary-foreground") },
      secondary: { DEFAULT: semantic("secondary"), foreground: semantic("secondary-foreground") },
      destructive: { DEFAULT: semantic("destructive"), foreground: semantic("destructive-foreground") },
      muted: { DEFAULT: semantic("muted"), foreground: semantic("muted-foreground") },
      accent: { DEFAULT: semantic("accent"), foreground: semantic("accent-foreground") },
      popover: { DEFAULT: semantic("popover"), foreground: semantic("popover-foreground") },
      card: { DEFAULT: semantic("card"), foreground: semantic("card-foreground") },
    },
    fontFamily: {
      sans: ["var(--font-sans)"],
      mono: ["var(--font-mono)"],
    },
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    plugin(({ addVariant }) => {
      addVariant("can-hover", "@media (any-hover: hover) and (any-pointer: fine)");
      addVariant("desktop", "[data-shell='desktop'] &");
    }),
  ],
};
