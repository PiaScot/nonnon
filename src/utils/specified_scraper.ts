import * as cheerio from 'cheerio';

export interface ExtractOpt {
  // Cheerio<Element> の Element に対してfind(tagName) を受け取り条件に従って
  // 不要なタグを type:Element として操作し削除するutilities

  /** メイン抽出用CSSセレクタ */
  mainSelectorTag: string | (($: cheerio.CheerioAPI) => cheerio.Cheerio<Element>);
  /** 除去したい要素のCSSセレクタリスト */
  removeSelectorTags?: string[];
  // 外側の不要なアンカー要素を削除しimgタグのみ表示させる
  transVisibleImage?: string;
  /** data-srcやlazy-dara-src属性など、src属性に格納し画像タグの属性をよりスリムにする **/
  imgDataSrcToImgSrc?: string;
  // iframe 要素にあるsrc属性の修正
  iframeSrcToWithSuffixInItemFix?: boolean;
  // video コンテンツを不要な属性を落としスリムにする
  simplifyVideoElement?: string;
  // 空要素となっているtag <center></center>のようなタグを削除する
  removeEmptyTag?: string;
  /** DOMPurifyに追加で許可するタグ */
  sanitizedAddTags?: string[];

  // sanitizeをしjs-beautifyでformatした後文字列として操作をするutilities

  /** br連続をまとめる上限回数 */
  reducebr?: number;
  // アフィリエイトIDを削除し著者になるべく収益を発生させないようにする処理
  removeAffiID?: boolean;
  // img src="data:image/..." にマッチし style,alt 属性をモバイル環境下でも閲覧しやすい環境にする。
  fixBase64Img?: boolean;
  // imgurのblockquoteタグをimgタグに変換する関数（data-id属性が存在する場合のみ）
  imgurToImg?: boolean;
  // twitter card をみえるようにするためにtwitter-api の js を追加する
  twitterEmbed?: boolean;
  // 正規表現として任意のタグを削除する ※find(tag).remove() で消えない用
  removeTagAsString?: string;
  // img タグなどsrc属性がhttps? で始まらない場合それを付加する
  toFullURL?: string;
  // 文字列としてタグ間の文字列を削除する
  removeTagStr?: string;
  // tag 操作のoperation の最後に行われる
  // operation を繰り返すことでタグの中身のないもが増えるため最後に削除する
  removeString?: string;
}

export function baseExtract(html: string, opt: ExtractOpt): string {
  const $: cheerio.CheerioAPI = cheerio.load(html);
  const root: cheerio.Cheerio<Element> = typeof opt.mainSelectorTag === "string"
    ? $(opt.mainSelectorTag) // 文字列 → CSS セレクタ
    : opt.mainSelectorTag($); // 関数   → コールバック
  if (!root.length) {
    console.error(
      `Error: Can't make root Element specified mainSelector => ${opt.mainSelectorTag}`,
    );
    return "";
  }

  if (opt.removeSelectorTags) {
    for (const sel of opt.removeSelectorTags) {
      root.find(sel).remove();
    }
  }

  if (opt.transVisibleImage) {
    root.find(opt.transVisibleImage)
      .has("img, video, source")
      .each((_i, el) => {
        const $a = $(el);
        const $childVideo = $a.find("video, source").first();
        if ($childVideo.length) {
          const videoSrc = $childVideo.attr("src") || $a.attr("href") || "";
          if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(videoSrc)) {
            console.log(`Found video Element => ${videoSrc}`);
            $a.replaceWith(
              `<video src="${videoSrc}" controls playsinline
              style="max-width:100%;height:auto;"></video>`,
            );
            return;
          }
        }

        const $img = $a.find("img").first();
        const imgSrc = $img.attr("src") ??
          $img.attr("data-src") ??
          $img.attr("data-eio-rsrc") ??
          "";
        if (imgSrc && /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(imgSrc)) {
          // console.log(`Found img Element => ${imgSrc}`);
          $img.attr("src", imgSrc);
          $a.replaceWith($img);
        }
      });
  }

  if (opt.imgDataSrcToImgSrc) {
    const tag = opt.imgDataSrcToImgSrc; // e.g. "data-src"
    root.find(`img[${tag}]`).each(function() {
      const $oldImg = $(this);
      const dataSrc = $oldImg.attr(tag);
      if (!dataSrc) {
        console.log(`Found img[${tag}] but, no value => ${dataSrc}`);
        return;
      }
      const $newImg = $("<img>").attr("src", dataSrc);
      $oldImg.replaceWith($newImg);
    });
  }

  if (opt.iframeSrcToWithSuffixInItemFix) {
    root.find("iframe").each((_, iframe) => {
      const src = $(iframe).attr("src");
      if (src?.includes("itemfix.com")) {
        $(iframe).attr("src", `https:${src}`);
      }
    });
  }

  if (opt.simplifyVideoElement) {
    // 指定されたクラス名のdiv要素を対象とする
    const tag = opt.simplifyVideoElement;
    root.find(tag).each((_, container) => {
      const $container = $(container);
      const source = $container.find('source[type="video/mp4"]');
      if (source.length) {
        const src = source.attr("src");
        if (src) {
          $container.replaceWith(`<video src="${src}" controls></video>`);
        }
      }
    });
  }

  if (opt.removeEmptyTag) {
    const tag = opt.removeEmptyTag;
    root.find(tag).each(function() {
      const content = $(this).text().trim();
      if (!content) {
        $(this).remove(); // Remove if it's empty or contains only non-visible characters
      }
    });
  }
  /* ========= noscript 内にある iframe を展開 ========= */
  // dompurify は noscript をうまく抜き出せないので事前に取得
  root.find("noscript").each((_i, el) => {
    const $ns = $(el);
    const inner = $ns.html() ?? "";
    const $$ = cheerio.load(inner); // noscript の中をパース
    const $if = $$("iframe").first(); // <iframe> を抜く

    if ($if.length) {
      // lazyload 用 data-src → src に昇格
      if ($if.attr("data-src") && !$if.attr("src")) {
        $if.attr("src", $if.attr("data-src"));
      }
      $ns.replaceWith($if); // noscript → iframe 差し替え
    } else {
      $ns.remove(); // iframe 無ければ削除
    }
  });

  // const dirty = root.html() || "";
  const dirty = root.map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n");
  // 6) DOMPurify sanitize
  const allow = opt.sanitizedAddTags ?? ["iframe", "script", "noscript"];
  const clean = DOMPurify.sanitize(dirty, {
    ADD_TAGS: allow,
    ADD_ATTR: ["src", "alt", "href", "controls", "playsinline"],
  });
  let output = beautify.html(clean, { indent_size: 2 });

  if (opt.reducebr) {
    output = output.replace(
      new RegExp(`(?:<br\\s*/?>\\s*){${opt.reducebr},}`, "gi"),
      "<br>",
    );
  }

  if (opt.removeAffiID) {
    output = output.replace(/affi_id=[^/]+\//, "");
  }

  if (opt.fixBase64Img) {
    // 正規表現:
    //  - (<img\s+[^>]*src="data:image/[^"]+"[^>]*)(>):
    //    先頭を $1, 閉じタグ手前を $2 としてキャプチャ
    //  - gi: 大文字小文字無視、複数行にわたって検索
    const pattern = /(<img\s+[^>]*src="data:image\/[^"]+"[^>]*)(>)/gi;

    // $1 と $2 の間に style と alt を挿入する
    output = output.replace(
      pattern,
      '$1 style="width: 32px; height: 32px;" alt="emoji"$2',
    );
  }

  if (opt.imgurToImg) {
    /* 1) <script …embed.js> を除去 */
    output = output.replace(
      /<script\b[^>]*embed\.js[^<]*<\/script>/gi,
      "",
    );

    /* 2) <blockquote data-id="…"> を <img src="https://i.imgur.com/ID.jpg"> へ */
    output = output.replace(
      /<blockquote\b[^>]*\bdata-id="([^"]+)"[^>]*>[\s\S]*?<\/blockquote>/gi,
      (_: string, id: string) => `<img src="https://i.imgur.com/${id}.jpg" />`,
    );
    /* 3) <span>https://i.imgur.com/….jpg</span> を <img src="…"> に */
    // output = output.replace(
    //   /<span[^>]*>\s*(https?:\/\/i\.imgur\.com\/[^\s<]+?\.jpg)\s*<\/span>/gi,
    //   (_: string, url: string) => `<img src="${url}" />`,
    // );
  }
  if (opt.twitterEmbed) {
    // blockquote.twitter-tweet が 1 つでもあれば widgets.js を末尾に挿入
    if (
      /<blockquote[^>]+twitter-tweet/i.test(output) &&
      !/platform\.twitter\.com\/widgets\.js/i.test(output)
    ) {
      output +=
        '\n<script async src="https://platform.twitter.com/widgets.js"></script>';
    }
  }

  if (opt.removeTagStr) {
    const regex = new RegExp(
      `<${opt.removeTagAsString}[\\s\\S]*?<\\/${opt.removeTagAsString}>`,
      "gi",
    );
    output = output.replace(regex, "");
  }

  if (opt.toFullURL) {
    const base = opt.toFullURL.replace(/\/+$/, ""); // ← 末尾スラッシュを 1 本だけに整理

    root.find("[src]").each((_i, el) => {
      let src = $(el).attr("src") ?? "";

      /* ① 前後・途中に紛れ込んだ空白文字を全部除去 ------------------------ */
      //  ‣ trim()        : 先頭末尾の空白を除去
      //  ‣ replace(/\s+/g,"") : タグ内改行やタブまで丸ごと消す
      src = src.trim().replace(/\s+/g, "");

      /* ② 既に絶対 URL（http / https）なら何もしない ---------------------- */
      if (/^https?:\/\//i.test(src)) return;

      /* ③ 相対 → 絶対変換 ----------------------------------------------- */
      //   - 先頭の「/」は削り、base と結合
      const abs = `${base}/${src.replace(/^\/+/, "")}`;
      $(el).attr("src", abs);
    });
  }

  if (opt.removeString) {
    const regex = new RegExp(opt.removeString, "gis");
    output = output.replace(regex, "");
  }

  // return output.trim();
  return removeDuplicateEmptyLine(output.trim());
}

