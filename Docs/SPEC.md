# MVP実装タスク定義（Codex向け）— Local Web App + Hono Backend + Codex app-server

## 目的
ローカル環境で動く「Webフロントエンド開発サポート」アプリを作る。UIは Codex CLI 風（下に入力欄、上にチャット）。左サイドパネルでリポジトリ選択/登録とスレッド一覧/新規作成を行う。バックエンドは Hono を使い、repoごとに `codex app-server` を子プロセス起動して stdio(JSONL) で通信する。履歴（thread/turn/items）は app-server 側の永続化を正とし、アプリ側は repo一覧など最小メタデータだけを JSON に保存する。

---

## 前提・方針
- 動作環境: ローカル（認証なし）
- ランタイム: Node.js 22+（推奨: 22.x）
- サーバ: Hono（HTTP + WebSocket）
- フロント: React + Vite + Tailwind CSS（UIは1画面）
- app-server プロセス: リポジトリごとに起動（CODEX_HOMEは共有でOK）
- ストリーミング: app-server notifications をバックエンドで正規化して WS でフロントへ配信
- ルーティング: repoId -> app-server session
- 安全: turn/start には必ず `cwd = repo.path` を入れる。実行中はrepo切替を禁止（または入力無効化で可）

---

## UI仕様（1画面）
### レイアウト
- 左サイドパネル
  - リポジトリ選択（ドロップダウン）
  - リポジトリ追加（name/path入力 + 登録）
  - スレッド一覧（選択中repoのthread/list結果）
  - 新規スレッド作成
  - 接続状態表示（connected/starting/stopped/error）
- 右メイン（Codex CLI風）
  - チャットタイムライン（上）
  - 承認UI（入力欄の直上に出現）
  - 入力欄（最下部、Enter送信/Shift+Enter改行）
  - 差分はチャット内カードとして表示（`turn/diff/updated` の内容を表示。`item/fileChange/requestApproval` 時は apply/reject を表示）

### UI状態（最小）
- idle: 入力可能
- running: ストリーミング表示、入力無効（またはキャンセル導線）
- approval_pending: 承認UI表示（apply/reject）

---

## 永続化（アプリ側・最小）
保存先例: `~/.yourapp/repos.json`（またはプロジェクト内 `data/repos.json`）
保存データ:
- repoId: string（pathのハッシュ等）
- name: string
- path: string
- lastOpenedThreadId?: string

---

## バックエンド構成（Hono）
### 主要コンポーネント
1) RepoRegistry
- repos.json のCRUD（読み/書き）
- repoIdの生成（正規化済みpathのハッシュ）
- path は正規化して保存する（絶対パス化 + 末尾スラッシュ除去 + 可能なら realpath 解決）
- 同一の正規化pathが既に存在する場合は登録を拒否（409）
- repoId衝突が検出された場合も登録を拒否（409）
- path の変更は不可（変更したい場合は削除→再登録）
- 書き込みはアトミックに行う（同一ディレクトリに一時ファイルを書き、renameで置き換える）
- 同一プロセス内の同時更新はミューテックスで直列化する
- 複数プロセスからの同時起動はMVPでは想定しない（必要ならファイルロックを導入）

2) AppServerManager
- repoId -> AppServerSession のマップ
- getOrStart(repoId): 起動済みなら返す、なければ spawn + handshake
- stop(repoId), stopAll()
- セッション状態（starting/connected/stopped/error）
- サーバ起動時に RepoRegistry を読み込み、全repoのセッションを起動する
  - 起動失敗のrepoは status=error として扱い、サーバ自体は継続起動する
- サーバ終了時に stopAll() で全セッションを停止する

3) AppServerSession（stdio JSONL RPC）
- spawn("codex", ["app-server"], { stdio: ["pipe","pipe","pipe"] })
- stdoutを行単位で読む（readline）
- request/response: id付きRPC（pending map）
- notifications: idなしメッセージをイベントとして上位へemit
- 初期化: initialize -> initialized を必ず実行

