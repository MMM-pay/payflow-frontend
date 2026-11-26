import { globalIgnores } from "eslint/config";
// eslint-config-next 16 ships flat configs directly; the FlatCompat/eslintrc
// bridge used on Next 15 is gone.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
// eslint-config-next enables only six jsx-a11y rules, and does so at `warn`.
// Issue #389 asks for the plugin's accessibility rules to catch regressions
// early, so the recommended set is enabled explicitly below as errors.
import jsxA11y from "eslint-plugin-jsx-a11y";

const config = [
  globalIgnores([".next/**", "out/**", "storybook-static/**", "node_modules/**", "next-env.d.ts"]),
  ...coreWebVitals,
  ...typescript,
  {
    name: "payflow/jsx-a11y",
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      // eslint-plugin-jsx-a11y 6.10 exposes the recommended set as a flat
      // config. Its rules run as errors so an inaccessible pattern fails CI
      // instead of scrolling past as a warning.
      ...jsxA11y.flatConfigs.recommended.rules,
      // The recommended set only permits `tabIndex` on interactive elements
      // (and `tabpanel`). A scroll container has to be focusable so a keyboard
      // user can scroll it (WCAG 2.1.1): the wide tables here are labelled
      // `role="region"` scroll areas, and the virtualised list is a
      // `role="feed"` scroll area. Keeping those two roles allowed is therefore
      // deliberate, not a suppressed rule: every such container is labelled and
      // exists so its overflowing content stays reachable without a mouse.
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { tags: [], roles: ["tabpanel", "region", "feed"], allowExpressionValues: true },
      ],
    },
  },
  {
    rules: {
      // eslint-plugin-react-hooks@7 (pulled in by eslint-config-next@16) turns
      // on React-Compiler-era rules that did not exist in the previous config.
      // Complying with them means restructuring how every page loads data
      // (state set from `useEffect(() => { void load() })`, the post-mount
      // `publicUrl` read that needs `window`, and `Date.now()` in render),
      // which is the work tracked separately in issue #185 ("move page data
      // loading into hooks"). Downgraded to warn so the debt stays visible on
      // every lint run without blocking CI on an unrelated refactor; they can
      // be re-raised to error once #185 lands.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default config;
