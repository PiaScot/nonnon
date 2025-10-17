/**
 * HTML processing service using Cheerio
 * Replaces Python's BeautifulSoup with better performance and cleaner API
 */

import * as cheerio from 'cheerio';
import { appConfig, MEDIA_REGEX, VIDEO_REGEX } from '../utils/config.js';
import { logDebug, logWarn } from '../utils/logger.js';
import { fetchHtml } from '../utils/http-client.js';
import beautify from 'js-beautify';

/**
 * Process article HTML: main pipeline
 */
export async function processArticleHtml(
  html: string,
  pageUrl: string,
  removeSelectorsList: string[],
  allowHosts: Set<string>
  // renderTwitterCard?: (blockquoteHtml: string, scriptHtml: string) => Promise<string | null>
): Promise<string> {
  const $ = cheerio.load(html);

  // Step 1: Absolutize paths
  absolutizePaths($, pageUrl);

  // Step 2: Check and process pagination
  if (checkPagingContents($)) {
    logDebug('Starting pagination processing');
    await processPaging($, pageUrl, removeSelectorsList, allowHosts);
  }

  // Step 3: Remove scripts (except allowed hosts)
  removeScripts($, allowHosts);

  // Step 4: Remove unwanted selectors
  removeSelectors($, removeSelectorsList);

  // Step 5: Convert Twitter cards (if renderer provided)
  // if (renderTwitterCard) {
  //   await convertTwitterCards($, renderTwitterCard);
  // }

  // Step 6: Unwrap Imgur embeds (before anchor processing)
  unwrapImgur($);

  // Step 7: Unwrap anchored media
  unwrapAnchoredMedia($);

  // Step 8: Normalize iframes
  normalizeIframes($, allowHosts);

  // Step 9: Normalize images (after unwrapping)
  normalizeImages($);

  // Step 10: Cleanup empty tags
  cleanupEmptyTags($);

  // Step 11: Collapse excessive line breaks
  collapseExcessiveBrs($);

  // Step 12: Inject reset CSS
  injectResetCSS($);

  // Step 13: Format page (domain-specific customization)
  formatPage($, pageUrl);

  const sanitizedHtml = $.html();
  let processedHtml = sanitizedHtml.replace(/\n{2,}/g, '\n\n');
  processedHtml = beautify.html(processedHtml, {
    indent_size: 2,
    indent_char: ' ',
    max_preserve_newlines: 1,
    preserve_newlines: true,
    wrap_line_length: 0,
    end_with_newline: true,
  });
  return processedHtml;
}

/**
 * Inject minimal reset CSS for mobile optimization
 */
function injectResetCSS($: cheerio.CheerioAPI): void {
  const resetCSS = `
    <style id="ua-reset">
      /* 全要素リセット */
      *, *::before, *::after {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        line-height: 0px;
      }

      /* ブラウザデフォルトスタイル除去 */
      html, body, div, span, h1, h2, h3, h4, h5, h6, p,
      blockquote, pre, a, img, ul, ol, li, table, tr, td, th {
        margin: 0;
        padding: 0;
        border: 0;
        font-size: 100%;
        font: inherit;
        vertical-align: baseline;
      }

      body {
        -webkit-text-size-adjust: 100%;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        font-size: 16px;
      }

      img, video, iframe {
        max-width: 100%;
        height: auto;
        display: block;
      }
    </style>
  `;

  // Insert at the beginning of <head>
  const head = $('head');
  if (head.length > 0) {
    head.prepend(resetCSS);
  }
}


/**
 * Domain-specific page formatting
 */
function formatPage($: cheerio.CheerioAPI, pageUrl: string): void {
  try {
    const url = new URL(pageUrl);
    const domain = url.hostname;

    switch (domain) {
      case 'vippers.jp': {
        // Get the second header.section-box
        const headers = $('header.section-box');
        if (headers.length < 2) break;

        const secondHeader = headers.eq(1);
        const articleContents = $('div#article-contents');

        if (articleContents.length === 0) break;

        // Move second header before article-contents
        secondHeader.insertBefore(articleContents);
        break;
      }

      // Add more domain-specific formatting here
      // case 'example.com': {
      //   // Custom formatting for example.com
      //   break;
      // }

      default:
        // No special formatting needed
        break;
    }
  } catch (error) {
    logWarn(`Failed to parse URL for formatPage: ${pageUrl}`);
  }
}

