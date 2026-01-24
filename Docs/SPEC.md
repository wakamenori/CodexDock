# MVP実装タスク定義（Codex向け）— Local Web App + Hono Backend + Codex app-server

## 目的
ローカル環境で動く「Webフロントエンド開発サポート」アプリを作る。UIは Codex CLI 風（下に入力欄、上にチャット）。左サイドパネルでリポジトリ選択/登録とスレッド一覧/新規作成を行う。バックエンドは Hono を使い、repoごとに `codex app-server` を子プロセス起動して stdio(JSONL) で通信する。履歴（thread/turn/items）は app-server 側の永続化を正とし、アプリ側は repo一覧など最小メタデータだけを JSON に保存する。

---

## 前提・方針
- 動作環境: ローカル（認証なし）
- サーバ: Hono（HTTP + WebSocket）
- フロント: Web（React想定、UIは1画面）
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
- repoIdの生成（例: sha1(path) の先頭N文字など）

2) AppServerManager
- repoId -> AppServerSession のマップ
- getOrStart(repoId): 起動済みなら返す、なければ spawn + handshake
- stop(repoId), stopAll()
- セッション状態（starting/connected/stopped/error）

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

---

## HTTP API仕様
Base: `http://localhost:{port}`

### Repo
#### GET /api/repos
- 200
```json
{ "repos": [ { "repoId":"...", "name":"...", "path":"...", "lastOpenedThreadId":"..." } ] }
````

#### POST /api/repos

* body

```json
{ "name":"my-repo", "path":"/abs/path/to/repo" }
```

* 201

```json
{ "repo": { "repoId":"...", "name":"...", "path":"..." } }
```

#### PATCH /api/repos/:repoId

* body（必要分のみ）

```json
{ "name":"new-name", "lastOpenedThreadId":"thr_..." }
```

* 200

```json
{ "repo": { "repoId":"...", "name":"...", "path":"...", "lastOpenedThreadId":"..." } }
```

#### DELETE /api/repos/:repoId

* 204

### Session（repoごと）

#### POST /api/repos/:repoId/session/start

* 200

```json
{ "status":"started" }
```

#### POST /api/repos/:repoId/session/stop

* 200

```json
{ "status":"stopped" }
```

#### GET /api/repos/:repoId/session/status

* 200

```json
{ "status":"connected" }
```

* status: "connected" | "starting" | "stopped" | "error"

### Threads（repoごと）

#### GET /api/repos/:repoId/threads

* 200

```json
{ "threads": [ { "threadId":"thr_...", "preview":"...", "updatedAt":"..." } ] }
```

#### POST /api/repos/:repoId/threads

* 201

```json
{ "thread": { "threadId":"thr_..." } }
```

#### POST /api/repos/:repoId/threads/:threadId/resume

* 200

```json
{ "thread": { "threadId":"thr_..." } }
```

### Turns

#### POST /api/repos/:repoId/turns

* body

```json
{
  "threadId":"thr_...",
  "input":[{ "type":"text", "text":"実装方針を提案して" }],
  "cwd":"/abs/path/to/repo",
  "options": {
    "model":"optional",
    "approvalPolicy":"optional",
    "sandboxPolicy":"optional"
  }
}
```

* 202

```json
{ "turn": { "turnId":"turn_...", "status":"running" } }
```

#### POST /api/repos/:repoId/turns/:turnId/cancel

* 200

```json
{ "turn": { "turnId":"turn_...", "status":"cancelled" } }
```

## WebSocket API仕様

### 接続

* GET /ws

### Client -> Server

#### subscribe

```json
{ "type":"subscribe", "requestId":"uuid", "payload":{ "repoId":"repo_..." } }
```

#### unsubscribe

```json
{ "type":"unsubscribe", "requestId":"uuid", "payload":{ "repoId":"repo_..." } }
```

#### app_server_response

```json
{ "type":"app_server_response", "payload":{ "repoId":"repo_...", "message":{ "id":123, "result":{ "decision":"accept" } } } }
```

or

```json
{ "type":"app_server_response", "payload":{ "repoId":"repo_...", "message":{ "id":123, "result":{ "decision":"decline" } } } }
```

### Server -> Client

#### session_status

```json
{ "type":"session_status", "payload":{ "repoId":"repo_...", "status":"connected" } }
```

#### thread_list_updated

```json
{ "type":"thread_list_updated", "payload":{ "repoId":"repo_...", "threads":[ { "threadId":"thr_...", "preview":"...", "updatedAt":"..." } ] } }
```

#### app_server_notification

```json
{ "type":"app_server_notification", "payload":{ "repoId":"repo_...", "message":{ "method":"turn/started", "params":{ "turn":{ "id":"turn_..." } } } } }
```

#### app_server_request

```json
{ "type":"app_server_request", "payload":{ "repoId":"repo_...", "message":{ "id":123, "method":"item/fileChange/requestApproval", "params":{ "threadId":"thr_...", "turnId":"turn_...", "itemId":"itm_..." } } } }
```

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

### Notifications/Requestsの中継方針（MVP）

* app-serverのnotificationsはそのままWSへ中継（`app_server_notification`）
* app-serverのserver-initiated requests（承認など）は`app_server_request`で中継
* フロントは`app_server_response`でJSON-RPC responseを返す
* 表示側は `item/agentMessage/delta`、`turn/diff/updated` など公式イベントをそのまま使う

実装では `codex app-server generate-ts` または `generate-json-schema` を使い、実際の通知/メソッド名に合わせる。

---

## 動作確認・テスト戦略（効率重視）

### 1) HTTP（サーバレステスト）

* Honoの `app.request()` または testing guideに従い、HTTPエンドポイントの契約テストを作る
* repo CRUD / session start / threads list/start/resume / turns start まで
  参考: Hono Testing Guide

### 2) WebSocket（結合テスト）

* テスト内でローカルサーバを空きポート起動
* wsクライアントで /ws に接続し subscribe を送る
* サーバから session_status 等が返ることを確認

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
