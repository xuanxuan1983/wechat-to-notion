import { ArticleData } from './parser';

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

// 保存到飞书多维表格
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

    // 2. 准备记录数据
    // 飞书多维表格字段名需要与用户创建的表格匹配
    const fields: Record<string, any> = {
        '标题': article.title || '未命名文章',
        '链接': { link: url, text: url },
        '保存时间': Date.now(),
    };

    // 添加标签（如果表格有标签字段）
    if (tags && tags.length > 0) {
        fields['标签'] = tags.join(', ');
    }

    // 添加内容摘要（取前200字）
    if (article.blocks && article.blocks.length > 0) {
        const textBlocks = article.blocks.filter((b: any) => b.type === 'paragraph');
        const textContent = textBlocks
            .slice(0, 3)
            .map((b: any) => b.paragraph?.rich_text?.map((t: any) => t.text?.content || '').join('') || '')
            .join('\n');
        fields['内容摘要'] = textContent.substring(0, 500);
    }

    // 3. 调用飞书 API 添加记录
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
        console.error('Feishu API Error:', result);
        if (result.code === 1254043) {
            throw new Error('表格字段不匹配，请确保表格包含：标题、链接、保存时间 字段');
        }
        if (result.code === 1254001) {
            throw new Error('表格未找到，请检查表格 Token 和数据表 ID');
        }
        if (result.code === 99991663) {
            throw new Error('应用无权限访问该表格，请在表格设置中添加应用');
        }
        throw new Error(result.msg || '保存到飞书失败');
    }

    return result.data.record.record_id;
}

// 测试飞书连接
export async function testFeishuConnection(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string
): Promise<{ success: boolean; tableName?: string; error?: string }> {
    try {
        // 1. 获取 Token
        const token = await getFeishuToken(appId, appSecret);

        // 2. 获取表格信息
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

        if (result.code !== 0) {
            if (result.code === 1254001) {
                throw new Error('表格未找到');
            }
            if (result.code === 99991663) {
                throw new Error('应用无权限，请在表格设置中添加应用');
            }
            throw new Error(result.msg || '连接失败');
        }

        return {
            success: true,
            tableName: result.data.table.name,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || '连接失败',
        };
    }
}

// 获取多维表格的数据表列表（帮助用户选择 tableId）
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

    if (result.code !== 0) {
        throw new Error(result.msg || '获取表格列表失败');
    }

    return result.data.items.map((item: any) => ({
        tableId: item.table_id,
        name: item.name,
    }));
}