4) AppServerBridge
- app-serverのJSON-RPCメッセージをrepoId付きでそのまま中継
  - notifications（method/paramsのみ）とserver-initiated requests（idあり）を区別
  - クライアントからのresponseをapp-serverへ返す
- repoごとにセッションが分かれるため、混線はrepoIdで分離できる

5) WebSocketGateway
- /ws で接続
- subscribe(repoId) したクライアントへ、そのrepoのイベントのみ流す
- 1接続が複数repoをsubscribe可能（MVPは選択中repo1つでもOK）
- subscribe / unsubscribe は配信制御のみで、セッションの起動/停止には影響しない

---

## HTTP API仕様
Base: `http://localhost:{port}`

### エラーレスポンス（共通）
* 形式（例）
```json
{ "error": { "code":"invalid_request", "message":"...", "details":{ "field":"threadId" } } }
```
* 代表的なHTTPステータス
  * 400: 不正なJSON / 必須パラメータ不足 / 型不正
  * 404: repoId / threadId / turnId が存在しない
  * 409: repoの重複登録 / repoId衝突
  * 422: path不正（存在しない/アクセス不可/ディレクトリでない 等）
  * 500: 内部エラー（app-server起動失敗、JSON-RPC失敗、想定外例外）
* app-server由来の失敗は `details.appServerError` に格納する
  * 例: `{ code, message, codexErrorInfo?, httpStatusCode? }`

### Repo
#### GET /api/repos
- 200
```json
{ "repos": [ { "repoId":"...", "name":"...", "path":"...", "lastOpenedThreadId":"..." } ] }
```
* エラー条件:
  * 500: repos.json の読み込み失敗

#### POST /api/repos

* body

```json
{ "name":"my-repo", "path":"/abs/path/to/repo" }
```

* 201

```json
{ "repo": { "repoId":"...", "name":"...", "path":"..." } }
```
* 動作: 登録後にセッションを自動起動する
  * 起動失敗時は `session_status=error` を通知し、登録自体は成功とする
* エラー条件:
  * 400: name/path 欠落・型不正
  * 409: 同一pathのrepoが既に存在する / repoId衝突
  * 422: path が存在しない / 読み取り不可 / ディレクトリでない
  * 500: repos.json の書き込み失敗

#### PATCH /api/repos/:repoId

* body（必要分のみ）

```json
{ "name":"new-name", "lastOpenedThreadId":"thr_..." }
```

* 200

```json
{ "repo": { "repoId":"...", "name":"...", "path":"...", "lastOpenedThreadId":"..." } }
```
* エラー条件:
  * 400: bodyが空 / 型不正 / path を含む
  * 404: repoId が存在しない
  * 500: repos.json の書き込み失敗

#### DELETE /api/repos/:repoId

* 204
* 動作: 対象repoのセッションが存在する場合は必ず停止してから削除する
* セッション停止に失敗した場合は 500 を返し、削除しない
* 成功時は必要に応じて `session_status` を `stopped` で通知する
* エラー条件:
  * 404: repoId が存在しない
  * 500: セッション停止に失敗 / repos.json の書き込み失敗

### Session（repoごと）

#### POST /api/repos/:repoId/session/start

* 200

```json
{ "status":"started" }
```
* 動作: 起動済みなら何もしない（idempotent）。stopped / error の場合は再起動を試みる
* 失敗時は 500 を返す
* エラー条件:
  * 404: repoId が存在しない
  * 500: app-server起動失敗 / JSON-RPC失敗

#### POST /api/repos/:repoId/session/stop

* 200

```json
{ "status":"stopped" }
```
* エラー条件:
  * 404: repoId が存在しない
  * 500: app-server停止失敗 / JSON-RPC失敗

#### GET /api/repos/:repoId/session/status

* 200

```json
{ "status":"connected" }
```

* status: "connected" | "starting" | "stopped" | "error"
* エラー条件:
  * 404: repoId が存在しない

### Threads（repoごと）

