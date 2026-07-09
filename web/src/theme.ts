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
    controlHeight: 38,
    controlOutline: "rgba(47, 111, 235, 0.14)",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },
  components: {
    Card: { borderRadiusLG: 8 },
    Button: {
      borderRadius: 7,
      fontWeight: 600,
      primaryShadow: "0 8px 18px rgba(37, 87, 214, 0.18)"
    },
    Input: {
      activeBorderColor: "#2557d6",
      hoverBorderColor: "#b9c4d1"
    },
    InputNumber: {
      activeBorderColor: "#2557d6",
      hoverBorderColor: "#b9c4d1"
    },
    Select: {
      optionSelectedBg: "#edf4ff",
      optionSelectedColor: "#1d4ed8",
      activeBorderColor: "#2557d6",
      hoverBorderColor: "#b9c4d1"
    },
    Table: {
      headerBg: "#fbfcfe",
      headerColor: "#697586",
      borderColor: "#d7dee8"
    }
  }
};
