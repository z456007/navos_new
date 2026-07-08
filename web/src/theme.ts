import { theme, type ThemeConfig } from "antd";

export const navosTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: "#2557d6",
    colorInfo: "#2557d6",
    colorSuccess: "#1a7f55",
    colorWarning: "#a15c07",
    colorError: "#b42318",
    borderRadius: 7,
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },
  components: {
    Card: { borderRadiusLG: 8 },
    Button: { borderRadius: 7 }
  }
};
