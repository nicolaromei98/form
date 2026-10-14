import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev indicator sat on top of FORM's corner metadata; errors still surface without it
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  // The app lives at /demo (plan §1.1). Until Phase 2 puts the public intro on "/", visitors are sent
  // there with a temporary redirect: permanent: false answers 307, which browsers don't cache, and
  // redirects run before the filesystem. Query strings are passed through (/?view=board → /demo?view=board).
  async redirects() {
    return [{ source: "/", destination: "/demo", permanent: false }];
  },
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
