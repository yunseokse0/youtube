/** @type {import('@storybook/react-webpack5').StorybookConfig} */
const config = {
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: "@storybook/react-webpack5",
  docs: {
    autodocs: "tag",
  },
  webpackFinal: async (cfg) => {
    cfg.module.rules.push({
      test: /\.(ts|tsx)$/,
      use: [
        {
          loader: require.resolve("ts-loader"),
          options: {
            transpileOnly: true,
            compilerOptions: {
              jsx: "react-jsx",
            },
          },
        },
      ],
      exclude: /node_modules/,
    });
    cfg.resolve.extensions = [...(cfg.resolve.extensions || []), ".ts", ".tsx"];
    cfg.resolve.alias = {
      ...(cfg.resolve.alias || {}),
      "@": require("path").resolve(__dirname, "../src"),
    };
    return cfg;
  },
};

export default config;

