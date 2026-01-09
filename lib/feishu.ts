import { ArticleData } from './parser';
import { createDocument, getDocumentBlockId, transformToFeishuBlocks, addBlocksToDocument } from './feishu-docx';

// 飞书 API 基础 URL
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// 获取 tenant_access_token
export async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
    const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret,
        }),
    });

    const data = await response.json();

    if (data.code !== 0) {
        throw new Error(data.msg || '获取飞书 Token 失败');
    }

    return data.tenant_access_token;
}

// 保存到飞书（升级版：文档 + 多维表格）
export async function saveToFeishu(
    article: ArticleData,
    url: string,
    tags: string[] = [],
    appId: string,
    appSecret: string,
    appToken: string, // 多维表格的 app_token
    tableId: string   // 数据表 ID
): Promise<string> {
    // 1. 获取访问令牌
    const token = await getFeishuToken(appId, appSecret);

    // 2. 创建飞书云文档 (DocX)
    const { documentId } = await createDocument(token, article.title || '未命名文章');
    const pageBlockId = await getDocumentBlockId(token, documentId);

    // 3. 写入内容（文字 + 图片）
    // 调试：极简化写入，排除 Block 结构错误的可能性
    // 只写入一个简单的纯文本块
    const simpleDebugBlock = {
        block_type: 2,
        text: {
            elements: [
                { text_run: { content: `文章已保存。` } },
                { text_run: { content: `原文链接：${url}` } }
            ]
        }
    };

    // 批量添加内容（仅简单块）
    await addBlocksToDocument(token, documentId, pageBlockId, [simpleDebugBlock]);

    /* 原有复杂逻辑，待调试成功后恢复
    // 先添加原文链接
    const sourceBlock = [{
        type: 'paragraph',
        paragraph: {
            rich_text: [
                { text: { content: '原文链接：' } },
                { text: { content: url }, href: url }
            ]
        }
    }];

    // 手动构造原文链接块
    const feishuSourceBlock = {
        block_type: 2,
        text: {
            elements: [
                { text_run: { content: '原文链接：' } },
                { text_run: { content: url, text_element_style: { link: { url: url } } } }
            ]
        }
    };

    const contentBlocks = transformToFeishuBlocks(article.blocks);
    
    // 批量添加内容
    await addBlocksToDocument(token, documentId, pageBlockId, [feishuSourceBlock, ...contentBlocks]);
    */

    // 4. 构造文档链接
    // 飞书云文档链接通常是：https://feishu.cn/docx/DOCUMENT_ID
    const docUrl = `https://www.feishu.cn/docx/${documentId}`;

    // 5. 保存记录到多维表格
    // 字段：标题、链接、保存时间、标签、内容（变为文档链接）
    const fields: Record<string, any> = {
        '标题': article.title || '未命名文章',
        '链接': { link: docUrl, text: '查看飞书文档' }, // 链接列存文档链接
        '原文': { link: url, text: '查看原文' },       // 原文列存原始链接
        '保存时间': Date.now(),
    };

    if (tags && tags.length > 0) {
        fields['标签'] = tags.join(', ');
    }

    const response = await fetch(
        `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fields }),
        }
    );

    const result = await response.json();

    if (result.code !== 0) {
        // 如果因为链接格式错误（比如用户设为了文本），尝试降级
        console.error('Feishu Bitable Error:', result);
        throw new Error(result.msg || '写入多维表格失败');
    }

    return result.data.record.record_id;
}

export async function testFeishuConnection(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string
): Promise<{ success: boolean; tableName?: string; error?: string }> {
    try {
        const token = await getFeishuToken(appId, appSecret);
        const response = await fetch(
            `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            }
        );

        const result = await response.json();
        if (result.code !== 0) throw new Error(result.msg);

        return { success: true, tableName: result.data.table.name };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getFeishuTables(
    appId: string,
    appSecret: string,
    appToken: string
): Promise<{ tableId: string; name: string }[]> {
    const token = await getFeishuToken(appId, appSecret);
    const response = await fetch(
        `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables`,
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    const result = await response.json();
    if (result.code !== 0) throw new Error(result.msg);

    return result.data.items.map((item: any) => ({
        tableId: item.table_id,
        name: item.name,
    }));
}
