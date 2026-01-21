import * as cheerio from 'cheerio';

export interface ArticleData {
  title: string;
  author: string;
  excerpt: string;
  blocks: any[];
}

// 移除不稳定的 Imgur 上传逻辑，改用 weserv 代理
// 这是一个开源的图片缓存/代理服务，可以绕过微信的防盗链
function getProxyUrl(originalUrl: string): string {
  try {
    // 移除 http/https 前缀，weserv 不需要，但保留也可以
    // 这里直接把完整 URL 传给 url 参数即可
    return `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}`;
  } catch (e) {
    return originalUrl;
  }
}

export async function parseWeChat(url: string): Promise<ArticleData> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
    }
  });
  let html = await res.text();
  console.log("Fetched HTML Length:", html.length);
  console.log("Fetch Status:", res.status);

  if (html.length < 500) {
    console.log("HTML Preview:", html);
  }

  // Pre-process HTML for WeChat lazy loading
  html = html.replace(/data-src=/g, 'src=');

  const $ = cheerio.load(html);

  // Extract metadata
  const title = $('#activity-name').text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text() ||
    'Untitled';

  const author = $('#js_name').text().trim() ||
    $('meta[name="author"]').attr('content') ||
    'WeChat Author';

  const excerpt = $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';

  // Remove scripts and styles
  $('#js_content script, #js_content style').remove();

  // Get content HTML
  const contentHtml = $('#js_content').html() || $('.rich_media_content').html() || '';

  // Convert to Notion Blocks
  const blocks = await convertHtmlToBlocks(contentHtml);

  return { title, author, excerpt, blocks };
}

async function convertHtmlToBlocks(html: string): Promise<any[]> {
  const $ = cheerio.load(html);
  const blocks: any[] = [];
  const seenTexts = new Set<string>();
  const seenImages = new Set<string>();

  const createTextBlock = (type: string, content: string) => ({
    object: 'block',
    type,
    [type]: {
      rich_text: [{ type: 'text', text: { content: content.substring(0, 2000) } }]
    }
  });

  const createImageUrl = (url: string) => ({
    object: 'block',
    type: 'image',
    image: { type: 'external', external: { url } }
  });

  function traverse(element: any) {
    if (!element) return;

    const tagName = element.name;
    const $el = $(element);

    // Handle Images
    if (tagName === 'img') {
      let src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-croporisrc');
      if (src && src.startsWith('http') && !seenImages.has(src)) {
        seenImages.add(src);
        console.log('Found image:', src.substring(0, 80));

        // 使用 Weserv 代理处理图片 URL
        const proxyUrl = getProxyUrl(src);
        blocks.push(createImageUrl(proxyUrl));
      }
      return;
    }

    // Handle Headers
    if (/^h[1-6]$/.test(tagName)) {
      const text = $el.text().trim();
      if (text && !seenTexts.has(text)) {
        seenTexts.add(text);
        const level = parseInt(tagName.replace('h', ''));
        const type = level <= 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
        blocks.push(createTextBlock(type, text));
      }
      return;
    }

    // Handle Lists
    if (tagName === 'ul' || tagName === 'ol') {
      const type = tagName === 'ul' ? 'bulleted_list_item' : 'numbered_list_item';
      $el.children('li').each((_, li) => {
        const liText = $(li).text().trim();
        if (liText && !seenTexts.has(liText)) {
          seenTexts.add(liText);
          blocks.push(createTextBlock(type, liText));
        }
      });
      return;
    }

    // Handle Paragraphs
    if (tagName === 'p') {
      const text = $el.text().trim();
      if (text && text.length > 1 && !seenTexts.has(text)) {
        seenTexts.add(text);
        blocks.push(createTextBlock('paragraph', text));
      }
      // Still check for images inside paragraphs
      $el.find('img').each((_, img) => traverse(img));
      return;
    }

    // Recurse into children
    const children = $el.children().toArray();
    if (children.length > 0) {
      children.forEach(child => traverse(child));
    } else {
      const text = $el.text().trim();
      if (text && text.length > 1 && !seenTexts.has(text)) {
        seenTexts.add(text);
        blocks.push(createTextBlock('paragraph', text));
      }
    }
  }

  // Start traversal
  const $body = $('body');
  $body.children().each((_, el) => traverse(el));

  console.log(`Extracted ${blocks.length} blocks (${seenImages.size} images, ${seenTexts.size} text blocks)`);

  return blocks;
}
