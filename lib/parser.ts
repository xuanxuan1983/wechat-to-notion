import * as cheerio from 'cheerio';

export interface ArticleData {
  title: string;
  author: string;
  excerpt: string;
  blocks: any[];
}

// Imgur匿名上传（免费，无需API Key）
async function reuploadImage(wechatUrl: string): Promise<string | null> {
  try {
    console.log('Downloading image from WeChat:', wechatUrl.substring(0, 60) + '...');

    // 下载微信图片（带正确的 Referer 绕过防盗链）
    const imgRes = await fetch(wechatUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://mp.weixin.qq.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    if (!imgRes.ok) {
      console.log('Failed to download image:', imgRes.status);
      return null;
    }

    const imageBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString('base64');

    // 上传到 Imgur
    const uploadRes = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': 'Client-ID c4a4a4506ee7e57',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: base64,
        type: 'base64'
      })
    });

    const uploadData = await uploadRes.json();

    if (uploadData.success && uploadData.data?.link) {
      console.log('Uploaded to Imgur:', uploadData.data.link);
      return uploadData.data.link;
    } else {
      console.log('Imgur upload failed:', uploadData);
      return null;
    }
  } catch (error) {
    console.error('Image reupload error:', error);
    return null;
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
  const pendingImages: { index: number; src: string }[] = [];

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
        const blockIndex = blocks.length;
        blocks.push(createImageUrl(src));
        pendingImages.push({ index: blockIndex, src });
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

  // Reupload images to Imgur
  if (pendingImages.length > 0) {
    console.log(`Reuploading ${pendingImages.length} images to Imgur...`);

    const batchSize = 3;
    for (let i = 0; i < pendingImages.length; i += batchSize) {
      const batch = pendingImages.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (img) => {
          const newUrl = await reuploadImage(img.src);
          return { index: img.index, newUrl };
        })
      );

      for (const result of results) {
        if (result.newUrl) {
          blocks[result.index] = createImageUrl(result.newUrl);
        }
      }
    }

    console.log('Image reuploading complete');
  }

  return blocks;
}
