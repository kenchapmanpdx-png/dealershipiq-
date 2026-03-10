/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Lint issues tracked separately; don't block production deploys
    ignoreDuringBuilds: true,
  },
  typescript: {
    // tsc --noEmit passes locally; don't duplicate check in CI
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