/**
 * Make all relative URLs absolute
 */
function absolutizePaths($: cheerio.CheerioAPI, pageUrl: string): void {
  $('[src], [href]').each((_, elem) => {
    const $elem = $(elem);

    ['src', 'href'].forEach((attr) => {
      const value = $elem.attr(attr);
      if (!value || value.startsWith('javascript:') || value.startsWith('#')) {
        return;
      }

      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        return;
      }

      try {
        const absolute = new URL(trimmed, pageUrl).href;
        $elem.attr(attr, absolute);
      } catch (error) {
        logWarn(`Could not absolutize malformed path: "${trimmed}" on page ${pageUrl}`);
      }
    });
  });
}

/**
 * Check if content has pagination
 */
function checkPagingContents($: cheerio.CheerioAPI): boolean {
  const divContents = $('div#article-contents').length;
  const divArticleBodies = $('div.article-body').length;
  const aPagingNav = $('p.next > a.pagingNav').length;

  return divContents >= 1 && divArticleBodies >= 1 && aPagingNav >= 1;
}

/**
 * Process pagination: fetch all pages and append content
 */
async function processPaging(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  _removeSelectorsList: string[],
  _allowHosts: Set<string>
  // _renderTwitterCard?: (blockquoteHtml: string, scriptHtml: string) => Promise<string | null>
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextPageContents: any[] = [];
  let currentUrl = pageUrl;
  let nextPageLink = $('p.next > a.pagingNav').first();

  while (nextPageLink.length > 0) {
    const href = nextPageLink.attr('href');
    if (!href) break;

    const nextPageUrl = new URL(href, currentUrl).href;

    const nextPageHtml = await fetchHtml(nextPageUrl, 'mobile');
    if (!nextPageHtml) {
      logWarn(`Failed to fetch page: ${nextPageUrl}`);
      break;
    }

    const next$ = cheerio.load(nextPageHtml);

    // Important: Process each page to clean it
    const articleBody = next$('div#article-contents, div.article-body').first();
    if (articleBody.length > 0) {
      articleBody.children().each((_, child) => {
        nextPageContents.push(child);
      });
    }

    nextPageLink = next$('p.next > a.pagingNav').first();
    currentUrl = nextPageUrl;
  }

  // Append all collected content to main article body
  const mainArticleBody = $('div#article-contents, div.article-body').first();
  if (mainArticleBody.length > 0) {
    nextPageContents.forEach((content) => {
      mainArticleBody.append(content);
    });
  }

  // Remove pagination elements
  $('div.article-inner-pager').remove();
}

/**
 * Remove script tags except from allowed hosts
 */
function removeScripts($: cheerio.CheerioAPI, allowHosts: Set<string>): void {
  $('script').each((_, elem) => {
    const $script = $(elem);
    const src = $script.attr('src');

    if (!src) {
      $script.remove();
      return;
    }

    try {
      const hostname = new URL(src.trim()).hostname;
      if (!allowHosts.has(hostname)) {
        $script.remove();
      }
    } catch {
      $script.remove();
    }
  });
}

/**
 * Remove elements matching CSS selectors
 */
function removeSelectors($: cheerio.CheerioAPI, selectors: string[]): void {
  selectors.forEach((selector) => {
    try {
      $(selector).remove();
    } catch (error) {
      logWarn(`Invalid selector: ${selector}`);
    }
  });
}

/**
 * Convert Twitter blockquotes to rendered cards
 */