const EXTRACTOR: Record<string, (body: string) => string | Promise<string>> = {
  "ani-chat.net": _ani_chat_extract,
  "korewaeroi.com": _korewaeroi_extract,
  "100000dobu.com": _100000dobu_extract,
  "1000mg.jp": _1000mg_extract,
  "2ch-ero-report.blog.jp": _2ch_ero_report_blog_extract,
  "5ch-echiechi.doorblog.jp": _5ch_echiechi_doorblog_extract,
  "2chav.com": _2chav_extract,
  "bakuwaro.com": _bakuwaro_extract,
  "lucky318b.com": _lucky318b_extract,
  "hiroiro.com": _hiroiro_extract,
  "jumpsokuhou.blog.jp": _jumpsokuhou_blog_extract,
  "pokemon-goh.doorblog.jp": _pokemon_goh_doorblog_extract,
  "openworldnews.net": _openworldsnews_extract,
  "shock-tv.com": _shock_tv_extract,
  "you1news.com": _you1news_extract,
  "vippers.jp": _vippers_extract,
  "zch-vip.com": _zch_vip_extract,
  "mashlife.doorblog.jp": _mashlife_doorblog_extract,
  "moez-m.com": _moez_m_extract,
  "watch2chan.com": _watch2_chan_extract,
  "asianoneta.blog.jp": _asianoneta_blog_extract,
  "aramame.net": _aramame_extract,
  "iroironetnews.blog.jp": _iroironetnews_blog_extract,
  "usi32.com": _usi32_extract,
  "hheaven.jp": _hheaven_extract,
  "hnalady.com": _hnalady_extract,
  "suitjoshi.com": _suitjoshi_extract,
  "hdouga.com": _hdouga_extract,
  "oumaga-times.com": _oumaga_times_extract,
  "oshirigazo.com": _oshirigazo_extract,
  "onihimechan.com": _onihimechan_extract,
  "crx7601.com": _crx7601_extract,
  "bakufu.jp": _bakufu_extract,
  "oryouri.2chblog.jp": _oryouri_2chblog_extract,
  "otonarisoku.com": _otonarisoku_extract,
  "ganmodoki.net": _ganmodoki_extract,
  "girlsreport.net": _girlsreport_extract,
  "ge-sewa-news.blog.jp": _ge_sewa_news_extract,
  "jpsoku.blog.jp": _jpsoku_blog_extract,
  "tyoieronews.blog.jp": _typieronews_blog_extract,
  "twintailsokuhou.blog.jp": _twintailsokuhou_blog_extract,
  "drdinl.com": _drdinl_extract,
  "news.tokimeki-s.com": _tokimeki_s_extract,
  "nanj-push.blog.jp": _nanj_push_blog_extract,
  "inutomo11.com": _inutomo11_extract,
  "nandemo-uketori.com": _nandemo_uketori_extract,
  "notesoku.com": _notesoku_extract,
  "blog.esuteru.com": _blog_eseteru_extract,
  "pioncoo.net": _pioncoo_extract,
  "burusoku-vip.com": _burusoku_vip_extract,
  "matomecup.com": _matome_cup_extract,
  "matomeblade.com": _matomeblade_extract,
  "2ch-matomenews.com": _2ch_matomenews_extract,
  "maruhorror.com": _maruhorror_extract,
  "manpukunews.blog.jp": _manpukunews_blog_extract,
  "michaelsan.livedoor.biz": _michaelsan_livedoor_biz_extract,
  "yurugame.doorblog.jp": _yurugame_doorblog_extract,
  "idle-girl.com": _idle_girl_extract,
  "ginjimasu.blog.jp": _ginjimasu_blog_extract,
  "aqua2ch.net": _aqua2ch_blog_extract,
  "adultgeek.net": _adultgeek_extract,
  "anacap.doorblog.jp": _anacap_doorblog_extract,
  "anihatsu.com": _anihatsu_extract,
  "ichinuke.com": _ichinuke_extract,
  "elephant.2chblog.jp": _elephant_2chblog_extract,
  "facebook-neta.com": _facebook_neta_extract,
  "ertk.net": _ertk_extract,
  "eronetagazou.com": _eronetagazou_extract,
  "flashff.blog.jp": _flashff_blog_extract,
  "eromazofu.com": _eromazofu_extract,
  "erologz.com": _erologz_extract,
  "ero-shame.club": _ero_shame_club_extract,
  "erogazoo.net": _erogazoo_extract,
  "erogazoo555.com": _erogazo555_extract,
  "eromitai.com": _eromitai_extract,
  "okazurand.net": _okazurand_extract,
  "otakomu.jp": _otakomu_extract,
  "jin115.com": _jin115_extract,
  "scienceplus2ch.com": _scienceplus2ch_extract,
  "gahalog.2chblog.jp": _gahalog_2chblog_extract,
  "kimootoko.net": _kimootoko_extract,
  "kyarabetsunijiero.net": _kyarabetsunijiero_extract,
  "konoyubitomare.jp": _konoyubitomare_extract,
  "news.2chblog.jp": _news_2chblog_extract,
  "1000giribest.com": _1000giribest_extract,
  "news30over.com": _news30over_extract,
  "negisoku.com": _negisoku_extract,
  "netizen-voice.blog.jp": _netizen_voice_blog_extract,
  "po-kaki-to.com": _po_kaki_to_extract,
  "mesu-jiru.com": _mesu_jiru_extract,
  "www.jikenjiko-hukabori.com": _jikenjiko_hukabori,
  "rabitsokuhou.2chblog.jp": _rabitsokuhou_2chblog_extract,
  "warotanikki.com": _warotanikki_extract,
  "adaman-ero.com": _adaman_ero_extract,
  "moeimg.net": _moeimg_extract,
  "hattatu-matome.ldblog.jp": _hattatu_matome_ldblog_extract,
  "kokunanmonomousu.com": _kokunanmonomousu_extract,
  "vipsister23.com": _vipsister23_extract,
  "erogazoumura.com": _erogazoumura_extract,
  "tabinalog.com": _tabinalog_extract,
  "gfoodd.com": _gfoodd_extract,
  "himasoku.com": _himasoku_extract,
  "bakutan.blog.jp": _bakutan_blog_extract,
  "tozanchannel.blog.jp": _tozanchannel_blog_extract,
  "inazumanews2.com": _inazumanews2_extract,
  "yaruo.info": _yaruo_extract,
  "tintinbravo.com": _tintinbravo_extract,
  "xn--r8jwklh769h2mc880dk1o431a.com": _xn__r8jwklh769h2mc880dk1o431a_extract,
  "news4vip.livedoor.biz": _news4vip_livedoor_extract,
  "alfalfalfa.com": _alfalfalfa_extract,
  "itainews.com": _itainews_extract,
  "hamusoku.com": _hamusoku_extract,
  "minkch.com": _minkch_extract,
  "itaishinja.com": _itaishinja_extract,
  "erocon.gger.jp": _erocon_extract,
  "newsoku.blog": _newsoku_extract,
  "toushichannel.net": _toushichannel_extract,
  "gadget2ch.com": _gadeget2ch_extract,
  "vipnews.jp": _vipnews_extract,
  "jisaka.com": _jisaka_extract,
  "m4ex.com": _m4ex_extract,
  "nwknews.jp": _nwknews_extract,
  "gosunkugi.com": _gosunkugi_extract,
  "outdoormatome.com": _outdoormatome_extract,
  "bipblog.com": _bipblog_extract,
  "ge-soku.com": _ge_soku_extract,
  "jiwasoku.com": _jiwasoku_extract,

  "blog.livedoor.jp/goodloser": __goodloser_extract,
  "blog.livedoor.jp/kinisoku": __kinisoku_extract,
  "blog.livedoor.jp/wakusoku": __wakusoku_extract,
  "blog.livedoor.jp/aoba_f": __aoba_f_extract,
  "blog.livedoor.jp/pururungazou": __purururungazou_extract,
  "blog.livedoor.jp/nanjstu": __nanjstu_extract,
  "blog.livedoor.jp/diet2channel": __diet2channel_extract,
  "blog.livedoor.jp/a_load": __a_load_extract,
  "blog.livedoor.jp/rbkyn844": __rbkyn844_extract,
  "blog.livedoor.jp/news23vip": __news23vip_extract,
  "blog.livedoor.jp/bluejay01-review": __bluejay01_review_extract,
  "blog.livedoor.jp/itsoku": __itsoku_extract,
  "blog.livedoor.jp/isaacalwin1219": __isaacalwin1219_extract,
  "blog.livedoor.jp/misopan_news": __misopan_news_extract,
};

