import fs from 'fs';
import path from 'path';

export interface LiveBalanceResult {
    balance: number | null;
    source: 'paper-simulated' | 'live-polymarket' | 'live-unavailable';
    error?: string;
}

let attemptedRootEnvLoad = false;

async function ensureRootEnvLoadedIfNeeded() {
    if (attemptedRootEnvLoad) return;
    attemptedRootEnvLoad = true;

    const candidates = [
        path.resolve(process.cwd(), '..'),
        path.resolve(process.cwd()),
    ];

    const rootDir = candidates.find((dir) => fs.existsSync(path.join(dir, '.env')));
    if (!rootDir) return;

    const { loadEnvConfig } = await import('@next/env');
    loadEnvConfig(rootDir);
}

export async function getPolymarketLiveBalance(): Promise<LiveBalanceResult> {
    await ensureRootEnvLoadedIfNeeded();

    const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
    let apiKey = process.env.POLYMARKET_API_KEY;
    let apiSecret = process.env.POLYMARKET_API_SECRET;
    let apiPassphrase = process.env.POLYMARKET_API_PASSPHRASE;

    if (!privateKey) {
        return {
            balance: null,
            source: 'live-unavailable',
            error: 'Missing POLYMARKET_PRIVATE_KEY',
        };
    }

    try {
        const clobMod: any = await import('@polymarket/clob-client');
        const ethersMod: any = await import('ethers');
        const ClobClient = clobMod.ClobClient;
        const Wallet = ethersMod.Wallet;

        const host = process.env.POLYMARKET_API_URL || 'https://clob.polymarket.com';
        const chainId = Number(process.env.POLYMARKET_CHAIN_ID || 137);
        const signatureType = Number(process.env.POLYMARKET_SIGNATURE_TYPE || 0);
        const funder = process.env.POLYMARKET_FUNDER_ADDRESS || undefined;

        const signer = new Wallet(privateKey);
        if (!apiKey || !apiSecret || !apiPassphrase) {
            const l1Client = new ClobClient(
                host,
                chainId,
                signer,
                undefined,
                signatureType,
                funder
            );
            const derived = await l1Client.createOrDeriveApiKey();
            apiKey = derived.key;
            apiSecret = derived.secret;
            apiPassphrase = derived.passphrase;
        }

        const creds = {
            key: apiKey!,
            secret: apiSecret!,
            passphrase: apiPassphrase!,
        };

        const client = new ClobClient(
            host,
            chainId,
            signer,
            creds,
            signatureType,
            funder
        );

        const balanceResp = await client.getBalanceAllowance({
            asset_type: 'COLLATERAL',
        });

        const balance = Number(balanceResp?.balance);
        if (!Number.isFinite(balance)) {
            return {
                balance: null,
                source: 'live-unavailable',
                error: 'Invalid balance response',
            };
        }

        return {
            balance,
            source: 'live-polymarket',
        };
    } catch (err) {
        return {
            balance: null,
            source: 'live-unavailable',
            error: String(err),
        };
    }
}
