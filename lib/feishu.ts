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
    // 先添加原文链接
    const sourceBlock = [{
        type: 'paragraph',
        paragraph: {
            rich_text: [
                { text: { content: '原文链接：' } },
                { text: { content: url }, href: url } // parser 需要支持 href 或我们在 transform 中处理
            ]
        }
    }];
    // 这里简单的构造一个 Parser 结构的 block，transform 会处理
    // 注意：我们刚才的 transformToFeishuBlocks 需要稍作修改以支持 href，或者我们手动构造飞书 block

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

    // 4. 构造文档链接
    // 飞书云文档链接通常是：https://feishu.cn/docx/DOCUMENT_ID
    const docUrl = `https://www.feishu.cn/docx/${documentId}`;

    // 5. 保存记录到多维表格
    // 字段：标题、链接、保存时间、标签、内容（变为文档链接）
    const fields: Record<string, any> = {
        '标题': article.title || '未命名文章',
        '链接': { link: url, text: url },
        '保存时间': Date.now(),
        // 如果用户有“内容”或“飞书文档”字段，填入文档链接（可选，防止报错）
        // 我们主要依赖链接跳转，或者用户可以加一个“文档链接”字段
        // 为了兼容性，我们把文档链接也放在 Description 甚至覆盖链接（不建议）
        // 最好的方式是：在表格里加一列「文档链接」
    };

    // 尝试探测是否有名为“文档链接”或“正文”的字段？
    // 由于我们不能动态获取字段名（除非再调一次 API），我们约定：
    // 如果有「正文」或「文档」字段，则填入。
    // 但为了简单，我们把 DocX 链接作为返回值返回给前端，
    // 或者，我们尝试写入一个叫 "飞书文档" 的字段，如果失败则忽略？
    // 为了稳妥，我们暂时只写入基础字段。
    // 但是！既然用户想看图文，表格里的“链接”点进去应该是 原文 还是 飞书文档？
    // 建议：把“链接”字段存原文，把“飞书文档”存到可能存在的文本字段，或者用户自己点开详情？
    // 另一种方案：把【标题】变成超链接，指向飞书文档？不行，标题通常是文本。

    // 决定：我们在 fields 中尝试写入 '飞书文档' 字段，如果用户没建这个字段，API 会报错吗？
    // 飞书 API 如果写入不存在的字段会报错 (1254043)。
    // 所以，我们可以在 getFeishuTables 时顺便获取字段？太复杂。
    // 策略：只写基础字段。用户可以通过 copy 下面的 documentId 自己关联？
    // 不，这太难用。

    // 改进策略：
    // 将 '链接' 字段存为 飞书文档链接 及其 text 为 "查看文档"？
    // 不，用户可能还想留原文链接。

    // 最终方案：
    // 在 '链接' 字段存入 { link: docUrl, text: "查看飞书文档" } ？这会丢失原文链接。
    // 让我们假设用户会创建一个 '正文' 或 '文档' 字段。
    // 或者，我们在 '标题' 上做文章？不行。

    // 我们先只写基础字段。文档已经创建了，就在飞书云文档列表里。
    // 但为了关联，我们把 DocUrl 放在返回结果里。

    // 这里我们稍微修改一下，尝试把 "链接" 字段设为 飞书文档链接，
    // 把 "原文链接" 放在文档的第一行（我们已经做了）。
    // 这样用户在表格里一点链接，直接进我们生成的文档！这最符合直觉。
    fields['链接'] = { link: docUrl, text: '查看飞书文档' };
    fields['原文'] = { link: url, text: '查看原文' };

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