// ani-chat.net
function _ani_chat_extract(body: string) {
  return baseExtract(body, {
    sanitizedAddTags: [],
    mainSelectorTag: "article",
    removeSelectorTags: [
      "div.widget",
      "picture",
      "div.toc",
      "div.idname2",
      "aside",
      "div.toc",
      '[href*="dmm"]',
      '[class*="meta"]',
    ],
    transVisibleImage: "a",
  });
}

// korewaeroi.com
function _korewaeroi_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "section.content",
    removeSelectorTags: ["div.yarpp"],
  });
}

// 1000dobu.com
function _100000dobu_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "section.content",
    removeSelectorTags: ["div.wp-rss-template-container"],
    sanitizedAddTags: ["iframe"],
  });
}

// 1000mg.jp
function _1000mg_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-outer-3",
    removeSelectorTags: [
      "div.index_toolbox",
      'div[class*="smnrela"]',
      "h3.h2",
      "div.article-tags",
      "div.single_bottom",
      'div[id="article-options"]',
      "div.navigation",
      'div[style="margin-bottom:8px;"]',
      "div.wp-rss-template-container",
    ],
    sanitizedAddTags: ["iframe", "script"],
  });
}
// 2ch-ero-report-blog.jp
function _2ch_ero_report_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "[class^=ninja]",
      "[class^=ldblog]",
      "[style^=display]",
      '[href*="ac.ms-track.info"]',
    ],
    sanitizedAddTags: ["iframe"],
    reducebr: 3,
  });
}

// 5ch-echiechi.doorblog.jp
function _5ch_echiechi_doorblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.kijinakakoteeei",
      "div.entry-wrap",
      "h3.midasih3",
      'div[class*="ninja"]',
      'div[id*="ldblog_related"]',
      "dl.article-tags",
      "div[id=pickup]",
      "div.dmmmm",
      "div.ssnnss",
    ],
    sanitizedAddTags: ["iframe"],
    reducebr: 3,
  });
}

// 2chav.com
function _2chav_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.ently_body",
    removeSelectorTags: [
      "div.kijinakakoteeei",
      "div.entry-wrap",
      "h3.midasih3",
      "div[id=pickup]",
      "div.dmmmm",
      "div.ssnnss",
      "br",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// bakuwaro.com
function _bakuwaro_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "div.wp_social_bookmarking_light",
      "br",
      "footer",
      "[class*=widget]",
      "div.im_w_wrap",
      "p",
    ],
    imgDataSrcToImgSrc: "data-src",
  });
}

// lucky318b.com
function _lucky318b_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content > table",
    removeSelectorTags: [
      "div[id=article-over]",
      "div.wp-rss-template-container",
      "br",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}
// hiroiro.com
function _hiroiro_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    sanitizedAddTags: ["iframe", "script"],
  });
}

// jumpsokuhou.blog.jp
function _jumpsokuhou_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div[class*=ad]",
      "div[id^=blz_rss]",
      "div.article-body-more > blockquote",
      "br",
      "span",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// pokemon-goh.doorblog.jp
function _pokemon_goh_doorblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: ["dl.article-tags", "br"],
    sanitizedAddTags: ["iframe"],
  });
}

// openworldnews.net
function _openworldsnews_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "article[id=entryarea]",
    removeSelectorTags: [
      "table.abox",
      "ul[id=shareBtns]",
      "p[id=taxsonomy]",
      "div.amazon",
    ],
    sanitizedAddTags: ["iframe", "script"],
    removeEmptyTag: "p",
  });
}

// www.shock-tv.com
function _shock_tv_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    sanitizedAddTags: ["iframe", "script"],
    iframeSrcToWithSuffixInItemFix: true,
  });
}

// you1news.com
function _you1news_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body",
    removeSelectorTags: ["ins.adsbygoogle", "br"],
    sanitizedAddTags: ["iframe", "script"],
  });
}

// vippers.jp
function _vippers_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.articleBody",
    removeSelectorTags: [
      "div[id^=ad]",
      "div[class^=include]",
      "div.clearfix",
      "br",
    ],
  });
}

// zch-vip.com
function _zch_vip_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body",
    removeSelectorTags: [
      "div[id*=ad]",
      "div[class^=include]",
      "div[id^=ldblog_related]",
      "div.clearfix",
      "div.smf",
      "ul.article_bottom",
      "br",
    ],
    sanitizedAddTags: ["iframe"],
    removeEmptyTag: "div",
  });
}

// mashlife.doorblog.jp
function _mashlife_doorblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "[id*=ad]",
      "[class*=ad]",
      "[summary*=ad]",
      "div[class^=include]",
      "div[id^=ldblog_related]",
      "div.ninja-recommend-block",
      "div.clearfix",
      "div.koteigazo2",
      "ul.article_bottom",
      "div[class^=blogroll-wrapper]",
      "section[id=comments]",
      "[href*=ldapp_notifier]",
      "[class*=button]",
      "div.c_img",
      'a[href*="2ch-c.net"]',
      "div.ninja-recommend-block",
      'div[class*="koteigazo"]',
      "b",
      '[href*="2ch-c.net"]',
      '[href*="feedly.com"]',
      "[class*='amazon']",
      'span[style*="font-size: medium;"]',
    ],
    sanitizedAddTags: [],
    reducebr: 3,
  });
}

// moez-m.com
function _moez_m_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: ($) => {
      return $("h6")
        .filter((_, el) => $(el).text().trim() === "今日の更新画像")
        .next("p");
    },
    transVisibleImage: "a",
    sanitizedAddTags: [],
  });
}

