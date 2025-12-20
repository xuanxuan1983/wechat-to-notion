import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
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
        'Authorization': 'Client-ID c4a4a4506ee7e57', // 公共匿名Client ID
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

  // 0. Pre-process HTML for WeChat
  // Replace lazy loaded images
  html = html.replace(/data-src=/g, 'src=');

  // 1. Clean Parsing with Readability
  // We use JSDOM for Readability input
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Fix for lazy loading if regex missed (sometimes attributes are quoted differently)
  const images = doc.querySelectorAll('img');
  images.forEach(img => {
    if (!img.src && img.dataset.src) {
      img.src = img.dataset.src;
    }
  });

  const reader = new Readability(doc);
  const article = reader.parse();

  // 3. Prefer raw extraction for WeChat body to preserve structure
  // Readability often strips WeChat's nested <section> tags which contain 90% of the styling/structure.
  let contentHtml = '';
  const $ = cheerio.load(html); // Load processed HTML (with src fixed)

  // Remove scripts and styles
  $('#js_content script, #js_content style').remove();

  contentHtml = $('#js_content').html() || $('.rich_media_content').html() || article?.content || '';

  // 2. Convert Clean HTML to Notion Blocks (with image reuploading)
  const blocks = await convertHtmlToBlocks(contentHtml);

  return {
    title: article?.title || $('meta[property="og:title"]').attr('content') || 'Untitled',
    author: article?.byline || $('meta[name="author"]').attr('content') || 'WeChat Author',
    excerpt: article?.excerpt || $('meta[name="description"]').attr('content') || '',
    blocks
  };
}

async function convertHtmlToBlocks(html: string): Promise<any[]> {
  const $ = cheerio.load(html);
  const blocks: any[] = [];
  const seenTexts = new Set<string>(); // Avoid duplicate paragraphs
  const seenImages = new Set<string>(); // Avoid duplicate images
  const pendingImages: { index: number; src: string }[] = []; // Track images to reupload

  // Helper to create text block
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

  // True recursive traversal
  function traverse(element: any) {
    if (!element) return;

    const tagName = element.name;
    const $el = $(element);

    // Handle Images - leaf node
    if (tagName === 'img') {
      // WeChat uses multiple attributes for images
      let src = $el.attr('src') ||
        $el.attr('data-src') ||
        $el.attr('data-croporisrc') ||
        $el.attr('data-backsrc');

      // Clean up the URL (remove size parameters if needed)
      if (src && src.startsWith('http') && !seenImages.has(src)) {
        seenImages.add(src);
        console.log('Found image:', src.substring(0, 80));
        // Add placeholder, will be replaced after async upload
        const blockIndex = blocks.length;
        blocks.push(createImageUrl(src)); // Temporarily use original
        pendingImages.push({ index: blockIndex, src });
      }
      return;
    }

    // Handle Headers - leaf node (don't recurse into headers)
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

    // Handle Lists - process children but don't recurse deeper
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

    // Handle Blockquote
    if (tagName === 'blockquote') {
      const text = $el.text().trim();
      if (text && !seenTexts.has(text)) {
        seenTexts.add(text);
        blocks.push(createTextBlock('quote', text));
      }
      return;
    }

    // Handle Paragraphs - these are leaf text nodes
    if (tagName === 'p') {
      // First, extract any images inside the paragraph
      $el.find('img').each((_, img) => {
        const src = $(img).attr('src');
        if (src && src.startsWith('http') && !seenImages.has(src)) {
          seenImages.add(src);
          blocks.push(createImageUrl(src));
        }
      });

      // Then get the text (clone and remove img to get clean text)
      const $clone = $el.clone();
      $clone.find('img').remove();
      const text = $clone.text().trim();

      if (text && text.length > 1 && !seenTexts.has(text)) {
        seenTexts.add(text);
        blocks.push(createTextBlock('paragraph', text));
      }
      return;
    }

    // For container elements (section, div, span, etc.) - RECURSE into children
    const children = $el.children().toArray();
    if (children.length > 0) {
      children.forEach(child => traverse(child));
    } else {
      // No children but might have direct text
      const text = $el.text().trim();
      if (text && text.length > 1 && !seenTexts.has(text)) {
        seenTexts.add(text);
        blocks.push(createTextBlock('paragraph', text));
      }
    }
  }

  // Start traversal from body's children
  const $body = $('body');
  $body.children().each((_, el) => traverse(el));

  console.log(`Extracted ${blocks.length} blocks (${seenImages.size} images, ${seenTexts.size} text blocks)`);

  // Reupload images to Imgur (async)
  if (pendingImages.length > 0) {
    console.log(`Reuploading ${pendingImages.length} images to Imgur...`);

    // Process images in parallel (max 3 at a time to avoid rate limits)
    const batchSize = 3;
    for (let i = 0; i < pendingImages.length; i += batchSize) {
      const batch = pendingImages.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (img) => {
          const newUrl = await reuploadImage(img.src);
          return { index: img.index, newUrl };
        })
      );

      // Replace URLs in blocks
      for (const result of results) {
        if (result.newUrl) {
          blocks[result.index] = {
            object: 'block',
            type: 'image',
            image: { type: 'external', external: { url: result.newUrl } }
          };
        }
      }
    }

    console.log('Image reuploading complete');
  }

  return blocks;
}