// async function convertTwitterCards(
//   $: cheerio.CheerioAPI,
//   renderTwitterCard: (blockquoteHtml: string, scriptHtml: string) => Promise<string | null>
// ): Promise<void> {
//   const twitterScript = $('script[src*="platform.twitter.com/widgets.js"]').first();
//   if (twitterScript.length === 0) return;
//
//   const scriptHtml = $.html(twitterScript);
//   const blockquotes = $('blockquote.twitter-tweet').toArray();
//
//   for (const blockquote of blockquotes) {
//     const $blockquote = $(blockquote);
//
//     // Fix empty link text
//     const link = $blockquote.find('a').first();
//     if (link.length > 0 && !link.text().trim()) {
//       const href = link.attr('href');
//       if (href) {
//         link.text(href);
//       }
//     }
//
//     const blockquoteHtml = $.html($blockquote);
//     const renderedCard = await renderTwitterCard(blockquoteHtml, scriptHtml);
//
//     if (renderedCard) {
//       $blockquote.replaceWith(renderedCard);
//     }
//   }
//
//   // Remove Twitter script after processing
//   $('script[src*="platform.twitter.com/widgets.js"]').remove();
// }

/**
 * Unwrap Imgur embeds
 */
function unwrapImgur($: cheerio.CheerioAPI): void {
  // Handle iframe embeds
  $('iframe[src*="imgur.com"]').each((_, elem) => {
    const $iframe = $(elem);
    const src = $iframe.attr('src');
    if (!src) return;

    const match = src.match(/imgur\.com\/([a-zA-Z0-9]{5,})/);
    if (match) {
      const imgId = match[1];
      const newImg = createImgurImgTag($, imgId);
      $iframe.replaceWith(newImg);
    }
  });

  // Handle blockquote embeds
  $('blockquote.imgur-embed-pub[data-id]').each((_, elem) => {
    const $blockquote = $(elem);
    const imgId = $blockquote.attr('data-id');
    if (imgId && imgId.trim()) {
      const newImg = createImgurImgTag($, imgId.trim());
      $blockquote.replaceWith(newImg);
    }
  });
}

function createImgurImgTag($: cheerio.CheerioAPI, imgId: string): string {
  const img = $('<img>');
  img.attr({
    src: `https://i.imgur.com/${imgId}.jpeg`,
    alt: `imgur ID:${imgId} image`,
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    style: 'max-width:100%;height:auto;display:block',
    class: 'my-formatted',
  });
  return $.html(img);
}

/**
 * Normalize iframes from allowed hosts
 */
function normalizeIframes($: cheerio.CheerioAPI, allowHosts: Set<string>): void {
  $('iframe[src]').each((_, elem) => {
    const $iframe = $(elem);
    const src = $iframe.attr('src');
    if (!src) return;

    try {
      const hostname = new URL(src.trim()).hostname;
      if (hostname && allowHosts.has(hostname)) {
        // Skip Twitter iframes (handled separately)
        if (hostname === 'platform.twitter.com') return;

        $iframe.attr({
          width: '100%',
          height: 'auto',
          style: 'aspect-ratio: 16 / 9; width: 100%; height: auto;',
        });
      }
    } catch (error) {
      // Invalid URL, skip
    }
  });
}

/**
 * Find valid media URL from lazy loading attributes
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findValidMediaUrl($elem: cheerio.Cheerio<any>): string {
  // Check lazy loading attributes first
  for (const attr of appConfig.lazyAttrs) {
    const lazySrc = $elem.attr(attr);
    if (lazySrc && MEDIA_REGEX.test(lazySrc.trim())) {
      return lazySrc.trim();
    }
  }

  // Check regular src
  const src = $elem.attr('src');
  if (src && MEDIA_REGEX.test(src.trim()) && !src.startsWith('data:image')) {
    return src.trim();
  }

  return '';
}

/**
 * Normalize images and videos
 */
function normalizeImages($: cheerio.CheerioAPI): void {
  $('img:not(.my-formatted)').each((_, elem) => {
    const $img = $(elem);

    const src = findValidMediaUrl($img);
    if (!src) {
      $img.remove();
      return;
    }

    // Create video or image tag
    if (VIDEO_REGEX.test(src)) {
      const videoHtml = `<video src="${src}" controls playsinline style="width:100%;height:auto;display:block;" class="my-formatted" loading="lazy" referrerpolicy="no-referrer"></video>`;
      $img.replaceWith(videoHtml);
    } else {
      $img.attr({
        src,
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
        style: 'max-width:100%;height:auto;display:block',
        class: 'my-formatted',
      });
    }
  });
}