// www.watch2.chan.com
function _watch2_chan_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    sanitizedAddTags: [],
  });
}

// asianoneta.blog.jp
function _asianoneta_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry_articles_main",
    removeSelectorTags: [
      "div.headline_outline",
      'div[id*="blz_rss"]',
      'div[class*="ninja"]',
      'div[class*="ad"]',
      "div.article-option",
      "div.comment_title",
      "div.comment_send",
      "div.top_menu_title",
      "div.article_title_bar",
      "div.entry_articles",
      "div.clearfix",
      "div.smf",
      "ul.article_bottom",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// aramame.net
function _aramame_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "article.article-large",
    removeSelectorTags: [
      "div.article-body-before",
      'aside.article-body-middle div[class*="rss"]',
      'div[class*="kes"]',
      "aside.article-body-middle",
      "div.article-cat-list",
      "section",
      "s-wrapper-single",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// iroironetnews.blog.jp
function _iroironetnews_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    sanitizedAddTags: [],
  });
}

// usi32.com
function _usi32_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[class*="ad"]',
      'div[class*="amazon"]',
      'div[id^="blz_rss"]',
      "div.article-body-more > blockquote",
      "span",
    ],
    reducebr: 3,
  });
}

// hheaven.jp
function _hheaven_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "div[class*=ad]",
      "div[id^=blz_rss]",
      "div[id*=custom_html]",
      "div.article-body-more > blockquote",
      "br",
      "span",
    ],
    sanitizedAddTags: [],
  });
}

// hnalady.com
function _hnalady_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: ($) => {
      return $("div.entry_body").add($("div[id=more]"));
    },
    removeSelectorTags: [
      "div.wakupr",
      "h4.mine-title",
      "div.relation_entry",
      "h3.entry-bottom",
    ],
    sanitizedAddTags: [],
  });
}

// suitjoshi.com
function _suitjoshi_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body",
    removeSelectorTags: ["div[class*=button]"],
    sanitizedAddTags: [],
  });
}

// www.hdouga.com
function _hdouga_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.post_content",
    removeSelectorTags: ['div[class*="yarpp"]', "div.flex_box"],
    sanitizedAddTags: [],
  });
}

// www.oumaga-times.com
function _oumaga_times_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: ['div[class*="ad"]', 'div[id^="blz_rss"]'],
    sanitizedAddTags: [],
  });
}

// oshirigazo.com
function _oshirigazo_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: ($) => {
      return $("div.entry-content").add($("div.eye-catch-wrap"));
    },
    removeSelectorTags: ['div[class*="ad"]', 'div[id^="blz_rss"]'],
    sanitizedAddTags: [],
  });
}

// onihimechan.com
function _onihimechan_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div[class*=ad]",
      "div[id^=blz_rss]",
      "div.foot_con",
      "div[id^=ldblog]",
      "dl.article-tags",
    ],
    sanitizedAddTags: [],
  });
}

// crx7601.com sankaku
function _crx7601_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: ($) => {
      return $("div.article-body-inner").add($("div.article-body-more"));
    },
    removeSelectorTags: [
      "div[class*=ad]",
      "div[id^=blz_rss]",
      "div.foot_con",
      "div[id^=ldblog]",
      "dl.article-tags",
      "div[class*=box]",
      "[class*=ninja]",
      "ul.pr1",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// bakufu.jp
function _bakufu_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id^=blz_rss]",
      "p",
      "div.foot_con",
      "div[id^=ldblog]",
      "dl.article-tags",
      "div[class*=box]",
      "[class*=ninja]",
      "ul.pr1",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// oryouri.2chblog.jp
function _oryouri_2chblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id^=blz_rss]",
      "p.contents_rss_text",
      "div.contents_rss",
      "div.amazon",
      "style",
      "div[id^=ldblog]",
      "dl.article-tags",
      "div[class*=box]",
      "[class*=ninja]",
      "ul.pr1",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// www.otonarisoku.com
function _otonarisoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id^=blz_rss]",
      "p.contents_rss_text",
      "div.contents_rss",
      "div.amazon",
      "style",
      "div[id^=ldblog]",
      "dl.article-tags",
      "div[class*=box]",
      "[class*=ninja]",
      "ul.pr1",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// ganmodoki.net
function _ganmodoki_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ["table", "ul.comments-link", "div[class*=ad]"],
    sanitizedAddTags: ["iframe"],
  });
}

// girlsreport.net
function _girlsreport_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id*=ad]",
      "div.top_link",
      "dl.article-tags",
      "div.relation-title",
      "div.article-over",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// ge-sewa-news.blog.jp
function _ge_sewa_news_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "div.top_link",
      "dl.article-tags",
      "div.relation-title",
      "div.article-over",
      "br",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// jpsoku.blog.jp
function _jpsoku_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "div.widgets",
      "[id*=widget]",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "br",
    ],
    removeEmptyTag: "div",
    sanitizedAddTags: ["iframe"],
  });
}

// tyoieronews.blog.jp
function _typieronews_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "blockquote",
    ],
    reducebr: 3,
    sanitizedAddTags: ["iframe"],
  });
}

// twintailsokuhou.blog.jp
function _twintailsokuhou_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "table",
      "ul.comments-link",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "p",
    ],
    transVisibleImage: "a",
  });
}

// drdinl.com
function _drdinl_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "section.content",
    removeSelectorTags: [
      "div.osusume_text",
      "div[id*=custom_html]",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "br",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// news.tokimeki-s.com
function _tokimeki_s_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "section.content",
    removeSelectorTags: [
      "div.osusume_text",
      "div[id*=custom_html]",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "br",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// nanj-push.blog.jp
function _nanj_push_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.amazon",
      "div[id*=custom_html]",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "br",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// inutomo11.com
function _inutomo11_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.amazon",
      "div[id*=custom_html]",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "br",
      "b",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// blog.livedoor.jp/nanjstu/
function __nanjstu_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.amazon",
      "div[id*=custom_html]",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "br",
      "b",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// www.nandemo-uketori.com
function _nandemo_uketori_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.amazon",
      "div[id*=custom_html]",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "b",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// notesoku.com
function _notesoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "div.amazon",
      "div[id*=custom_html]",
      "div[class*=ad]",
      "div[id*=ad]",
      "div[id*=ldblog_related]",
      "div[class*=related]",
      "div[class*=ninja]",
      "li2",
      "blockquote",
      "[class*=widget]",
      "[class*=wrap]",
      "div.relation-title",
      "div.article-over",
      "b",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
    reducebr: 3,
  });
}

// blog.esuteru.com
function _blog_eseteru_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-more",
    removeSelectorTags: ["div.amzlet-box", "p"],
    sanitizedAddTags: ["iframe"],
    reducebr: 3,
  });
}

// pioncoo.net
function _pioncoo_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "div.amazlet-box",
      "div[class*=sample]",
      "div.widgets",
      "p",
    ],
    sanitizedAddTags: ["iframe"],
    reducebr: 3,
  });
}

// burusoku-vip.com
function _burusoku_vip_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "div[id*=ad]",
      "div[class*=include]",
      "div.widgets",
      "p",
    ],
    // sanitizedAddTags: ["iframe", "script"],
    transVisibleImage: "a",
    reducebr: 3,
    imgurToImg: true,
    twitterEmbed: true,
  });
}

// blog.livedoor.jp/pururungazou
function __purururungazou_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: ["div[id*=ad]", "div[class*=include]", "div.widgets"],
    sanitizedAddTags: ["iframe"],
  });
}

// matomecup.com
function _matome_cup_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.ently_text",
    removeSelectorTags: [
      "div[id*=ad]",
      "div[class*=include]",
      "p[class*=pickup]",
      "table",
      "dl.relate_dl",
      "[class*=ninja]",
      "[class*=menuTab]",
      "div.widgets",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// matomeblade.com
function _matomeblade_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div[id*=ad]",
      "table",
      "dl.relate_dl",
      "[class*=include]",
      "ninja",
      "menuTab",
      "pickup",
      "div.widgets",
    ],
    sanitizedAddTags: ["iframe"],
    reducebr: 3,
  });
}

