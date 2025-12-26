import { NextResponse } from 'next/server';
import { parseWeChat } from '@/lib/parser';
import { saveToNotion } from '@/lib/notion';

export async function POST(request: Request) {

    try {
        const { url, tags, apiKey, databaseId } = await request.json();

        if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

        // 验证用户凭据（如果提供）
        if (apiKey && !databaseId) {
            return NextResponse.json({ error: '请同时提供数据库 ID' }, { status: 400 });
        }
        if (databaseId && !apiKey) {
            return NextResponse.json({ error: '请同时提供 API Key' }, { status: 400 });
        }

        // validate URL
        try {
            new URL(url);
        } catch {
            return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
        }

        const article = await parseWeChat(url);
        const pageId = await saveToNotion(article, url, tags, apiKey, databaseId);

        return NextResponse.json(
            { success: true, pageId, title: article.title },
            {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                }
            }
        );
    } catch (error: any) {
        console.error(error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            {
                status: 500,
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
