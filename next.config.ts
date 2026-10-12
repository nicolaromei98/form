import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev indicator sat on top of FORM's corner metadata; errors still surface without it
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