// 2ch-matomenews.com
function _2ch_matomenews_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "div[id*=ad]",
      "div[class=include]",
      "p[class*=pickup]",
      "div.inyou",
      "div.link-card",
      "div.slides",
      "div.blog-card",
      "div.linkcard",
      "dl.relate_dl",
      "[class*=ninja]",
      "[class*=menuTab]",
      "div.widgets",
      'a[href*="al.dmm.co.jp"]',
      "h2",
      "ins",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// www.maruhorror.com
function _maruhorror_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div[id*=ad]",
      "div[class=include]",
      "p[class*=pickup]",
      "div[class*=amz]",
      "p.maru",
      "[style*=text-align]",
      "div.link-card",
      "div.slides",
      "div.blog-card",
      "div.linkcard",
      "dl.relate_dl",
      "[class*=ninja]",
      "[class*=menuTab]",
      "div.widgets",
      'a[href*="al.dmm.co.jp"]',
      "h2",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// manpukunews.blog.jp
function _manpukunews_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: ($) => {
      return $("div.article-body-inner");
    },
    removeSelectorTags: [
      "div[id*=ad]",
      "div[class*=include]",
      "p[class*=pickup]",
      "div[class*=amz]",
      "p.maru",
      "[style*=text-align]",
      "div.link-card",
      "div.slides",
      "div.blog-card",
      "div.linkcard",
      "dl.relate_dl",
      "[class*=ninja]",
      "[class*=menuTab]",
      "div.widgets",
      "dl.article-tags",
    ],
    sanitizedAddTags: ["iframe"],
    imgurToImg: true,
  });
}

// blog.livedoor.jp/aoba_f
function __aoba_f_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div[id*='ad']",
      "div[class*='include']",
      "p[class*='pickup']",
      "div[class*='amz']",
      "p.maru",
      "[style*='text-align']",
      "div.link-card",
      "div.slides",
      "div.blog-card",
      "div.linkcard",
      "dl.relate_dl",
      "[class*='ninja']",
      "[class*='menuTab']",
      "div.widgets",
      "div.article-tags",
      'a[href*="al.dmm.co.jp"]',
      "h2",
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// michaelsan.livedoor.biz
function _michaelsan_livedoor_biz_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: ($) => {
      return $("div.blogbody > div.main");
    },
    removeSelectorTags: [
      "div.posted",
      'div[id*="ad"]',
      "div.comments-head",
      "ol",
      "table",
      "div.pagetop",
      'a[href*="amazon"]',
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// yurugame.doorblog.jp
function _yurugame_doorblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body",
    removeSelectorTags: ['div[id*="ad"]', 'div[class*="amazon"]'],
    sanitizedAddTags: ["iframe"],
  });
}

// blog.livedoor.jp/wakusoku
function __wakusoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    sanitizedAddTags: ["iframe"],
  });
}

// idle-girl.com
function _idle_girl_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.post > div.clearfix",
    removeSelectorTags: ["div.widget_custom_html", "div.textwidget", "aside"],
  });
}

// ginjimasu.blog.jp
function _ginjimasu_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: ['div[class*="rss-blog"]'],
  });
}

// adultgeek.net
function _adultgeek_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ["div.rss", "div.quote"],
    sanitizedAddTags: ["iframe", "script"],
  });
}

// anacap.doorblog.jp
function _anacap_doorblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body",
    removeSelectorTags: [
      'div[class*="anacap-roll"]',
      'div[id*="ldblog_related"]',
      "dl.article-tags",
      "center",
    ],
    sanitizedAddTags: [],
  });
}

// anihatsu.com
function _anihatsu_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[id*="ad"]',
      "div.pickup-link",
      'div[style*="padding: 10px 5px; margin-bottom: 10px; border: 2px solid #00BFFF;"]',
      "center",
      "blockquote",
    ],
    sanitizedAddTags: [],
  });
}

// ichinuke.com -> can get all images from feed
function _ichinuke_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "figure.wp-block-gallery",
    sanitizedAddTags: [],
    imgDataSrcToImgSrc: "data-src",
  });
}

// elephant.2chblog.jp
function _elephant_2chblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: 'div[id="main"] > div.article',
    removeSelectorTags: [
      'div[align="right"]',
      'div[id*="ad"]',
      'div[class*="yms"]',
      'div[id*="ldblog_related"]',
      "div.tab_area",
      'ul[id*="rdmJump"]',
      "div.article-option",
      "div.comment_form",
      'a[name="comments"]',
      "ul.clearfix",
      'div[style*="margin:10px 0px 40px 340px;"]',
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// facebook-neta.com
function _facebook_neta_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ['p[style*="text-align:right"]'],
    sanitizedAddTags: ["iframe", "script"],
    removeAffiID: true,
  });
}

// ertk.net
function _ertk_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: 'div[id="post-after"]',
    sanitizedAddTags: ["iframe", "script"],
    removeAffiID: true,
    toFullURL: "https://ertk.net/",
  });
}

// eronetagazou.com -> can get all images from feed
function _eronetagazou_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.column-right > div.ppp",
    transVisibleImage: "p > a",
  });
}

// flashff.blog.jp
function _flashff_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
  });
}

// eromazofu.com -> can get all images from feed
function _eromazofu_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: 'div[id="main_contents"] > div.econtent-none-i',
    removeSelectorTags: [
      "div.yarpp",
      'a[rel="noopener"]',
      "common_contents",
    ],
    simplifyVideoElement: "div.wp-video",
  });
}

function _erologz_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      'div[class*="ad"]',
      'div[class*="banner"]',
      "div.flpc",
    ],
    iframeSrcToWithSuffixInItemFix: true,
  });
}

// ero-shame.club
function _ero_shame_club_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ["div.mon", 'div[id*="kizi"]', "div.bbsarea"],
    sanitizedAddTags: [],
  });
}

// erogazoo.net
function _erogazoo_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.post",
    removeSelectorTags: [
      "div.mon",
      'div[id*="kizi"]',
      "div.bbsarea",
      "div.pcstay",
      "div.pcad",
      "div.spad",
      'div[id*="kanren"]',
      'div[id*="area"]',
      "div.sns",
      "div.blog_info",
      "div.clearfix",
      'div[id*="comments"]',
    ],
  });
}

// erogazoo555.com -> can get all img from feed
function _erogazo555_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "article > div.entry-content",
    removeSelectorTags: [
      "div.bbsarea",
    ],
    sanitizedAddTags: [],
  });
}

// eromitai.com
function _eromitai_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ['a[rel*="sponsor"]'],
  });
}

// okazurand.net
function _okazurand_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "section.product-detail-content",
    removeSelectorTags: ["div.pickup-post-widget"],
    simplifyVideoElement: "div.wp-block-video-js",
  });
}

// otakomu.jp
function _otakomu_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-more",
    removeSelectorTags: ["div.amazlet-box", "center"],
  });
}

// jin115.com
function _jin115_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article_bodymore",
    removeSelectorTags: ["table"],
  });
}

// scienceplus2ch.com
function _scienceplus2ch_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.Article__content",
    removeSelectorTags: ['div[id*="ad"]', 'div[id*="article_id"]'],
  });
}

// gahalog.2chblog.jp
function _gahalog_2chblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
  });
}

// blog.livedoor/kinisoku/
function __kinisoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article_body",
    removeSelectorTags: [
      'div[id*="ad"]',
      "ul.clearfix",
      "p.all_article",
      'div[align*="right"]',
      "blockquote",
    ],
    sanitizedAddTags: [],
    fixBase64Img: true,
  });
}

// kimootoko.net
function _kimootoko_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.post_content",
    removeSelectorTags: [
      "hr.bigkugirisen",
      "hr.kugirisen",
      "div.widget_text",
      "div.syousai",
      "div.fanzakiji-hako",
      "div.pickup",
    ],
    sanitizedAddTags: [],
    imgDataSrcToImgSrc: "data-lazy-src",
  });
}