#### GET /api/repos/:repoId/threads

* 200

```json
{ "threads": [ { "threadId":"thr_...", "preview":"...", "updatedAt":"..." } ] }
```
* 備考:
  * app-server の `thread/list` は最初のページのみ取得し、`nextCursor` は無視する（limit指定もしない）
* エラー条件:
  * 404: repoId が存在しない
  * 500: app-serverの thread/list 失敗

#### POST /api/repos/:repoId/threads

* 201

```json
{ "thread": { "threadId":"thr_..." } }
```
* エラー条件:
  * 404: repoId が存在しない
  * 500: app-serverの thread/start 失敗

#### POST /api/repos/:repoId/threads/:threadId/resume

* 200

```json
{ "thread": { "threadId":"thr_..." } }
```
* エラー条件:
  * 404: repoId / threadId が存在しない
  * 500: app-serverの thread/resume 失敗

### Turns

#### POST /api/repos/:repoId/turns

* body

```json
{
  "threadId":"thr_...",
  "input":[{ "type":"text", "text":"実装方針を提案して" }],
  "options": {
    "model":"optional",
    "approvalPolicy":"optional",
    "sandboxPolicy":"optional"
  }
}
```

* 注意:
  * `cwd` はクライアントから送らない。サーバ側で必ず `repo.path` を設定する
  * `options` は app-server の `turn/start` パラメータ（top-level）へマッピングして渡す
  * `input` は将来的に `image` / `localImage` / `skill` などを受ける想定

* 202

```json
{ "turn": { "turnId":"turn_...", "status":"running" } }
```
* エラー条件:
  * 400: threadId 欠落 / input 不正
  * 404: repoId / threadId が存在しない
  * 500: app-serverの turn/start 失敗

#### POST /api/repos/:repoId/turns/:turnId/cancel

* 200

```json
{ "turn": { "turnId":"turn_...", "status":"interrupt_requested" } }
```
* 動作: app-server の `turn/interrupt` を呼び出す（完了は `turn/completed` の `status: "interrupted"` で判断）
* 既に完了済みのturnに対しては 200 を返し、`status: "already_finished"` とする
* エラー条件:
  * 404: repoId / turnId が存在しない
  * 500: app-serverの turn/interrupt 失敗

---

## ID命名規約

* HTTP API は `threadId` / `turnId` / `itemId` を使用する
* WebSocket の `app_server_notification` / `app_server_request` は app-server 由来の `id` をそのまま保持する
* 対応表:
  * `threadId` ↔ `thread.id`
  * `turnId` ↔ `turn.id`
  * `itemId` ↔ `item.id`

## WebSocket API仕様

### 接続

* GET /ws

### Client -> Server

#### subscribe

```json
{ "type":"subscribe", "requestId":"uuid", "payload":{ "repoId":"repo_..." } }
```
* requestId は subscribe_ack / subscribe_error にそのまま返す

#### unsubscribe

```json
{ "type":"unsubscribe", "requestId":"uuid", "payload":{ "repoId":"repo_..." } }
```
* requestId は unsubscribe_ack にそのまま返す

#### app_server_response

```json
{ "type":"app_server_response", "payload":{ "repoId":"repo_...", "message":{ "id":123, "result":{ "decision":"accept" } } } }
```

or

```json
{ "type":"app_server_response", "payload":{ "repoId":"repo_...", "message":{ "id":123, "result":{ "decision":"decline" } } } }
```

* payload.message は app-server の server-initiated request への JSON-RPC response をそのまま渡す
* 承認系の response は `decision: "accept" | "decline"` を基本とし、command 承認では `acceptSettings` を含める場合がある
* 追加フィールドが来ても破棄せず透過させる

### Server -> Client

#### subscribe_ack

```json
{ "type":"subscribe_ack", "requestId":"uuid", "payload":{ "repoId":"repo_..." } }
```

* subscribe が正常に受理されたことを示す
* この後に `session_status` が送られる

#### subscribe_error

