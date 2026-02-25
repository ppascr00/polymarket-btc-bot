const path = require('path');
const { loadEnvConfig } = require('@next/env');

// Load root .env so dashboard server code can reuse bot credentials/config.
loadEnvConfig(path.resolve(__dirname, '..'));

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
};

module.exports = nextConfig;