// kyarabetsunijiero.net
async function _kyarabetsunijiero_extract(body: string) {
  const $ = load(body);
  const articleUrl = $('head > link[rel="canonical"]').attr("href") ?? "";
  const pageString = $("div.pager > div.total").text().trim();
  const totalPages = pageString.match(/\/\s*(\d+)ページ/)
    ? Number.parseInt(pageString.match(/\/\s*(\d+)ページ/)![1], 10)
    : 1;

  // console.log(`totalPages => ${totalPages}`);

  const htmls: string[] = [];
  for (let page = 1; page <= totalPages; page++) {
    const url = page === 1 ? articleUrl : `${articleUrl}?pg=${page}`;
    let extractedHTML = "";
    let rawBody = "";
    if (page === 1) {
      rawBody = body;
    } else {
      rawBody = await getHtmlText(url);
    }
    extractedHTML = baseExtract(rawBody, {
      mainSelectorTag: "div.entry-content",
      removeSelectorTags: ["div.pager"],
      sanitizedAddTags: [],
      transVisibleImage: "figure > a",
    });
    htmls.push(extractedHTML);
  }
  return `<main>\n${htmls.join("\n")}\n</main>`;
}

// blog.livedoor.jp/goodloser
function __goodloser_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    imgurToImg: true,
  });
}

// konoyubitomare.jp
function _konoyubitomare_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[style*="margin-bottom:55px;"]',
      'div[class*="amazon"]',
      'div[class*="sp_show"]',
    ],
  });
}

// news.2chblog.jp
function _news_2chblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[id*="ad"]',
      "div.kjs",
      "table",
      'div[class*="ama"]',
    ],
  });
}

// 1000giribest.com
function _1000giribest_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ['div[class*="box"]'],
  });
}

// blog.livedoor.jp/diet2channel
function __diet2channel_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[align="left"]',
      'div[class*="ad"]',
      'div[id*="ldblog_related"]',
    ],
    sanitizedAddTags: [],
    imgurToImg: true,
  });
}

// www.news30over.com
function _news30over_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.mainmore",
    removeSelectorTags: [
      "div[id=fb-box]",
      'div[class*="sns"]',
      "div.ad-rectangles_single",
    ],
    imgurToImg: true,
    removeTagStr: "script",
  });
}

// www.negisoku.com
function _negisoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.c_img",
      'div[id*="ldblog_related"]',
      'span[style*="font-size: 18px; line-height: 27px;"]',
      "center",
      'div[style*="margin:0px;padding:2px;"]',
    ],
    imgurToImg: true,
    removeTagStr: "script",
  });
}

// netizen-voice.blog.jp
function _netizen_voice_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "ins",
      "div.c_img",
      'dl[class*="article-tags"]',
      'div[class*="ninja-recommend-block"]',
    ],
    sanitizedAddTags: [],
  });
}

// po-kaki-to.com
function _po_kaki_to_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "h3",
      "div.pc-contents-center",
      'div[style*="float:left; width: 280px;"]',
      'div[style*="clear: both;"]',
      "div.pc-none",
      "div.nnnnn cf",
      "center",
      "div.entry-footer",
    ],
  });
}

// mesu-jiru.com
function _mesu_jiru_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "figure.wp-block-gallery",
  });
}

// www.jikenjiko-hukabori.com
function _jikenjiko_hukabori(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
  });
}

// rabitsokuhou.2chblog.jp
function _rabitsokuhou_2chblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entrybody",
    removeSelectorTags: [
      "dd",
      'div[style="text-align: left; margin: 0 10px 10px 10px; width:300px;"]',
      "span.related",
      'div[id*="ad"]',
    ],
    sanitizedAddTags: ["iframe"],
  });
}

// warotanikki.com
function _warotanikki_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.content",
    removeSelectorTags: ["div.img-grid"],
  });
}

// adaman-ero.com
function _adaman_ero_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      "div.arpw-random-post",
      "div.banner",
      "div.jp-relatedposts",
    ],
  });
}

// moeimg.net
function _moeimg_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.post-single",
    removeSelectorTags: [
      'div[class*="ad"]',
      'div[class*="pc"]',
      "div.entryblock",
      "div.navigation",
      'div[id*="ad"]',
      "div.box_title",
      "div.entry-footer",
      "div.center",
      "ol.commentlist",
      'div[id="respond"]',
    ],
  });
}

// hattatu-matome
function _hattatu_matome_ldblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "ins",
      "div.rss-husen",
      "div.article_mid_v2",
      'div[id*="ad"]',
    ],
  });
}

// nwknews.jp
function _nwknews_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.kijinakakoukoku",
      "dl.article-tags",
      'div[id*="ad"]',
      'a[href*="https://amzn.to"]',
      "img.pict",
    ],
  });
}

// www.kokunanmonomousu.com
function _kokunanmonomousu_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article__content",
    removeSelectorTags: ["div.ninja-recommend-block"],
  });
}

// blog.livedoor.jp/a_load
function __a_load_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: ['div[id*="rss"]', 'div[id*="id"]'],
  });
}

// vipsister23.com
function _vipsister23_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-body",
    removeSelectorTags: [
      "div.clearfix",
      "div.center",
      'span[class*="imob_infeed"]',
      "blockquote",
      'div[id*="div_fam"]',
      'div[align="center"]',
    ],
  });
}

// erogazoumura.com
function _erogazoumura_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.ently_text",
    removeSelectorTags: [
      "div.fc2_footer",
      'dl[class*="relate_dl"]',
      'div[align="right"]',
      'a[href*="erogazoumura"]',
      "div.saiup_dougax",
    ],
    transVisibleImage: "a",
    sanitizedAddTags: [],
    removeString: "<center><\\/center><br\\/?\>",
    reducebr: 3,
  });
}

// tabinalog.com
function _tabinalog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ["div.amazon-item-box"],
  });
}

// gfoodd.com
function _gfoodd_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: ["div.code-block", 'div[class*="blogcard"]'],
    sanitizedAddTags: ["iframe", "script"],
    imgurToImg: true,
    transVisibleImage: "a",
  });
}

// blog.livedoor.jp/rbkyn844
function __rbkyn844_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-more",
    removeSelectorTags: [
      'div[class*="amazon"]',
      'div[class*="link"]',
      'div[class*="no-pc"]',
      "div.c_img",
      "h3",
    ],
    transVisibleImage: "a",
    sanitizedAddTags: [],
  });
}

//himasoku.com
function _himasoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[id*="ad"]',
      'span[style="color: #CC0033; font-weight: bold; font-size: 25px;"]',
      "div.netabare",
      "div.akares",
      'div[style="color: #CC0033; font-weight: bold; font-size: 16px; background-color: #e6e6fa;"]',
    ],
    twitterEmbed: true,
    imgurToImg: true,
  });
}

// bakutan.blog.jp
function _bakutan_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[id*="rss"]',
      'div[align="center"]',
      "script.jp1-ad",
    ],
  });
}

// tozanchannel.blog.jp
function _tozanchannel_blog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[style*="font-size: 120%; padding-left:10px; padding-right:10px; width:auto;"]',
      'div[style*="display: inline-block; background: #20b2aa; padding: 3px 10px; color: #ffffff;"]',
      'div[style*="padding: 10px; border: 2px solid #20b2aa;"]',
    ],
  });
}

// inazumanews2.com
function _inazumanews2_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: 'div.article-body-inner > div[id*="resid"]',
  });
}

// yaruo.info
function _yaruo_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "section.entry-content",
    transVisibleImage: "a",
  });
}

// tintinbravo.com
function _tintinbravo_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "article.l-mainContent__inner > div.post_content",
    removeSelectorTags: [
      "figure.wp-block-table",
      "div.is-content-justification-center",
      'p[style="text-align:right;"]',
    ],
    sanitizedAddTags: ["iframe", "script"],
    transVisibleImage: "figure > a",
    imgDataSrcToImgSrc: "data-src",
    removeAffiID: true,
  });
}

// xn--r8jwklh769h2mc880dk1o431a.com
function _xn__r8jwklh769h2mc880dk1o431a_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.post_content",
    removeSelectorTags: [
      "div.kankiji",
      "div.c-balloon",
      'div[style="float: none; margin:0px;"]',
      "p.entry-recommended",
      "div.swell-block-button",
    ],
    transVisibleImage: "p > a",
  });
}

