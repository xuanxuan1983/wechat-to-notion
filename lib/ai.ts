export async function generateSummary(content: string, apiKey: string): Promise<{ summary: string; tags: string[] }> {
    if (!content || !apiKey) {
        return { summary: '', tags: [] };
    }

    try {
        // 截取前 8000 字符，避免 token 超限 (DeepSeek V3 context window 很大，但考虑到响应速度和成本，取前文足够)
        const truncatedContent = content.substring(0, 8000);

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    {
                        role: "system",
                        content: "你是专业的文章摘要助手。请阅读文章，用中文生成一段简短的摘要（100字以内），并提取3-5个关键标签。返回格式必须是 JSON：{ \"summary\": \"...\", \"tags\": [\"tag1\", \"tag2\"] }"
                    },
                    {
                        role: "user",
                        content: truncatedContent
                    }
                ],
                response_format: {
                    type: "json_object"
                },
                max_tokens: 500
            })
        });

        if (!response.ok) {
            console.error('DeepSeek API error:', await response.text());
            return { summary: '', tags: [] };
        }

        const data = await response.json();
        const resultString = data.choices[0].message.content;

        try {
            const result = JSON.parse(resultString);
            return {
                summary: result.summary || '',
                tags: result.tags || []
            };
        } catch (e) {
            console.error('Parse DeepSeek response failed:', e);
            // Fallback: 如果 JSON 解析失败，直接返回 raw text 作为摘要
            return { summary: resultString, tags: [] };
        }

    } catch (e) {
        console.error('Generate summary exception:', e);
        return { summary: '', tags: [] };
    }
}
