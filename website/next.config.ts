import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  basePath: process.env.NEXT_PUBLIC_SITE_BASE_PATH || '',
  trailingSlash: true,
  turbopack: { root: process.cwd() },
  devIndicators: false
};

export default config;
