/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone output is needed for Vercel but requires symlink support (fails on Windows)
  output: process.env.VERCEL || process.env.CI ? 'standalone' : undefined,
  reactStrictMode: true,
  transpilePackages: ['@zyphon/shared', '@zyphon/db'],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'bcryptjs'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    // Only apply rewrites in development or when API_URL is set
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
    if (!apiUrl) {
      return { beforeFiles: [], afterFiles: [], fallback: [] };
    }
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: '/api/v1/:path*',
          destination: `${apiUrl}/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
