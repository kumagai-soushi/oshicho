# サブカル会「推し帳」公開版 計画書

アカウント不要・URL＋合言葉で使える、サブカル会の推し共有ウェブアプリを作る。
本番：**2026-12-21 サブカル会**。

## 全体構成

| 役割 | 使うもの | 費用 |
|---|---|---|
| 画面（スマホ向け1ページ） | HTML/CSS/JS（ビルドなし）＋ supabase-js（CDN） | 無料 |
| データ保存 | Supabase（Postgres） | 無料枠 |
| 公開 | GitHub Pages | 無料（リポジトリはPublic） |
| 開発 | Claude Code（PC） | — |

**守り方**：テーブルはRLSで直接アクセスを全部禁止。読み書きは「合言葉を引数に取るDB関数（RPC）」経由だけにする。合言葉はDB内にハッシュで保存。コードを公開しても、合言葉を知らなければデータは読めない。
※簡易的な鍵。URLと合言葉が漏れたら合言葉を変える。個人情報は入れない。

**名前**：アカウントなし。初回に呼び名を入力して端末に保存（localStorage）。

---

## ステップ0：準備（今夜・約20分）← いまここ

- [ ] **0-1 Supabase登録**：supabase.com →「Start your project」→「Continue with GitHub」
- [ ] **0-2 プロジェクト作成**：New project
  - Name：`oshicho` / Region：**Northeast Asia (Tokyo)** / Plan：Free
  - Database Password：自分で控える（チャットやコードには書かない）
- [ ] **0-3 接続情報を控える**：Project Settings → API（API Keys）
  - `Project URL`（https://xxxx.supabase.co）
  - `anon` / `publishable` キー（公開前提のキー。画面のコードに書いてOK）
  - ⚠️ `service_role` / `secret` キーは**絶対に使わない・書かない**
- [ ] **0-4 GitHubリポジトリ作成**：`oshicho`（Public、READMEありで作成）→ PCにclone
- [ ] **0-5** このPLAN.mdと `reference/artifact-index.html`（Claude版の叩き台）をリポジトリに置いてcommit

## ステップ1：データベース（約30分）

Claude Codeに `supabase/schema.sql` を作らせ、Supabaseの **SQL Editor** に貼って実行。

**テーブル**
- `works`：id, title, media, by_name, entry（まずはここまで）, note, link, homework(bool), created_at, added_by
- `marks`：work_id, nick, read(bool), hit(bool)（主キー：work_id＋nick）
- `meta`：key, value（次回の開催日・場所）
- `app_secret`：合言葉のハッシュ（1行だけ）
- （第2弾用）`seasonal`：旬ネタ

**関数（すべて security definer、先頭で合言葉チェック）**
- `oshi_get(pass)` → works / marks / meta をまとめてJSONで返す
- `oshi_save_work(pass, ...)` 登録・編集
- `oshi_delete_work(pass, id)`
- `oshi_mark(pass, work_id, nick, read, hit)`
- `oshi_set_meta(pass, key, value)`

**合言葉の設定**（そうしさんがSQL Editorで自分で実行。Claudeに教えない）
```sql
insert into app_secret (id, hash) values (1, extensions.crypt('ここに合言葉', extensions.gen_salt('bf')))
on conflict (id) do update set hash = excluded.hash;
```

- [ ] schema.sql 実行 → 合言葉設定 → SQL Editorで `select oshi_get('合言葉');` が返ることを確認

## ステップ2：画面（約1〜2時間）

`reference/artifact-index.html` の見た目と機能をベースに移植する。

- `index.html` / `app.js` / `style.css` / `config.js`（URLとanonキー）
- 起動時：合言葉入力画面 → 保存（localStorage）→ 呼び名入力 → 本体
- 本体：次回の開催日とカウントダウン／宿題（大きい短冊）／推し品書き（ジャンル絞り込み・新着／刺さった順／自分が未読）／「＋推す」登録シート／読んだ・刺さった／宿題にする／編集・削除（2回押しで確定）
- 更新：画面を開いた時・アプリに戻った時に再読み込み＋30秒ごと
- タブの入れ物だけ用意：「推し帳」「旬ネタ（準備中）」
- PWA：`manifest.json`・アイコン・apple-touch-icon（ホーム画面に追加でアプリ風に）

- [ ] PCのブラウザで動作確認（`npx serve .` など）

## ステップ3：公開（約15分）

- [ ] push → GitHub：Settings → Pages → Deploy from a branch → `main` / root
- [ ] `https://<ユーザー名>.github.io/oshicho/` をiPhoneのSafariで開く → 共有 →「ホーム画面に追加」
- [ ] Androidでも1台確認できるとなお良い

## ステップ4：試運転（〜12/14）

- [ ] 初期データ投入：異世界美少女受肉おじさんと（1巻から）／ハーレム勇者伝説（1話だけ）を宿題に、次回 12/21
- [ ] 誰か1人（のっつくん？）に先行で触ってもらう
- [ ] サブカル会のLINEに案内：**URLと合言葉は別メッセージで送る**

## ステップ5：第2弾「旬ネタ」（12/21以降でもOK）

- AniList（GraphQL・キー不要）から前／今／次クールのアニメ一覧を取得
- GitHub Actions で定期実行 → Supabase `seasonal` に保存
- 会の前にClaudeで「今クール注目10本＋映画・漫画・ゲームの話題作」をコメント付きで選定して投入
- 旬ネタに「観てる／気になる」→ 推し帳へワンタップで移動

---

## Claude Codeへの最初の指示（ステップ0完了後にコピペ）

```
このリポジトリの PLAN.md を読んで、ステップ1を進めてください。
supabase/schema.sql を作成し、テーブルにRLSを有効化して直接アクセスは全禁止、
読み書きは合言葉チェック付きの security definer 関数だけにしてください。
pgcrypto は extensions スキーマのものを使ってください。
合言葉の値はファイルに書かず、設定用SQLはプレースホルダにしてください。
```
