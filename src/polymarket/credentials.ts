import { ClobClient } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import type { BotConfig } from '../types/index.js';

export interface PolymarketApiCreds {
    key: string;
    secret: string;
    passphrase: string;
}

export async function resolvePolymarketApiCreds(
    config: BotConfig
): Promise<PolymarketApiCreds> {
    const existing = {
        key: config.polymarket.apiKey,
        secret: config.polymarket.apiSecret,
        passphrase: config.polymarket.apiPassphrase,
    };

    if (existing.key && existing.secret && existing.passphrase) {
        return existing;
    }

    if (!config.polymarket.privateKey) {
        throw new Error('Cannot derive API credentials without POLYMARKET_PRIVATE_KEY');
    }

    const signer = new Wallet(config.polymarket.privateKey);
    const client = new ClobClient(
        config.polymarket.apiUrl,
        config.polymarket.chainId,
        signer,
        undefined,
        config.polymarket.signatureType,
        config.polymarket.funderAddress || undefined
    );

    const derived = await client.createOrDeriveApiKey();
    return {
        key: derived.key,
        secret: derived.secret,
        passphrase: derived.passphrase,
    };
}
