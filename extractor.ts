import { type Cheerio, type CheerioAPI, type Element, load } from "npm:cheerio";
import beautify from "npm:js-beautify";

import { randomMobileUA, randomPCUA } from "./utils.ts";

const LAZY = ["data-src", "data-lazy-src", "data-original"];
const MEDIA_RE = /\.(jpe?g|png|gif|webp|mp4|webm|mov|m4v)(\?.*)?$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

export async function getHtmlText(
  url: string,
  layout: "pc" | "mobile",
): Promise<string> {
  const origin = new URL(url).origin;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": layout === "pc" ? randomPCUA() : randomMobileUA(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja-JP,ja;q=0.9",
      "Referer": origin,
    },
  });
  if (!resp.ok) throw new Error(`fetch error ${resp.status} for ${url}`);
  const text = await resp.text();
  return removeDuplicateEmptyLine(text);
}

function removeDuplicateEmptyLine(text: string): string {
  return text.replace(/\n\s*\n+/g, "\n");
}

function findValidMediaUrl($m: Cheerio<Element>): string {
  const lazySrc = LAZY.map((k) => $m.attr(k)?.trim()).find(Boolean) || "";
  if (MEDIA_RE.test(lazySrc)) return lazySrc;
  const src = $m.attr("src")?.trim() || "";
  if (MEDIA_RE.test(src) && !src.startsWith("data:image")) return src;
  return "";
}

function absolutizePaths($: CheerioAPI, pageURL: string) {
  $("[src], [href]").each((_, el) => {
    const $el = $(el);

    for (const attrName of ["src", "href"]) {
      const originalPath = $el.attr(attrName);
      if (
        !originalPath || originalPath.startsWith("javascript:") ||
        originalPath.startsWith("#")
      ) {
        continue;
      }

      const trimmedPath = originalPath.trim();

      try {
        if (/^https?:\/\//i.test(trimmedPath)) {
          continue;
        }
        const absoluteUrl = new URL(trimmedPath, pageURL).href;
        $el.attr(attrName, absoluteUrl);
      } catch (e) {
        console.log(e);
        console.warn(
          `Could not absolutize malformed path: "${trimmedPath}" on page ${pageURL}`,
        );
      }
    }
  });
}

