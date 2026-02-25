import { NextResponse } from 'next/server';
import {
    getBotProcessStatus,
    startBotProcess,
    stopBotProcess,
} from '@/lib/bot-process';

export async function GET() {
    const status = getBotProcessStatus();
    return NextResponse.json(status);
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as { action?: 'start' | 'stop' };
        if (body.action === 'start') {
            const result = startBotProcess();
            return NextResponse.json(result, { status: result.started ? 200 : 409 });
        }

        if (body.action === 'stop') {
            const result = await stopBotProcess();
            return NextResponse.json(result, { status: result.stopped ? 200 : 409 });
        }

        return NextResponse.json(
            { error: 'Invalid action. Use { action: "start" | "stop" }' },
            { status: 400 }
        );
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
