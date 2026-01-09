import { getFeishuToken } from './feishu';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// 创建一个新的云文档
export async function createDocument(
    accessToken: string,
    title: string = '未命名文档',
    folderToken?: string
): Promise<{ documentId: string; revision: number }> {
    const response = await fetch(`${FEISHU_API_BASE}/docx/v1/documents`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            folder_token: folderToken || '', // 可选，指定文件夹
            title: title
        }),
    });

    const result = await response.json();
    if (result.code !== 0) {
        throw new Error(`创建文档失败: ${result.msg}`);
    }

    return {
        documentId: result.data.document.document_id,
        revision: result.data.document.revision_id
    };
}

// 获取文档的根块 ID (Page Block)
export async function getDocumentBlockId(accessToken: string, documentId: string): Promise<string> {
    const response = await fetch(`${FEISHU_API_BASE}/docx/v1/documents/${documentId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    const result = await response.json();
    if (result.code !== 0) {
        throw new Error(`获取文档详情失败: ${result.msg}`);
    }

    return result.data.document.document_id; // DocX 的 document_id 也就是 page block id
}

// 转换 Notion/Parser 块格式为飞书 DocX 块格式
// 返回一个 Block 数组
export function transformToFeishuBlocks(blocks: any[]): any[] {
    const feishuBlocks: any[] = [];

    // Helper: 构造 Text Element，过滤空内容
    const createTextElements = (richTraffic: any[]) => {
        if (!richTraffic || richTraffic.length === 0) {
            return [{ text_run: { content: " " } }];
        }

        const elements = richTraffic.map((t: any) => {
            const style: any = {};
            if (t.annotations) {
                if (t.annotations.bold) style.bold = true;
                if (t.annotations.italic) style.italic = true;
                if (t.annotations.strikethrough) style.strikethrough = true;
                if (t.annotations.underline) style.underline = true;
            }
            if (t.href) {
                style.link = { url: t.href };
            }

            return {
                text_run: {
                    content: t.text.content || " ",
                    text_element_style: Object.keys(style).length > 0 ? style : undefined
                }
            };
        });

        return elements.filter((e: any) => e.text_run.content);
    };

    for (const block of blocks) {
        try {
            if (block.type === 'paragraph') {
                const elements = createTextElements(block.paragraph.rich_text);
                if (elements.length > 0) feishuBlocks.push({ block_type: 2, text: { elements } });
            } else if (block.type === 'heading_1') {
                feishuBlocks.push({ block_type: 3, heading1: { elements: createTextElements(block.heading_1.rich_text) } });
            } else if (block.type === 'heading_2') {
                feishuBlocks.push({ block_type: 4, heading2: { elements: createTextElements(block.heading_2.rich_text) } });
            } else if (block.type === 'heading_3') {
                feishuBlocks.push({ block_type: 5, heading3: { elements: createTextElements(block.heading_3.rich_text) } });
            } else if (block.type === 'bulleted_list_item') {
                feishuBlocks.push({ block_type: 6, bullet: { elements: createTextElements(block.bulleted_list_item.rich_text) } });
            } else if (block.type === 'numbered_list_item') {
                feishuBlocks.push({ block_type: 7, ordered: { elements: createTextElements(block.numbered_list_item.rich_text) } });
            } else if (block.type === 'quote') {
                feishuBlocks.push({ block_type: 9, quote: { elements: createTextElements(block.quote.rich_text) } });
            } else if (block.type === 'image') {
                const url = block.image?.external?.url || block.image?.file?.url;
                if (url) {
                    // 调试：强制降级为纯文本，彻底排除 Image Block 数据结构问题
                    feishuBlocks.push({
                        block_type: 2,
                        text: { elements: [{ text_run: { content: `[图片: ${url}]` } }] }
                    });
                }
            } else if (block.type === 'divider') {
                feishuBlocks.push({ block_type: 22, divider: {} });
            }
        } catch (e) {
            console.error('Transform block error:', e, block);
        }
    }

    return feishuBlocks;
}

// 辅助：上传图片到飞书 Drive
async function uploadImageToFeishu(accessToken: string, imageUrl: string, parentNode: string): Promise<string | null> {
    try {
        const imageResp = await fetch(imageUrl);
        if (!imageResp.ok) return null;
        const imageBuffer = await imageResp.arrayBuffer();

        const form = new FormData();
        form.append('file_name', 'image.jpg');
        form.append('parent_type', 'docx_image');
        form.append('parent_node', parentNode);
        form.append('size', imageBuffer.byteLength.toString());
        form.append('file', new Blob([imageBuffer]));

        const uploadResp = await fetch(`${FEISHU_API_BASE}/drive/v1/medias/upload_all`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
            body: form
        });

        const uploadResult = await uploadResp.json();
        if (uploadResult.code !== 0) {
            console.error('Upload image failed:', uploadResult);
            return null;
        }
        return uploadResult.data.file_token;
    } catch (e) {
        console.error('Upload image exception:', e);
        return null;
    }
}

// 批量添加块到文档
export async function addBlocksToDocument(
    accessToken: string,
    documentId: string,
    parentId: string,
    blocks: any[]
) {
    // 1. 预处理：并行上传所有图片
    // 为了防止大量并发上传请求，我们可以分批或者直接 Promise.all
    // 考虑到文章图片通常不会太多，我们尝试直接处理

    // 找出所有图片块
    const finalBlocks: any[] = [];

    for (const block of blocks) {
        if (block._type === 'image_pending') {
            try {
                // 上传图片。注意：parent_node 需要是 document_id (对于 docx_image)
                const fileToken = await uploadImageToFeishu(accessToken, block.url, documentId);
                if (fileToken) {
                    finalBlocks.push({
                        block_type: 27, // Image
                        image: { token: fileToken }
                    });
                } else {
                    // 上传失败降级为链接
                    finalBlocks.push({
                        block_type: 2,
                        text: { elements: [{ text_run: { content: `[图片上传失败: ${block.url}]` } }] }
                    });
                }
            } catch (e) {
                // 异常处理
                finalBlocks.push({
                    block_type: 2,
                    text: { elements: [{ text_run: { content: `[图片处理错误]` } }] }
                });
            }
        } else {
            finalBlocks.push(block);
        }
    }

    if (finalBlocks.length === 0) return;

    // 2. 分批发送到飞书
    const CHUNK_SIZE = 50;
    for (let i = 0; i < finalBlocks.length; i += CHUNK_SIZE) {
        const chunk = finalBlocks.slice(i, i + CHUNK_SIZE);

        const response = await fetch(`${FEISHU_API_BASE}/docx/v1/documents/${documentId}/blocks/${parentId}/children`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                children: chunk,
                index: -1
            }),
        });

        const result = await response.json();
        if (result.code !== 0) {
            // 如果只有部分失败，我们尝试继续？不，抛出错误
            console.error('Add blocks failed:', result, chunk);
            throw new Error(`添加内容块失败: ${result.msg} (Code: ${result.code})`);
        }
    }
}
