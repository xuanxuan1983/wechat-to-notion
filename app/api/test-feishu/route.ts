import { NextResponse } from 'next/server';
import { testFeishuConnection, getFeishuTables } from '@/lib/feishu';

export async function POST(request: Request) {
    try {
        const { appId, appSecret, appToken, tableId } = await request.json();

        if (!appId) {
            return NextResponse.json({ error: '请提供 App ID' }, { status: 400 });
        }
        if (!appSecret) {
            return NextResponse.json({ error: '请提供 App Secret' }, { status: 400 });
        }
        if (!appToken) {
            return NextResponse.json({ error: '请提供表格 Token' }, { status: 400 });
        }

        // 如果提供了 tableId，测试具体表格连接
        if (tableId) {
            const result = await testFeishuConnection(appId, appSecret, appToken, tableId);
            return NextResponse.json(result, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                }
            });
        }

        // 如果没有 tableId，返回表格列表
        const tables = await getFeishuTables(appId, appSecret, appToken);
        return NextResponse.json(
            { success: true, tables },
            {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                }
            }
        );
    } catch (error: any) {
        console.error("Test Feishu connection error:", error);
        return NextResponse.json(
            { success: false, error: error.message || '连接失败' },
            {
                status: 200,
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
