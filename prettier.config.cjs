/** @type {import("prettier").Config} */
module.exports = {
  printWidth: 80,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  tabWidth: 2,
  useTabs: false,
  arrowParens: "always",
  endOfLine: "lf",
  plugins: ["prettier-plugin-organize-imports", "prettier-plugin-packagejson"],
};