```json
{ "type":"subscribe_error", "requestId":"uuid", "payload":{ "repoId":"repo_...", "error":{ "code":"repo_not_found", "message":"..." } } }
```

* repoId 不正などで subscribe できない場合に返す

#### unsubscribe_ack

```json
{ "type":"unsubscribe_ack", "requestId":"uuid", "payload":{ "repoId":"repo_..." } }
```

* unsubscribe は冪等とする（購読していないrepoでも ack を返す）

#### session_status

```json
{ "type":"session_status", "payload":{ "repoId":"repo_...", "status":"connected" } }
```

* 意味: repoに対応する app-server セッションの現在状態
* 発火タイミング:
  * subscribe成功直後に必ず1回送信
  * 状態遷移時（starting -> connected / connected -> stopped / error など）
  * セッション停止（Repo削除を含む）時

#### thread_list_updated

```json
{ "type":"thread_list_updated", "payload":{ "repoId":"repo_...", "threads":[ { "threadId":"thr_...", "preview":"...", "updatedAt":"..." } ] } }
```

* 意味: 指定repoのスレッド一覧が更新されたことを知らせるイベント
* payload.threads は最新の完全な一覧を返す（差分ではなく全量）
* 発火タイミング例:
  * thread/start または thread/resume 実行直後
  * turn完了時に preview / updatedAt が更新された場合

#### app_server_notification

```json
{ "type":"app_server_notification", "payload":{ "repoId":"repo_...", "message":{ "method":"turn/started", "params":{ "turn":{ "id":"turn_..." } } } } }
```

#### app_server_request

```json
{ "type":"app_server_request", "payload":{ "repoId":"repo_...", "message":{ "id":123, "method":"item/fileChange/requestApproval", "params":{ "threadId":"thr_...", "turnId":"turn_...", "itemId":"itm_..." } } } }
```

* payload.message は app-server から来た JSON-RPC request をそのまま中継する
* 例: `item/commandExecution/requestApproval` / `item/fileChange/requestApproval` など

---

## app-server連携（RPC/通知の取り扱い）

### 起動と初期化

* spawn後、必ず:

  1. request("initialize", { clientInfo })
  2. send notification("initialized", {})
* 起動失敗時は session_status=error を通知

### Thread操作

* thread/list -> GET /threads
* thread/start -> POST /threads
* thread/resume -> POST /threads/:threadId/resume

### Turn開始

* turn/start は必ず threadId を指定し、cwd を repo.path に固定する
* 応答は notifications を購読してストリーミング反映する
* `item/*/requestApproval` が来るため、承認UIで必ず応答する（UIを用意しない場合は `approvalPolicy: "never"` を指定する）
* `approvalPolicy: "never"` で承認リクエストが届いた場合はプロトコル違反として扱う
  * app-server には JSON-RPC response で `decision: "decline"` を返す
  * 必要に応じて当該turnを failed 扱いにし、WSへ通知する

### Turn中断

* turn/cancel は app-server の `turn/interrupt` に対応する
* 中断完了は `turn/completed` の `status: "interrupted"` で判断する

### Notifications/Requestsの中継方針（MVP）

* app-serverのnotificationsはそのままWSへ中継（`app_server_notification`）
* app-serverのserver-initiated requests（承認など）は`app_server_request`で中継
* フロントは`app_server_response`でJSON-RPC responseを返す
* 表示側は `item/agentMessage/delta`、`turn/diff/updated` など公式イベントをそのまま使う

実装では `codex app-server generate-ts` または `generate-json-schema` を使い、実際の通知/メソッド名に合わせる。
本書のメソッド名やparams例は代表例であり、生成スキーマを正とする。

---

## 開発ツール/品質ゲート（Biome + pnpm + tsgo）

### ツール/スクリプト

* パッケージ管理: pnpm
* リント/フォーマット: Biome（`pnpm lint` / `pnpm format`）
* 型チェック: tsgo（`pnpm typecheck`）
* テスト: `pnpm test`（詳細は「動作確認・テスト戦略」）