/**
 * Unwrap anchored media (links to images/videos)
 */
function unwrapAnchoredMedia($: cheerio.CheerioAPI): void {
  $('a, p, div.wp-video').each((_, elem) => {
    const $elem = $(elem);

    // Skip if contains iframe
    if ($elem.find('iframe').length > 0) return;

    let url = '';

    if ($elem.is('a')) {
      const href = $elem.attr('href') || '';

      // Check query parameters for media URLs
      try {
        const urlObj = new URL(href);
        for (const value of urlObj.searchParams.values()) {
          if (value.toLowerCase().startsWith('http') && MEDIA_REGEX.test(value)) {
            url = value;
            break;
          }
        }
      } catch {
        // Not a valid URL, continue
      }

      // Check href directly
      if (!url && MEDIA_REGEX.test(href)) {
        url = href;
      }

      // Check nested media
      if (!url) {
        const nestedMedia = $elem.find('img, video, source').first();
        if (nestedMedia.length > 0) {
          url = findValidMediaUrl(nestedMedia);
        }
      }

      // Check text content
      if (!url) {
        const text = $elem.text().trim();
        if (text.toLowerCase().startsWith('http') && MEDIA_REGEX.test(text)) {
          url = text;
        }
      }
    } else {
      // For non-anchor elements, check if they only contain media
      const hasSignificantText = $elem
        .contents()
        .toArray()
        .some((node) => {
          return node.type === 'text' && node.data?.trim();
        });

      if (hasSignificantText) return;

      // Find media in children
      const mediaEl = $elem.find('img, video, source').first();
      if (mediaEl.length > 0) {
        url = findValidMediaUrl(mediaEl);
      }
    }

    // Replace with media tag if URL found
    if (url && MEDIA_REGEX.test(url)) {
      const isVideo = VIDEO_REGEX.test(url) || url.toLowerCase().match(/\.(mp4|webm|mov|ogv)$/);

      const newTagHtml = isVideo
        ? `<video src="${url}" controls playsinline style="width:100%;height:auto;display:block;" class="my-formatted" loading="lazy" referrerpolicy="no-referrer"></video>`
        : `<img src="${url}" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%;height:auto;display:block" class="my-formatted">`;

      $elem.replaceWith(newTagHtml);
    }
  });

  // Handle video tags with source children
  $('video:has(source)').each((_, elem) => {
    const $video = $(elem);
    if ($video.attr('src')) return;

    const $source = $video.find('source[src]').first();
    if ($source.length > 0) {
      const src = $source.attr('src');
      if (src) {
        $video.attr({
          src,
          controls: '',
          playsinline: '',
          style: 'width:100%;height:auto;display:block;',
          class: 'my-formatted',
        });
        $video.empty(); // Remove source children
      }
    }
  });
}

/**
 * Remove empty paragraph tags
 */
function cleanupEmptyTags($: cheerio.CheerioAPI): void {
  $('p').each((_, elem) => {
    const $p = $(elem);
    const text = $p.text().trim();
    const hasMedia = $p.find('a, img, video, iframe, input').length > 0;

    if (!text && !hasMedia) {
      $p.remove();
    }
  });
}

/**
 * Collapse excessive consecutive <br> tags
 */
function collapseExcessiveBrs($: cheerio.CheerioAPI, maxConsecutive: number = 2): void {
  $('br').each((_, elem) => {
    const $br = $(elem);
    let count = 1;
    let next = $br.next();

    while (next.length > 0 && next.is('br')) {
      count++;
      next = next.next();
    }

    if (count > maxConsecutive) {
      // Remove excess <br> tags
      let current = $br.next();
      let removed = 0;

      while (current.length > 0 && current.is('br') && removed < count - maxConsecutive) {
        const toRemove = current;
        current = current.next();
        toRemove.remove();
        removed++;
      }
    }
  });
}
