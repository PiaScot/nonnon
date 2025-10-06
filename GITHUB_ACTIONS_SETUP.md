# GitHub Actions セットアップガイド

## 1. PostgreSQL 関数の更新

Supabase の SQL Editor で以下を実行してください：

```sql
-- migrations/003_update_get_sites_to_scrape_function.sql の内容を実行
DROP FUNCTION IF EXISTS public.get_sites_to_scrape();

CREATE OR REPLACE FUNCTION public.get_sites_to_scrape()
RETURNS SETOF public.sites AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.sites
  WHERE last_access + (duration_access * interval '1 minute') <= now();
END;
$$ LANGUAGE plpgsql;
```

## 2. GitHub Secrets の設定

リポジトリの Settings → Secrets and variables → Actions で以下を設定：

### 必須の Secrets

| Secret 名 | 値の例 | 説明 |
|----------|--------|------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase プロジェクトURL |
| `SUPABASE_ROLE_KEY` | `eyJhbGc...` | Supabase service role key |
| `ARTICLE_TABLE` | `articles` | 記事テーブル名 |
| `SITE_TABLE` | `sites` | サイトテーブル名（旧: `antena_sites`） |
| `CATEGORY_TABLE` | `categories` | カテゴリテーブル名 |
| `SUPER_CATEGORY_TABLE` | `super_categories` | スーパーカテゴリテーブル名 |
| `BOOKMARK_TABLE` | `bookmarks` | ブックマークテーブル名 |
| `ALLOW_HOST_TABLE` | `allowed_embed_hosts` | 許可ホストテーブル名 |
| `GENERAL_REMOVE_TAGS_TABLE` | `general_remove_tags` | 一般削除タグテーブル名 |
| `GET_SITES_TO_SCRAPE_RPC` | `get_sites_to_scrape` | RPC関数名 |

### オプションの Secrets（デフォルト値あり）

| Secret 名 | デフォルト値 | 説明 |
|----------|-------------|------|
| `MAX_ARTICLES` | `10000` | 最大記事保持数 |
| `BATCH_SIZE` | `500` | バッチ処理サイズ |
| `SCRAPE_CONCURRENCY` | `5` | 並列スクレイピング数 |

## 3. ワークフロー実行スケジュール

- **自動実行**: 毎時0分（UTC）
  - JST: 毎時9分（UTC+9）
- **手動実行**: GitHub Actions UI から `workflow_dispatch` で実行可能

## 4. 確認項目チェックリスト

### データベース
- [ ] `sites` テーブルが存在する
- [ ] `get_sites_to_scrape()` 関数が `sites` テーブルを参照している
- [ ] `sites` テーブルに `last_access` と `duration_access` カラムがある

### GitHub Repository
- [ ] `.github/workflows/scrape.yml` がコミットされている
- [ ] すべての必須 Secrets が設定されている
- [ ] `.env` ファイルが `.gitignore` に含まれている

### 初回実行前
- [ ] Supabase の `sites` テーブルにデータが登録されている
- [ ] `allowed_embed_hosts` テーブルにホワイトリストが登録されている
- [ ] `general_remove_tags` テーブルにセレクタが登録されている

## 5. トラブルシューティング

### エラー: "relation 'antena_sites' does not exist"
→ PostgreSQL 関数を更新してください（上記 SQL 実行）

### エラー: "SUPABASE_URL is required"
→ GitHub Secrets の設定を確認してください

### タイムアウトエラー
→ `SCRAPE_CONCURRENCY` を減らす（3以下を推奨）

### Playwright インストールエラー
→ ワークフローの `playwright install chromium --with-deps` ステップを確認

## 6. ログ確認方法

GitHub Actions → 該当ワークフロー → Run details

失敗時は自動的にログがアーティファクトとしてアップロードされます（7日間保持）。