// news4vip.livedoor.biz
function _news4vip_livedoor_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.ently_body",
    removeSelectorTags: [
      "dul.blogroll-list-wrap",
      'div[id*="f984a"]',
      'div[id*="ad"]',
      'div[class*="ad"]',
      'div[id*="ldblog_related"]',
      "div.ently_navi-info",
      "div.article-footer",
      "div.menu",
      'a[name="comments"]',
      "div.sub",
      "center",
      'div[id*="comment"]',
    ],
    sanitizedAddTags: [],
  });
}

// alfalfalfa.com
function _alfalfalfa_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.main_article_contents_inner",
    removeSelectorTags: [
      'div[id*="ad"]. div[class*="ad"]',
      "div.clearfix",
      "ul.automatic-related",
      "div.social-list",
      "ul.manual-related",
      "div.catch",
      "aside",
    ],
    sanitizedAddTags: [],
    reducebr: 3,
  });
}

// itainews.com
function _itainews_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.blogbody",
    removeSelectorTags: [
      'div[id*="ad"]',
      "div.menu",
      "div.posted",
      "div.poweredAdsBy",
      "span.aa",
      "div.amazon",
    ],
    sanitizedAddTags: [],
  });
}

// news23vip
function __news23vip_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'a[href*="http://blog.livedoor.jp/news23vip/"]',
      "div.amazon",
      'div[class*="ad"]',
      'div[id*="ad"]',
    ],
    sanitizedAddTags: [],
    reducebr: 3,
  });
}

// hamusoku.com
function _hamusoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.popularArticlesWithImage",
      "div.yms-user-ad",
      "strong:last-of-type",
      'a[href*="amzn"]',
      'img[src*="amzn"]',
      'div[id*="ad"]',
      "span:last-of-type",
    ],
    sanitizedAddTags: [],
    reducebr: 3,
  });
}

// minkch.com
function _minkch_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "article.clearfix > div.clearfix",
    toFullURL: "https://",
    removeSelectorTags: [
      'div[class*="yarpp"]',
      "br.clear",
      'img[title="minkch"]',
      "p:last-of-type",
    ],
  });
}

// itaishinja.com
function _itaishinja_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article_body",
    removeSelectorTags: [
      "ul.clearfix",
      'div[id*="ad"]',
      'div[class*="ad"]',
      "div.clearfix",
      'a[href*="https://moudamepo.com"]',
      "h3",
      'div[id*="rss"]',
      'div[id*="comment"]',
      'div[id*="ldblog_related"]',
      "div:last-of-type",
    ],
    transVisibleImage: "div > a",
    reducebr: 4,
  });
}

// bluejay01-review
function __bluejay01_review_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: ["div.amaquick-box"],
    sanitizedAddTags: [],
  });
}

// erocon.gger.jp
function _erocon_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    sanitizedAddTags: [],
  });
}

// newsoku.blog
function _newsoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "article.article",
    removeSelectorTags: [
      "footer",
      "div.blogroll-channel",
      "div.blog-card-footer",
      'div[style*="border-bottom: solid 5px #9b1c38;"]',
    ],
    sanitizedAddTags: [],
  });
}

// blog.livedoor.jp/itsoku/
function __itsoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "ul.clearfix",
      'div[id*="ad"]',
      'div[class*="ad"]',
      "div.clearfix",
      'a[href*="https://moudamepo.com"]',
      "h3",
      'div[id*="rss"]',
      'div[id*="comment"]',
      'div[id*="ldblog_related"]',
      "div:last-of-type",
      "dl.article-tags",
    ],
    sanitizedAddTags: [],
  });
}

// toushichannel.net
function _toushichannel_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "div.bottom-link",
      'div[id*="ad"]',
      "dl.article-tags",
      'div[style*="margin:15px;height:280px;"]',
    ],
    sanitizedAddTags: [],
  });
}

// www.gadget2ch.com
function _gadeget2ch_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    sanitizedAddTags: [],
  });
}

// www.vipnews.jp
function _vipnews_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[class*="ad"]',
      'div[id*="ad"]',
      "div.article-body-more > div.t_h:first-of-type",
      'div[style*="text-align: center;"]',
      'p[style*="color:gray;text-align:right;"]',
    ],
    sanitizedAddTags: [],
  });
}

// www.jisaka.com
function _jisaka_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      'div[class*="ad"]',
      'div[id*="ad"]',
      "dl.article-tags",
      "div.amaquick-box",
    ],
    sanitizedAddTags: [],
  });
}

// /isaacalwin1219/
function __isaacalwin1219_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "ins",
      'a[rel*="sponsored"]',
    ],
    sanitizedAddTags: [],
  });
}

// m4ex.com
function _m4ex_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article",
    transVisibleImage: "div > a",
    removeSelectorTags: [
      "b:first-of-type",
      "p.footer-post-meta",
      "div.sns-group",
      'div[align="left"]',
      'div[style="margin-top: 4px;"]',
    ],
    sanitizedAddTags: [],
  });
}

// www.gosunkugi.com
function _gosunkugi_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    sanitizedAddTags: [],
    fixBase64Img: true,
  });
}

// outdoormatome.com
function _outdoormatome_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      "dl.article-tags",
      'div[id*="ad"]',
      'div[class*="ad"]',
    ],
    sanitizedAddTags: [],
  });
}

// bipblog.com
function _bipblog_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.main_center_body > div.main_center_body_text",
    removeSelectorTags: ['[class*="include"]'],
    sanitizedAddTags: [],
  });
}

// ge-soku.com
function _ge_soku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "section.single-post-main > div.content",
    removeSelectorTags: [
      '[class*="include"]',
      "div.yyi-rinker-contents",
    ],
    sanitizedAddTags: [],
  });
}

// jiwasoku.com
function _jiwasoku_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.entry-content",
    removeSelectorTags: [
      '[class*="include"]',
      "div.yyi-rinker-contents",
      "div.widgets",
    ],
    sanitizedAddTags: [],
  });
}

// blog.livedoor.jp/misopan_news
function __misopan_news_extract(body: string) {
  return baseExtract(body, {
    mainSelectorTag: "div.article-body-inner",
    removeSelectorTags: [
      '[class*="include"]',
      "div.yyi-rinker-contents",
      "div.widgets",
    ],
    sanitizedAddTags: [],
  });
}

export async function getContent(articleURL: string): Promise<string> {
  try {
    // const domain = new URL(articleURL).hostname.replace(/^(www|m|amp)\./, "");
    const urlObj = new URL(articleURL);
    const host = urlObj.hostname.replace(/^(www|m|amp)\./i, "");
    let key = host;
    if (host === "blog.livedoor.jp") {
      // pathname = "/pururungazou/" → ["pururungazou"]
      const segs = urlObj.pathname.split("/").filter(Boolean);
      if (segs.length > 0) {
        key = `${host}/${segs[0]}`;
      }
    }

    if (!(key in EXTRACTOR)) {
      throw new Error(`未定義ドメイン: ${key}`);
    }

    const html = await getHtmlText(articleURL);
    if (!html) throw new Error("本文の取得に失敗");

    const tidy = EXTRACTOR[key](html);
    return tidy || "";
  } catch (err) {
    // ここで握りつぶして **呼び元には空文字を返す**
    console.error(`[getContent] ${articleURL}\n  ↳ ${err}`);
    return "";
  }
}

