# GitHub リポジトリ作成 & アップロード手順

## 前提条件

- `gh` CLI がインストールされていること
- GitHub にログイン済みであること

## 手順

### 1. gh CLI の認証確認

```bash
# 認証状態を確認
gh auth status

# 未認証の場合はログイン
gh auth login
```

### 2. Git リポジトリの初期化

```bash
cd /home/plum/project/nonnon

# Git 初期化（まだの場合）
git init

# .gitignore の確認（既にあるので OK）
cat .gitignore
```

### 3. GitHub リポジトリの作成

```bash
# プライベートリポジトリとして作成
gh repo create nonnon \
  --private \
  --source=. \
  --description="RSS-based article aggregation and content processing system" \
  --disable-wiki

# または、対話的に作成したい場合
gh repo create
```

### 4. 初回コミット & プッシュ

```bash
# ステージング（.gitignore が効いている）
git add .

# コミット
git commit -m "Initial commit: RSS scraper with HTML processing

- TypeScript-based RSS aggregation system
- 12-stage HTML processing pipeline
- Supabase integration
- GitHub Actions hourly execution
- Domain-specific page formatting
- Mobile-optimized CSS reset injection"

# プッシュ（初回）
git branch -M main
git push -u origin main
```

### 5. GitHub Actions Secrets の一括設定（.env から）

`.env` ファイルから自動的に Secrets を設定するスクリプト：

```bash
# .env を読み込んで Secrets に設定
while IFS='=' read -r key value; do
  # コメント行と空行をスキップ
  [[ $key =~ ^#.*$ ]] && continue
  [[ -z $key ]] && continue

  # 値から引用符を削除
  value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

  # Secret を設定
  echo "Setting secret: $key"
  gh secret set "$key" --body "$value"
done < .env

echo "All secrets have been set!"
```

**または、個別に設定する場合：**

```bash
# .env の各行を読んで手動設定
gh secret set SUPABASE_URL --body "https://your-project.supabase.co"
gh secret set SUPABASE_ROLE_KEY --body "your-service-role-key"
gh secret set ARTICLE_TABLE --body "articles"
gh secret set SITE_TABLE --body "sites"
gh secret set CATEGORY_TABLE --body "categories"
gh secret set SUPER_CATEGORY_TABLE --body "super_categories"
gh secret set BOOKMARK_TABLE --body "bookmarks"
gh secret set ALLOW_HOST_TABLE --body "allowed_embed_hosts"
gh secret set GENERAL_REMOVE_TAGS_TABLE --body "general_remove_tags"
gh secret set GET_SITES_TO_SCRAPE_RPC --body "get_sites_to_scrape"
gh secret set MAX_ARTICLES --body "10000"
gh secret set BATCH_SIZE --body "500"
gh secret set SCRAPE_CONCURRENCY --body "5"
```

### 6. Secrets 設定の確認

```bash
# 設定された Secrets のリストを表示（値は表示されない）
gh secret list
```

### 7. GitHub Actions ワークフローの有効化確認

```bash
# ワークフローの一覧を表示
gh workflow list

# 手動でワークフローをトリガー（テスト実行）
gh workflow run scrape.yml

# 実行状況を確認
gh run list --workflow=scrape.yml
```

### 8. ワークフロー実行ログの確認

```bash
# 最新の実行ログを表示
gh run view --log

# 特定の run ID のログを表示
gh run view <run-id> --log
```

## 完全自動化スクリプト

以下を `setup_github.sh` として保存して実行：

```bash
#!/bin/bash
set -e

echo "=== GitHub リポジトリセットアップ ==="

# 1. Git 初期化
echo "1. Initializing git repository..."
git init
git branch -M main

# 2. GitHub リポジトリ作成
echo "2. Creating GitHub repository..."
gh repo create nonnon \
  --private \
  --source=. \
  --description="RSS-based article aggregation and content processing system" \
  --disable-wiki

# 3. 初回コミット
echo "3. Creating initial commit..."
git add .
git commit -m "Initial commit: RSS scraper with HTML processing"

# 4. プッシュ
echo "4. Pushing to GitHub..."
git push -u origin main

# 5. Secrets 設定
echo "5. Setting GitHub Actions secrets from .env..."
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z $key ]] && continue
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    echo "  Setting: $key"
    gh secret set "$key" --body "$value" 2>/dev/null || echo "    Failed to set $key"
  done < .env
else
  echo "  .env file not found!"
  exit 1
fi

# 6. 確認
echo "6. Verifying setup..."
echo ""
echo "Secrets configured:"
gh secret list

echo ""
echo "Workflows available:"
gh workflow list

echo ""
echo "=== Setup complete! ==="
echo "Repository URL: $(gh repo view --json url -q .url)"
echo ""
echo "To test the workflow manually:"
echo "  gh workflow run scrape.yml"
echo ""
echo "To view workflow runs:"
echo "  gh run list --workflow=scrape.yml"
```

実行方法：

```bash
chmod +x setup_github.sh
./setup_github.sh
```

## 注意事項

1. **`.env` ファイルの値を確認**
   - プッシュ前に `.env` の値が正しいか確認してください
   - 特に `SUPABASE_URL` と `SUPABASE_ROLE_KEY` が正しいことを確認

2. **`.gitignore` の確認**
   - `.env` が含まれていることを確認（既に含まれています）
   - `git status` で `.env` が表示されないことを確認

3. **初回ワークフロー実行**
   - プッシュ後、手動で1度テスト実行することを推奨
   - `gh workflow run scrape.yml` でトリガー

4. **PostgreSQL 関数の更新**
   - GitHub にプッシュする前に、Supabase で `migrations/003_update_get_sites_to_scrape_function.sql` を実行してください

## トラブルシューティング

### gh CLI が見つからない

```bash
# Ubuntu/Debian
sudo apt install gh

# macOS
brew install gh
```

### 認証エラー

```bash
gh auth login
# ブラウザまたはトークンで認証
```

### Secret 設定エラー

```bash
# 個別に設定して確認
gh secret set TEST_VAR --body "test_value"
gh secret list
```

### リポジトリが既に存在する場合

```bash
# 既存リポジトリに追加
git remote add origin https://github.com/USERNAME/nonnon.git
git push -u origin main
```
