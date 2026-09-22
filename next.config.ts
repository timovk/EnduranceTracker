import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop application runs this build as a child process, so it needs a
  // server it can start on its own: `standalone` writes one to
  // `.next/standalone`, together with only the dependencies the traced code
  // actually reaches. `scripts/desktop/prepare-standalone.mjs` completes that
  // tree — Next deliberately leaves `.next/static` and `public/` out of it.
  output: "standalone",
};

export default nextConfig;