// テスト実行
if (import.meta.main) {
  try {
    // testOne_site("https://ani-chat.net/post-296486/");
    // testOne_site("http://bipblog.com/archives/5902198.html", true);
    // testOne_site("https://ichinuke.com/garterbelt13/");
    // testOne_site("https://eronetagazou.com/post-232227/");
    // testOne_site("http://eromazofu.com/hoikusihamedori0501.html");
    // await testOne_site(
    //   "https://kyarabetsunijiero.net/archives/%E6%BF%AB%E5%9B%9E%E5%87%8C%E8%BD%A2%E3%83%8B%E3%83%92%E3%83%AD%E3%81%AE%E3%82%A8%E3%83%AD%E7%94%BB%E5%83%8F-50%E6%9E%9A%E3%80%90%E7%95%B0%E4%BF%AE%E7%BE%85%E3%80%91.html",
    // );
    // await testOne_site("https://erogazoumura.com/blog-entry-1353.html");
    // await testOne_site("https://erogazoumura.com/blog-entry-4031.html");
    // await testOne_site("http://gfoodd.com/post-267454/");
    // await testOne_site(
    //   "https://twintailsokuhou.blog.jp/archives/89644404.html",
    // );
    // await testOne_site("http://burusoku-vip.com/archives/2091841.html");
    // await testOne_site("https://manpukunews.blog.jp/44318070.html");
    // await testOne_site(
    //   "http://blog.livedoor.jp/goodloser/archives/46904283.html",
    // );
    // await testOne_site("http://himasoku.com/archives/52283633.html");
    // await testOne_site("https://tintinbravo.com/2025/04/30/sone00533/");
    // await testOne_site("https://alfalfalfa.com/articles/10833316.html");
    // await testOne_site("https://erogazoo555.com/77385.html");
    // await testOne_site("https://itainews.com/archives/2048013.html");
    // await testOne_site(
    //   "https://5ch-echiechi.doorblog.jp/archives/27592575.html",
    // );
    // await testOne_site("https://mashlife.doorblog.jp/archives/59157894.html");
    // await testOne_site("https://iroironetnews.blog.jp/archives/31953047.html");
    // await testOne_site("http://usi32.com/archives/31985401");
    // await testOne_site("https://ge-soku.com/archives/games-8059.html");
    // await testOne_site("https://jiwasoku.com/2025/05/06/post-222702/");
    // await testOne_site("https://tyoieronews.blog.jp/archives/1084533512.html");
    // await testOne_site("https://matomeblade.com/archives/90752606862.html");
    // await testOne_site("http://blog.livedoor.jp/aoba_f/archives/62335596.html");
    // await testOne_site(
    //   "https://michaelsan.livedoor.biz/archives/52057862.html",
    // );
    // await testOne_site(
    //   "http://blog.livedoor.jp/goodloser/archives/46884788.html",
    // );
    // await testOne_site(
    //   "http://blog.livedoor.jp/diet2channel/archives/62334805.html",
    // );
    // await testOne_site("http://blog.livedoor.jp/itsoku/archives/62336396.html");
    // await testOne_site(
    //   "http://blog.livedoor.jp/isaacalwin1219/archives/39823194.html",
    // );
    await testOne_site(
      "http://blog.livedoor.jp/misopan_news/archives/52338931.html",
    );
  } catch (err) {
    console.log(`[ERROR]: ${err}`);
    Deno.exit(-1);
  }
}

function testUseSupabaseDB() {
  const supabaseUrl = Deno.env.get("PROJECT_URL");
  const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("No settings PROJECT_URL and SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: sites, error } = supabase
    .from("sites")
    .select("id, url, title");
  if (error || !sites) {
    console.error("sites の取得に失敗", error);
    Deno.exit(-1);
  }
  for (const site of sites) {
    const urlObj = new URL(site.url);
    // 1) www. を剥がす
    const host = urlObj.hostname.replace(/^www\./, "");

    // 2) blog.livedoor.jp の場合は最初のパスセグメントもキーに加える
    let extractorKey = host;
    if (host === "blog.livedoor.jp") {
      // pathname = "/pururungazou/" → ["pururungazou"]
      const segs = urlObj.pathname.split("/").filter(Boolean);
      if (segs.length > 0) {
        extractorKey = `${host}/${segs[0]}`;
      }
    }

    if (!(extractorKey in EXTRACTOR)) {
      console.log(
        `Not Match hostname => ${host}, key => ${extractorKey}, url => ${site.url}`,
      );
    }
  }
}

async function testOne_site(articleURL: string, debug?: boolean) {
  try {
    const text = await getHtmlText(articleURL);
    if (text === "") {
      console.log(`Cannot get text from ${articleURL}`);
    }
    console.log(`${articleURL} text length -> ${text.length}`);
    const urlObj = new URL(articleURL);
    const host = urlObj.hostname.replace(/^wwww\./, "");
    let key = host;
    if (host === "blog.livedoor.jp") {
      // pathname = "/pururungazou/" → ["pururungazou"]
      const segs = urlObj.pathname.split("/").filter(Boolean);
      if (segs.length > 0) {
        key = `${host}/${segs[0]}`;
      }
    }

    if (debug) {
      console.log(host);
      console.log(text);
    }

    if (!(key in EXTRACTOR)) {
      throw new Error(
        `Not found pre-defined scraping table domain -> ${host}`,
      );
    }

    const extract = EXTRACTOR[key];
    const extracted = await extract(text);
    console.log(extracted);

    const content = `<!DOCTYPE html>
      <html lang="ja">
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>記事一覧ビューア</title>
      <style>
      <!– before my used style
      body { 
        margin: 0;
        padding: 0;
        width: 100vw;
        overflow-x: hidden;
        font-family: Arial, sans-serif;
        font-size: 16px;
        wrap: text-wrap;
      }
      .article { 
        margin-bottom: 10px;
        padding: 10px;
        border-top: 3px solid #aaa;
        width: 100vw;
        box-sizing: border-box;
      }
      img {
        width: 100%;
        height: auto;
        display: block;
        max-width: none;
      }
      iframe, video, embed, object {
        max-width: 100%;
        width: 100% !important;
        height: auto;
        aspect-ratio: 16 / 9;
        display: block;
      }
      .idname {
        margin-top: 20px;
        padding: 0.5rem;
        font-size: 12px;
        background: #eaf3ff;
        border-bottom: solid 3px #516ab6;
      }

      .txt {
        margin: 20px 0px 40px 5px;
        font-size: 18px;
        font-weight: bold;
      }
      –>

      *{box-sizing:border-box;margin:0;padding:0}
      body{
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
        font-size:16px;line-height:1.6;
        width:100vw;overflow-x:hidden;
        padding:8px;
      }

      .article{border-top:3px solid #aaa;margin-bottom:24px}
      img,video{
        max-width:100%;height:auto;display:block;margin:8px 0;
      }
      iframe,embed,object{
        max-width:100% !important;
        width:100% !important;
        height:auto !important;
        aspect-ratio:16/9;
        display:block;margin:8px 0;
      }
      iframe[src*="youtube"],iframe[src*="youtu.be"],
      iframe[src*="vimeo"]{
        max-width:100% !important;width:100% !important;height:auto !important;
        aspect-ratio:16/9;
      }

      table{
        width:100%;display:block;overflow-x:auto;border-collapse:collapse;margin:12px 0;
      }
      td,th{padding:4px;border:1px solid #ccc;font-size:14px}

      pre,code{
        font-family:SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;
        white-space:pre-wrap;word-wrap:break-word;overflow-x:auto;
      }
      pre{background:#f7f7f7;border:1px solid #e1e1e1;border-radius:4px;padding:8px;margin:12px 0}

      .idname{margin:20px 0 4px;background:#eaf3ff;padding:.5rem;border-bottom:3px solid #516ab6;font-size:12px}
      .txt{margin:20px 0 40px 5px;font-size:18px;font-weight:bold}

      </style>
      </head>
      <body>
      <section class="article">
      <p><a href="${articleURL}" target=_"blank">${articleURL}</a></p>
      ${extracted}
      </section>
      </body>
      </html>
      `;

    const data = new TextEncoder().encode(content);
    Deno.writeFileSync("/mnt/c/Users/untun/Downloads/preview.html", data);
    console.log("Update preview.html file");
  } catch (err) {
    console.log(err);
    return;
  }
}

// async function testAll_site() {
//   type Row = { rss: string, url: string, category: string, lastAccess: Date, durationAccess: number }
//   const { data, error } = await supabase.from<Row, "public">("sites").select("rss, category, title");
//   if (error) throw error;
//   const rsss = data.map((d) => [d.rss, d.category, d.title]);
//   if (rsss.length === 0) {
//     console.log("fetched data length 0 from supabase (rss, category, title)")
//     return;
//   }
//
//   for (const [ of rsss) {
//     const site = await new Site(r).init();
//     const art = site.articles[0];
//
//
//   }
// }
