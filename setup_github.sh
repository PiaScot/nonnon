#!/bin/bash
set -e

echo "=== GitHub リポジトリセットアップ ==="
echo ""

# 1. Git 初期化
echo "Step 1: Initializing git repository..."
if [ ! -d .git ]; then
  git init
  echo "  ✓ Git initialized"
else
  echo "  ✓ Git already initialized"
fi

git branch -M main
echo "  ✓ Branch set to 'main'"
echo ""

# 2. GitHub リポジトリ作成
echo "Step 2: Creating GitHub repository..."
read -p "Repository name (default: nonnon): " REPO_NAME
REPO_NAME=${REPO_NAME:-nonnon}

read -p "Make repository private? (y/n, default: y): " IS_PRIVATE
IS_PRIVATE=${IS_PRIVATE:-y}

if [ "$IS_PRIVATE" = "y" ]; then
  VISIBILITY="--private"
else
  VISIBILITY="--public"
fi

gh repo create "$REPO_NAME" \
  $VISIBILITY \
  --source=. \
  --description="RSS-based article aggregation and content processing system" \
  --disable-wiki

echo "  ✓ Repository created"
echo ""

# 3. 初回コミット
echo "Step 3: Creating initial commit..."
git add .
git commit -m "Initial commit: RSS scraper with HTML processing

- TypeScript-based RSS aggregation system
- 12-stage HTML processing pipeline
- Supabase integration
- GitHub Actions hourly execution
- Domain-specific page formatting
- Mobile-optimized CSS reset injection"

echo "  ✓ Commit created"
echo ""

# 4. プッシュ
echo "Step 4: Pushing to GitHub..."
git push -u origin main
echo "  ✓ Code pushed to GitHub"
echo ""

# 5. Secrets 設定
echo "Step 5: Setting GitHub Actions secrets from .env..."
if [ -f .env ]; then
  SECRET_COUNT=0
  while IFS='=' read -r key value; do
    # コメント行と空行をスキップ
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z $key ]] && continue

    # 値から引用符とスペースを削除
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

    # 空の値をスキップ
    [[ -z $value ]] && continue

    echo "  Setting: $key"
    if gh secret set "$key" --body "$value" 2>/dev/null; then
      ((SECRET_COUNT++))
    else
      echo "    ⚠ Failed to set $key"
    fi
  done < .env

  echo "  ✓ $SECRET_COUNT secrets configured"
else
  echo "  ✗ .env file not found!"
  exit 1
fi
echo ""

# 6. 確認
echo "Step 6: Verifying setup..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Repository Information"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
REPO_URL=$(gh repo view --json url -q .url)
echo "URL: $REPO_URL"
echo ""

echo "🔐 Secrets Configured:"
gh secret list
echo ""

echo "⚙️ Workflows Available:"
gh workflow list
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next Steps:"
echo "  1. Update PostgreSQL function in Supabase:"
echo "     Execute: migrations/003_update_get_sites_to_scrape_function.sql"
echo ""
echo "  2. Test workflow manually:"
echo "     gh workflow run scrape.yml"
echo ""
echo "  3. View workflow runs:"
echo "     gh run list --workflow=scrape.yml"
echo ""
echo "  4. Watch logs in real-time:"
echo "     gh run watch"
echo ""
