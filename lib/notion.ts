import { Client } from '@notionhq/client';
import { ArticleData } from './parser';

// 创建 Notion 客户端的函数，支持用户自定义 API Key
function createNotionClient(apiKey?: string): Client {
    const key = apiKey || process.env.NOTION_API_KEY;
    if (!key) throw new Error("Missing Notion API Key");
    return new Client({ auth: key });
}

export async function saveToNotion(
    data: ArticleData,
    url: string,
    tags?: string[],
    userApiKey?: string,
    userDatabaseId?: string
) {
    // 使用用户提供的凭据，或回退到环境变量
    const databaseId = userDatabaseId || process.env.NOTION_DATABASE_ID;
    if (!databaseId) throw new Error("Missing Database ID");

    const notion = createNotionClient(userApiKey);

    // Add source link as first block
    const sourceBlock = {
        object: 'block',
        type: 'paragraph',
        paragraph: {
            rich_text: [
                { type: 'text', text: { content: 'Source: ' } },
                { type: 'text', text: { content: url, link: { url } } }
            ]
        }
    };

    const allBlocks = [sourceBlock, ...data.blocks];
    const chunks = chunkArray(allBlocks, 95); // Safe limit

    try {
        // Create Page with first chunk
        const response = await notion.pages.create({
            parent: { database_id: databaseId },
            icon: { type: 'emoji', emoji: '🔗' },
            properties: {
                Name: {
                    title: [{ text: { content: data.title || 'Untitled Article' } }]
                },
                ...(tags && tags.length > 0 ? {
                    Tags: {
                        multi_select: tags.map(tag => ({ name: tag }))
                    }
                } : {})
            },
            children: chunks[0]
        });

        // Append remaining chunks
        for (let i = 1; i < chunks.length; i++) {
            await notion.blocks.children.append({
                block_id: response.id,
                children: chunks[i]
            });
        }

        return response.id;
    } catch (error: any) {
        console.error("Notion API Error:", error);
        // 提供更友好的错误信息
        if (error.code === 'unauthorized') {
            throw new Error("API Key 无效或已过期");
        }
        if (error.code === 'object_not_found') {
            throw new Error("数据库未找到，请检查 ID 和权限");
        }
        throw new Error(error.message || "保存到 Notion 失败");
    }
}

// 测试连接函数
export async function testNotionConnection(apiKey: string, databaseId: string) {
    const notion = createNotionClient(apiKey);

    try {
        const database = await notion.databases.retrieve({ database_id: databaseId });
        // @ts-ignore - title 属性在某些类型中存在
        const title = database.title?.[0]?.plain_text || 'Database';
        return { success: true, databaseName: title };
    } catch (error: any) {
        if (error.code === 'unauthorized') {
            throw new Error("API Key 无效");
        }
        if (error.code === 'object_not_found') {
            throw new Error("数据库未找到，请检查 ID 或添加集成权限");
        }
        throw new Error(error.message || "连接失败");
    }
}

function chunkArray(array: any[], size: number) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}