### テスト基盤（採用）

* テストランナー: Vitest
* UIテスト: Testing Library
* WS結合テスト補助: ws + get-port

### 実行順（ローカル/CI共通）

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`

---

## ログ/観測（MVP）

### 方針

* 形式: JSON Lines（stdout; warn/errorはstderr）
* 実装: pino + pino-http（redactionで秘匿情報をマスク）
* レベル: debug / info / warn / error（`LOG_LEVEL` で切替）
* フィールド: `timestamp`, `level`, `msg`, `component`, `repoId`, `threadId`, `turnId`, `requestId`, `connectionId`, `rpcId`, `method`, `durationMs`, `error`
* 秘匿情報: APIキー/トークン/パスワードは必ずマスク。入力本文や差分は原則ログしない（必要なら長さのみ）

### 記録ポイント（最小）

* サーバ起動/停止、設定読み込み失敗
* Repo CRUD（追加/削除/更新）、repos.json 書き込み失敗
* AppServerSession の spawn/initialize/stop 成否
* JSON-RPC request/response/notification の送受信（件数/サイズ、エラー時の詳細）
* WS 接続/切断/subscribe/unsubscribe
* turn start/completed/failed/interrupt、承認の決定内容
* 予期せぬ例外（stack付き）

---

## 動作確認・テスト戦略（効率重視）

### 1) HTTP（サーバレステスト）

* Honoの `app.request()` または testing guideに従い、HTTPエンドポイントの契約テストを作る
* repo CRUD / session start / threads list/start/resume / turns start まで
  参考: Hono Testing Guide
* Repo追加時の自動起動は AppServerManager をFake化し、getOrStart が呼ばれることを検証する

### 2) WebSocket（結合テスト）

* テスト内でローカルサーバを空きポート起動
* wsクライアントで /ws に接続し subscribe を送る
* サーバから session_status 等が返ることを確認
* サーバ起動時に repos.json の全repoが自動起動されることを確認する（Fakeで開始イベントを生成）

### 3) app-server依存を減らすための Fake

* AppServerSessionをDI可能にし、FakeAppServerSessionを用意
* Fakeが app_server_notification / app_server_request を生成し、WS中継が正しいかをテスト
* 実機の codex app-server 連携確認は smoke（任意）として分離

### 手動確認

* HTTP: curl で /api/repos などを叩く
* WS: wscat 等で /ws 接続して subscribe を送る

---

## 実装タスク（順序）

1. Honoサーバ雛形（HTTP + WS）とディレクトリ構成
2. RepoRegistry（repos.json）CRUD + HTTP endpoints
3. AppServerSession（spawn + JSONL RPC + initialize）
4. AppServerManager（repoId -> session）
5. Threads API（thread/list/start/resume をapp-serverへブリッジ）
6. Turns API（turn/start）+ WSへ app_server_notification を中継
7. 承認フロー（app_server_request <-> app_server_response）
8. diffフロー（turn/diff/updated を表示）
9. Webフロント（1画面UI）: 左パネル（repo/thread）、右（チャット/入力/承認/差分）
10. テスト: HTTP契約テスト + WS結合テスト + Fakeセッション

---

## フロントの最小要件（実装ガイド）

* 起動時: GET /api/repos -> repo一覧表示
* repo選択: POST /session/start -> GET /threads -> スレッド一覧表示
* 新規スレッド: POST /threads -> 選択してresume
* 入力送信: POST /turns -> runningへ
* WS接続: /ws に接続 -> subscribe(repoId)
* 受信:

  * app_server_notification: `item/agentMessage/delta` をチャット追記
  * app_server_notification: `turn/diff/updated` を差分カード表示/更新
  * app_server_request: `item/*/requestApproval` を入力欄直上に表示
  * app_server_notification: `turn/started` / `turn/completed` / `turn/failed` で状態更新
* 承認: app_server_response を WebSocket で返す
* 承認UIを用意しない運用にする場合は turn/start で `approvalPolicy: "never"` を指定する
