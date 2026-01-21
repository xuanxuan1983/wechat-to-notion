import { NextResponse } from 'next/server';
import { parseWeChat } from '@/lib/parser';
import { saveToNotion } from '@/lib/notion';
import { saveToFeishu } from '@/lib/feishu';

export async function POST(request: Request) {

    try {
        const body = await request.json();
        const { url, tags, platform = 'notion' } = body;

        if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

        // validate URL
        try {
            new URL(url);
        } catch {
            return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
        }

        // 解析文章
        const article = await parseWeChat(url);

        // AI 摘要
        let summary = '';
        let aiTags: string[] = [];
        let aiError = null;
        const { aiConfig } = body;

        if (aiConfig?.enabled && aiConfig?.apiKey) {
            // AI Summary logic removed as dependency is missing
        }

        const finalTags = [...(tags || []), ...aiTags];

        let resultId: string;

        // 根据平台选择保存方式
        if (platform === 'feishu') {
            // 飞书保存
            let { appId, appSecret, appToken, tableId } = body;

            // Fallback to Env Vars if not provided in body
            if (!appId) appId = process.env.FEISHU_APP_ID;
            if (!appSecret) appSecret = process.env.FEISHU_APP_SECRET;
            if (!appToken) appToken = process.env.FEISHU_BITABLE_APP_TOKEN;
            if (!tableId) tableId = process.env.FEISHU_BITABLE_TABLE_ID;

            if (!appId || !appSecret || !appToken || !tableId) {
                return NextResponse.json({ error: '请提供完整的飞书配置 (Body or Env)' }, { status: 400 });
            }

            resultId = await saveToFeishu(article, url, finalTags, appId, appSecret, appToken, tableId);
        } else {
            // Notion 保存
            const { apiKey, databaseId } = body;

            if (apiKey && !databaseId) {
                return NextResponse.json({ error: '请同时提供数据库 ID' }, { status: 400 });
            }
            if (databaseId && !apiKey) {
                return NextResponse.json({ error: '请同时提供 API Key' }, { status: 400 });
            }

            resultId = await saveToNotion(article, url, finalTags, apiKey, databaseId);
        }

        return NextResponse.json(
            {
                success: true,
                pageId: resultId,
                title: article.title,
                aiError: aiError // 返回 AI 错误信息
            },
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
