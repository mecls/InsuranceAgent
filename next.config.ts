import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Broker submission uploads (.eml + ACORD PDFs + loss-run xlsx) flow through a
  // Server Action, so keep the body limit generous. The heavy work (extraction,
  // research, pricing) runs in Inngest functions, never in the request handler.
  experimental: {
    serverActions: {
      bodySizeLimit: '32mb',
    },
  },
}

export default nextConfig
