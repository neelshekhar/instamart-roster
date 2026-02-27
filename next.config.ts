import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    // Enable WebAssembly support for HiGHS WASM
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (!isServer) {
      config.output = {
        ...config.output,
        webassemblyModuleFilename: "static/wasm/[modulehash].wasm",
      };

      // highs.js conditionally requires 'fs' and 'path' in Node.js env only.
      // Tell webpack these don't exist in the browser so it skips them.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    return config;
  },
};

export default nextConfig;
