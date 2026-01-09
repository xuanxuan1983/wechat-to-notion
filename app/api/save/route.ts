import { NextResponse } from 'next/server';
import { parseWeChat } from '@/lib/parser';
import { saveToNotion } from '@/lib/notion';
import { saveToFeishu } from '@/lib/feishu';
import { generateSummary } from '@/lib/ai';

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
        const { aiConfig } = body;

        if (aiConfig?.enabled && aiConfig?.apiKey) {
            try {
                // 提取纯文本用于 AI
                const textContent = article.blocks
                    .filter(b => b.type === 'text' || b.type === 'heading')
                    .map(b => b.text)
                    .join('\n');

                if (textContent) {
                    const aiResult = await generateSummary(textContent, aiConfig.apiKey);
                    summary = aiResult.summary;
                    aiTags = aiResult.tags;
                }
            } catch (e) {
                console.error('AI Summary failed:', e);
            }
        }

        const finalTags = [...(tags || []), ...aiTags];

        let resultId: string;

        // 根据平台选择保存方式
        if (platform === 'feishu') {
            // 飞书保存
            const { appId, appSecret, appToken, tableId } = body;

            if (!appId || !appSecret || !appToken || !tableId) {
                return NextResponse.json({ error: '请提供完整的飞书配置' }, { status: 400 });
            }

            resultId = await saveToFeishu(article, url, finalTags, appId, appSecret, appToken, tableId, summary);
        } else {
            // Notion 保存
            const { apiKey, databaseId } = body;

            if (apiKey && !databaseId) {
                return NextResponse.json({ error: '请同时提供数据库 ID' }, { status: 400 });
            }
            if (databaseId && !apiKey) {
                return NextResponse.json({ error: '请同时提供 API Key' }, { status: 400 });
            }

            resultId = await saveToNotion(article, url, finalTags, apiKey, databaseId, summary);
        }

        return NextResponse.json(
            { success: true, pageId: resultId, title: article.title },
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
