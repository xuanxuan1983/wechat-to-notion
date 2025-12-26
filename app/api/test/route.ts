import { NextResponse } from 'next/server';
import { testNotionConnection } from '@/lib/notion';

export async function POST(request: Request) {
    try {
        const { apiKey, databaseId } = await request.json();

        if (!apiKey) {
            return NextResponse.json({ error: '请提供 API Key' }, { status: 400 });
        }
        if (!databaseId) {
            return NextResponse.json({ error: '请提供数据库 ID' }, { status: 400 });
        }

        const result = await testNotionConnection(apiKey, databaseId);

        return NextResponse.json(
            result,
            {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                }
            }
        );
    } catch (error: any) {
        console.error("Test connection error:", error);
        return NextResponse.json(
            { success: false, error: error.message || '连接失败' },
            {
                status: 200, // 返回 200 以便前端处理
                headers: {
                    'Access-Control-Allow-Origin': '*',
                }
            }
        );
    }
}

export async function OPTIONS(request: Request) {
    return NextResponse.json({}, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
