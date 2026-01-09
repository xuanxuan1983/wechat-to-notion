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
            // 飞书不允许空文本块，必须至少有一个空字符或者 placeholder
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
            // 链接支持
            if (t.href) {
                style.link = { url: t.href };
            }

            return {
                text_run: {
                    content: t.text.content || " ", // 防止空字符串
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
                if (elements.length > 0) {
                    feishuBlocks.push({
                        block_type: 2, // Text
                        text: { elements }
                    });
                }
            } else if (block.type === 'heading_1') {
                feishuBlocks.push({
                    block_type: 3, // H1
                    heading1: { elements: createTextElements(block.heading_1.rich_text) }
                });
            } else if (block.type === 'heading_2') {
                feishuBlocks.push({
                    block_type: 4, // H2
                    heading2: { elements: createTextElements(block.heading_2.rich_text) }
                });
            } else if (block.type === 'heading_3') {
                feishuBlocks.push({
                    block_type: 5, // H3
                    heading3: { elements: createTextElements(block.heading_3.rich_text) }
                });
            } else if (block.type === 'bulleted_list_item') {
                feishuBlocks.push({
                    block_type: 6, // Bullet
                    bullet: { elements: createTextElements(block.bulleted_list_item.rich_text) }
                });
            } else if (block.type === 'numbered_list_item') {
                feishuBlocks.push({
                    block_type: 7, // Ordered
                    ordered: { elements: createTextElements(block.numbered_list_item.rich_text) }
                });
            } else if (block.type === 'quote') {
                feishuBlocks.push({
                    block_type: 9, // Quote
                    quote: { elements: createTextElements(block.quote.rich_text) }
                });
            } else if (block.type === 'image') {
                const url = block.image?.external?.url || block.image?.file?.url;
                if (url) {
                    feishuBlocks.push({
                        block_type: 27, // Image
                        image: { token: "" }, // 必填 token 字段，虽然是空
                        _tempUrl: url
                    });
                }
            } else if (block.type === 'divider') {
                feishuBlocks.push({
                    block_type: 22, // Divider
                    divider: {}
                });
            }
        } catch (e) {
            console.error('Transform block error:', e, block);
        }
    }

    return feishuBlocks;
}

// 批量添加块到文档
// 注意：包含图片的块需要特殊处理
export async function addBlocksToDocument(
    accessToken: string,
    documentId: string,
    parentId: string,
    blocks: any[]
) {
    // 飞书 API 限制每次添加 50 个块，所以需要分批
    // 且图片需要单独处理流程：创建块 -> 上传 -> 更新
    // 为了简化，我们先批量创建所有块（图片块先创建空的），然后回过头来上传和更新图片

    const CHUNK_SIZE = 50;
    const createdBlockIds: string[] = [];

    // 1. 分批创建块
    for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
        const chunk = blocks.slice(i, i + CHUNK_SIZE);
        // 移除 _tempUrl 字段，它是我们内部用的
        const apiChunk = chunk.map(b => {
            const { _tempUrl, ...rest } = b;
            return rest;
        });

        const response = await fetch(`${FEISHU_API_BASE}/docx/v1/documents/${documentId}/blocks/${parentId}/children`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                children: apiChunk,
                index: -1 // 追加到末尾
            }),
        });

        const result = await response.json();
        if (result.code !== 0) {
            console.error('Failed to add blocks config:', JSON.stringify(apiChunk, null, 2));
            console.error('Feishu API Error:', result);
            // 尝试降级：如果批量失败，记录错误但不抛出致命异常，让流程继续（除非全失败）
            throw new Error(`添加内容块失败: ${result.msg} (Code: ${result.code})`);
        }

        // 记录创建的块的信息，主要为了找回图片块的 ID
        result.data.children.forEach((child: any) => createdBlockIds.push(child.block_id));
    }

    // 2. 处理图片上传
    // 我们需要将原始 blocks 和 createdBlockIds 对应起来
    // 假设 API 返回的 children 顺序和我们发送的顺序一致

    // 找到所有图片块索引
    const imageIndices = blocks
        .map((b, index) => (b.block_type === 27 && b._tempUrl) ? index : -1)
        .filter(index => index !== -1);

    for (const index of imageIndices) {
        const blockId = createdBlockIds[index];
        const imageUrl = blocks[index]._tempUrl;

        try {
            // 下载图片
            const imageResp = await fetch(imageUrl);
            const imageBuffer = await imageResp.arrayBuffer();

            // 上传图片到飞书
            // 飞书上传接口需要 FormData
            const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
            let formData = '';

            // parent_type
            formData += `--${boundary}\r\n`;
            formData += `Content-Disposition: form-data; name="parent_type"\r\n\r\n`;
            formData += `docx_image\r\n`;

            // parent_node
            formData += `--${boundary}\r\n`;
            formData += `Content-Disposition: form-data; name="parent_node"\r\n\r\n`;
            formData += `${blockId}\r\n`;

            // size
            formData += `--${boundary}\r\n`;
            formData += `Content-Disposition: form-data; name="size"\r\n\r\n`;
            formData += `${imageBuffer.byteLength}\r\n`;

            // file (binary) - Fetch doesn't support complex formdata easily in edge runtime or plain node without libs
            // So we use standard verify upload method if possible or simple upload

            // 为了避免处理复杂的 multipart/form-data，我们可以使用 "upload_all" 接口
            // 但 docx 要求 parent_node，所以必须用 multipart

            // 由于 Next.js edge/node 环境限制，这里使用纯 fetch 构造 multipart 比较麻烦
            // 简化方案：我们暂时只上传小图，或者不上传图片只放链接？
            // 不，用户要求"包含图片"。

            // 让我们尝试使用 FormData 对象 (Node 18+ 支持)
            const form = new FormData();
            form.append('file_name', 'image.jpg');
            form.append('parent_type', 'docx_image');
            form.append('parent_node', blockId);
            form.append('size', imageBuffer.byteLength.toString());
            form.append('file', new Blob([imageBuffer]));

            const uploadResp = await fetch(`${FEISHU_API_BASE}/drive/v1/medias/upload_all`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    // fetch 会自动设置 Content-Type boundary
                },
                body: form
            });

            const uploadResult = await uploadResp.json();
            if (uploadResult.code !== 0) {
                console.error('Image upload failed:', uploadResult);
                continue; // 失败则跳过该图片
            }

            const fileToken = uploadResult.data.file_token;

            // 更新图片块
            await fetch(`${FEISHU_API_BASE}/docx/v1/documents/${documentId}/blocks/${blockId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    replace_image: {
                        token: fileToken
                    }
                }),
            });

        } catch (e) {
            console.error('Process image error:', e, imageUrl);
        }
    }
}
