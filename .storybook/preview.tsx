import type { Preview } from "@storybook/nextjs-vite";
import { useEffect, type ReactNode } from "react";
import "../src/app/globals.css";
import { I18nProvider } from "../src/i18n/provider";

function ThemeWrapper({ theme, children }: { theme: "light" | "dark"; children: ReactNode }) {
  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", theme);
    return () => {
      if (previousTheme === null) {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", previousTheme);
      }
    };
  }, [theme]);

  return <>{children}</>;
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  decorators: [
    (Story, context) => (
      <I18nProvider>
        <ThemeWrapper theme={context.globals.theme === "dark" ? "dark" : "light"}>
          <Story />
        </ThemeWrapper>
      </I18nProvider>
    ),
  ],
};

export default preview;