import { Client } from '@notionhq/client';
import { ArticleData } from './parser';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

export async function saveToNotion(data: ArticleData, url: string, tags?: string[]) {
    if (!process.env.NOTION_DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");

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
            parent: { database_id: process.env.NOTION_DATABASE_ID },
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
        throw new Error(error.message || "Failed to save to Notion");
    }
}

function chunkArray(array: any[], size: number) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}