function absolutizeCssImports($: CheerioAPI, pageURL: string) {
  $("style").each((_, styleEl) => {
    const $style = $(styleEl);
    const cssContent = $style.html();
    if (!cssContent || !cssContent.includes("@import")) return;
    const importRegex = /@import\s+(?:url\((['"]?)(.*?)\1\)|(['"])(.*?)\3);/g;
    const newCssContent = cssContent.replace(
      importRegex,
      (match, _q1, path1, _q2, path2) => {
        const originalPath = (path1 || path2).trim();
        if (
          !originalPath || /^(https?:)?\/\//i.test(originalPath)
        ) return match;
        try {
          return `@import url("${new URL(originalPath, pageURL).href}");`;
        } catch (_e) {
          return match;
        }
      },
    );
    $style.html(newCssContent);
  });
}

function removeScript($: CheerioAPI, allowHosts: Set<string>) {
  $("script").each((_, el) => {
    const $script = $(el);
    const src = $script.attr("src")?.trim();
    if (!src) {
      $script.remove();
      return;
    }
    try {
      const hostname =
        new URL(src.startsWith("//") ? `https:${src}` : src).hostname;
      if (!allowHosts.has(hostname)) $script.remove();
    } catch (_e) {
      $script.remove();
    }
  });
}

function removeSelector($: CheerioAPI, removeSelectors: string[]) {
  for (const selector of removeSelectors) {
    $(selector).remove();
  }
}

function convertImgurEmbeds($: CheerioAPI) {
  $('script[src*="imgur.com/js/embed.js"]').remove();
  $("blockquote.imgur-embed-pub[data-id]").each((_, el) => {
    const id = $(el).attr("data-id")?.trim();
    if (id) {
      $(el).replaceWith(
        `<img src="https://i.imgur.com/${id}.jpg" loading="lazy" referrerpolicy="no-referrer" />`,
      );
    }
  });
}

function convertRedditEmbeds($: CheerioAPI) {
  $("blockquote.reddit-embed-bq, blockquote.reddit-card").each((_, el) => {
    const $blockquote = $(el);
    const postUrl = $blockquote.find("a").first().attr("href");
    if (!postUrl) return;
    const embedUrl = new URL(postUrl);
    embedUrl.searchParams.set("embed", "true");
    const iframeTag =
      `<iframe src="${embedUrl.toString()}" width="315" height="360" style="border:none; max-width:100%;" scrolling="no" allowfullscreen></iframe>`;
    $blockquote.replaceWith(iframeTag);
  });
}

function unwrapAnchoredMedia($: CheerioAPI) {
  $("a, p, div.wp-video").each((_, element) => {
    const $el = $(element as Element);
    let url = "";
    if (element.tagName === "a") {
      const href = ($el.attr("href") || "").trim();
      let urlFound = false;
      try {
        const params = new URL(href).searchParams;
        for (const value of params.values()) {
          if (value.toLowerCase().startsWith("http") && MEDIA_RE.test(value)) {
            url = value;
            urlFound = true;
            break;
          }
        }
      } catch (_e) { /* noop */ }
      if (!urlFound && MEDIA_RE.test(href)) {
        url = href;
        urlFound = true;
      }
      if (!urlFound) {
        const $m = $el.find("img, video, source").first();
        if ($m.length) {
          url = findValidMediaUrl($m);
          if (url) urlFound = true;
        }
      }
      if (!urlFound) {
        const textContent = $el.text().trim();
        if (textContent.startsWith("http") && MEDIA_RE.test(textContent)) {
          url = textContent;
        }
      }
    } else {
      const $mediaElements = $el.find("img, video, source");
      if ($mediaElements.length === 0) return;
      const hasSignificantText = $el.contents().toArray().some((n) =>
        n.type === "text" && n.data.trim().length > 0
      );
      if (hasSignificantText) return;
      $mediaElements.each((_, mediaEl) => {
        url = findValidMediaUrl($(mediaEl as Element));
        if (url) return false;
      });
    }
    if (!MEDIA_RE.test(url)) return;
    const replacementTag = VIDEO_RE.test(url)
      ? `<video src="${url}" class="my-formatted" referrerpolicy="no-referrer" controls playsinline style="width:100%;height:auto;display:block;"></video>`
      : `<img src="${url}" class="my-formatted" referrerpolicy="no-referrer" style="width:100%;height:auto;display:block;" loading="lazy" />`;
    $el.replaceWith(replacementTag);
  });
  $("video:has(source)").each((_, videoEl) => {
    const $video = $(videoEl as Element);
    if ($video.attr("src")) return;
    const sourceSrc = $video.find("source[src]").first().attr("src")?.trim();
    if (sourceSrc) {
      $video.attr("src", sourceSrc).addClass("my-formatted").attr(
        "controls",
        "",
      ).attr("playsinline", "").css({
        width: "100%",
        height: "auto",
        display: "block",
      }).empty();
    }
  });
}

function convertVideoJs($: CheerioAPI) {
  $("video-js").each((_, vjsElement) => {
    const $vjs = $(vjsElement);
    const src = $vjs.find('source[type="video/mp4"]').attr("src")?.trim();
    const poster = $vjs.attr("poster")?.trim();
    if (!src) {
      $vjs.remove();
      return;
    }
    const replacementTag = `<video src="${src}" poster="${
      poster || ""
    }" class="my-formatted" controls playsinline style="width:100%;height:auto;display:block;" referrerpolicy="no-referrer"></video>`;
    $vjs.replaceWith(replacementTag);
  });
}

function normalizeImages($: CheerioAPI) {
  $("img:not(.my-formatted)").each((_, img) => {
    const $img = $(img);
    const src = findValidMediaUrl($img);
    if (!src) {
      $img.remove();
      return;
    }
    const $new = $("<img>").attr({
      src,
      loading: "lazy",
      referrerpolicy: "no-referrer",
      style: "max-width:100%;height:auto;display:block",
    }).addClass("my-formatted");
    $img.replaceWith($new);
  });
}

function normalizeIframes($: CheerioAPI, allowHosts: Set<string>) {
  $("iframe").each((_, element) => {
    const $iframe = $(element);
    const finalUrl = $iframe.attr("data-src")?.trim() ||
      $iframe.attr("src")?.trim();
    if (!finalUrl) {
      $iframe.remove();
      return;
    }
    $iframe.attr("src", finalUrl).removeAttr("data-src");
    try {
      const hostname = new URL(finalUrl).hostname;
      if (allowHosts.has(hostname)) {
        $iframe.attr({ width: "315", height: "360", loading: "lazy" }).css(
          "border",
          "none",
        );
      }
    } catch (_e) { /* noop */ }
  });
}

function removeVisuallyEmptyPTags($: CheerioAPI) {
  $("p").each((_, p) => {
    const $p = $(p);
    if ($p.find("a, img, video, iframe, input").length > 0) return;
    if ($p.text().trim() === "") $p.remove();
  });
}

function deduplicateMedia($: CheerioAPI) {
  const seenMediaUrls = new Set<string>();
  $("img.my-formatted, video.my-formatted").each((_, element) => {
    const $el = $(element);
    const src = $el.attr("src");
    if (!src) return;
    if (seenMediaUrls.has(src)) {
      $el.remove();
    } else {
      seenMediaUrls.add(src);
    }
  });
}

function collapseBr($: CheerioAPI, limit = 3) {
  $("br").each((_i, br) => {
    let current = $(br);
    let count = 1;
    while (current.next().is("br")) {
      current = current.next();
      count++;
    }
    if (count >= limit) {
      current.prevAll("br").slice(0, count - limit + 1).remove();
    }
  });
}

// --- メイン処理関数 ---

export function processArticleHtml(
  html: string,
  pageURL: string,
  removeSelectors: string[],
  allowHosts: Set<string>,
): string {
  const $ = load(html);

  // 1. パスとインポートを絶対化
  absolutizePaths($, pageURL);
  absolutizeCssImports($, pageURL);

  // 2. 不要なスクリプトとセレクタを削除
  removeScript($, allowHosts);
  removeSelector($, removeSelectors);

  // 3. 各種埋め込みコンテンツとメディアを正規化・整形
  convertImgurEmbeds($);
  convertRedditEmbeds($);
  unwrapAnchoredMedia($);
  convertVideoJs($);
  normalizeImages($);
  normalizeIframes($, allowHosts);

  // 4. クリーンアップ処理
  removeVisuallyEmptyPTags($);
  deduplicateMedia($);
  collapseBr($, 4);
  absolutizePaths($, pageURL);
  // 5. 最終的なHTMLを生成して返す
  const raw = removeDuplicateEmptyLine($.html().trim());
  return beautify.html(raw, { indent_size: 2 });
}
