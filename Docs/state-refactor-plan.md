# State Refactor Plan (あるべき姿に振り切る版)

## 目的
アプリ全体の状態管理を、後方互換性を気にせず「あるべき姿」に合わせて大幅に整理する。
現状の肥大化した `useConversationState` を解体し、**純粋なstate + action + reducer + effects + selectors** の構造に置き換える。

## 前提条件 / コンテキスト (調査済み)
- リポジトリ概要: ローカルで動く Codex CLI 風フロント + Hono バックエンドで `codex app-server` を橋渡しする開発支援アプリ
- 技術: Node.js 22+, TypeScript, React + Vite, Hono
- エントリポイント: `src/main.tsx`, `server/index.ts`
- 既存の状態管理ライブラリ: **なし** (Redux/Zustand/Contextは未使用)
- **現在の中心状態**は `src/modules/conversation/ui/useConversationState.ts` に集中
- UI局所state: `src/components/ChatHistory.tsx`, `src/components/ReasoningItem.tsx`, `src/components/Sidebar.tsx`
- WebSocketの受信は `src/modules/conversation/infra/wsHandlers.ts` が `messages/diffs/fileChanges/approvals/threadStatus` を更新
- バックエンドの永続状態は `data/repos.json` (repoとsettings)
- バックエンド実行時state:
  - `server/appServerManager.ts` (sessions)
  - `server/appServerSession.ts` (status/pending/process)
  - `server/websocketGateway.ts` (connections/subscribed)
  - `server/turnState.ts` (turn status map)
  - `server/threadListRefresher.ts` (pending refresh)
  - `server/rolloutLastMessage.ts` (lastMessageAt cache)
- AGENTS.md 制約:
  - 既存命名に合わせる
  - `any` 禁止
  - ログはpinoで文脈を持たせる
  - install/check系コマンドは自分で実行
  - 最小変更志向だが、今回は後方互換性は無視
  - `data/` は触らない

## 現状の課題 (要点)
- `useConversationState` が **通信/永続設定/会話UI/スレッド管理/入力UI** を抱えて肥大化
- state更新パスが `setX` で散乱し、見通しが悪い
- WebSocket/HTTP/ユーザー操作の責務境界が曖昧
- 派生状態と実体stateが混在

## ゴール
- **stateはReducerで一元管理**
- **副作用はEffects層に集約**
- UIは**selectorで必要なsliceのみを購読**
- `useConversationState` は廃止 (互換性不要)
- 主要な更新は **action駆動** に統一

## 非ゴール
- 既存API返却形の維持
- 既存UIコンポーネントの完全温存
- 外部状態管理ライブラリ導入 (Redux/Zustandなど)

## あるべき姿のアーキテクチャ

### 1) Conversation Store
- **ConversationState**: ドメイン状態のみ (純粋データ)
  - threads/messages/diffs/fileChanges/approvals/turnStatus/selectedRepo/selectedThread など
- **ConversationAction**: すべての更新はaction
  - `ws/notification`, `ws/request`, `ui/send`, `ui/approve`, `http/threads_loaded` など
- **Reducer**: `reduce(state, action)` の純粋関数
- **購読方式 (再レンダリング対策)**:
  - `useSyncExternalStore` を前提に **selector購読** を実装
  - selectorごとに `Object.is` もしくは shallow 比較で再レンダリングを抑制
  - Contextは `dispatch` のみ共有し、stateは外部ストア経由で取得する

### 2) Effects層
- WebSocket接続/購読/受信
- REST API呼び出し
- toast 等の副作用
- **ライフサイクル/クリーンアップ方針**:
  - 接続: `connect -> subscribe -> ack` の順で一貫させる
  - 再接続: 既存の購読リストを保持し、再接続時に再購読
  - 二重購読防止: "subscribed set" をeffectsで保持
  - unmount時: socket close + timer cleanup

### 3) Selectors
- `focusedRepo`, `repoGroups`, `threadUiStatusById`, `focusedModel` などは **派生状態としてselector** で計算
- stateに保持しない
- 例 (命名は "focused" で統一)
  - `selectFocusedRepo`, `selectFocusedRepoId`
  - `selectFocusedThread`, `selectFocusedThreadId`
  - `selectFocusedThreadMessages`, `selectFocusedThreadDiffs`, `selectFocusedThreadFileChanges`, `selectFocusedThreadApprovals`
  - `selectThreadUiStatusById`
  - `selectFocusedModel`
  - `selectFocusedThreadRunning`

### 4) Provider + Selector Hook
- `ConversationProvider`: store + effectsの起動
- `useConversationSelector(selector)` で slice 購読

## 新しいモジュール構成 (案)
- `src/modules/conversation/store/`
  - `state.ts` (ConversationState型)
  - `actions.ts` (ConversationAction型)
  - `reducer.ts` (reduce関数)
  - `selectors.ts` (派生ロジック)
- `src/modules/conversation/effects/`
  - `useWsEffects.ts`
  - `useHttpEffects.ts`
  - `useToastEffects.ts` (必要なら)
- `src/modules/conversation/provider/`
  - `ConversationProvider.tsx`
  - `useConversationSelector.ts`
- 既存ファイル:
  - `src/modules/conversation/domain/state.ts` は reducerへ統合/置き換え候補
  - `src/modules/conversation/infra/wsHandlers.ts` は action化する方向で再設計

## 具体的なstateスライス設計 (案)
- Core
  - `repos`, `focusedRepoId`
  - `threadsByRepo`, `focusedThreadId`
  - `sessionStatusByRepo`
- Conversation
  - `messagesByThread`, `diffsByThread`, `fileChangesByThread`
  - `approvalsByThread`, `activeTurnByThread`, `threadStatusByThread`
- Settings
  - `modelSettings` (`storedModel`, `defaultModel`, `modelSettingsLoaded`)
  - `availableModelsByRepo`
  - `permissionMode`
- UI input
  - **ローカルstateに寄せる** (storeから除外)

## Action設計 (例)
- Repo/Thread
  - `repos/loaded`, `repo/selected`, `threads/loaded`, `thread/selected`
- WS
  - `ws/connected`, `ws/disconnected`
  - `ws/notification_received`, `ws/request_received`
- Conversation
  - `message/delta`, `message/started`, `reasoning/delta`
  - `diff/updated`, `fileChange/updated`
  - `approval/received`, `approval/resolved`
  - `turn/started`, `turn/finished`, `thread/status_updated`
- Settings
  - `model/settings_loaded`, `model/changed_optimistic`, `model/change_failed`
  - `permission/loaded`, `permission/changed`

## State / Action / Reducer 具体化 (ドラフト)

### ConversationState (型案)
```ts
import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  PermissionMode,
  Repo,
  SessionStatus,
  ThreadStatusFlags,
  ThreadSummary,
} from "../types";

export type ConversationState = {
  repos: Repo[];
  focusedRepoId: string | null;
  threadsByRepo: Record<string, ThreadSummary[]>;
  focusedThreadId: string | null;
  sessionStatusByRepo: Record<string, SessionStatus>;

  messagesByThread: Record<string, ChatMessage[]>;
  diffsByThread: Record<string, DiffEntry[]>;
  fileChangesByThread: Record<string, Record<string, FileChangeEntry>>;
  approvalsByThread: Record<string, ApprovalRequest[]>;
  activeTurnByThread: Record<string, string | null>;
  threadStatusByThread: Record<string, ThreadStatusFlags>;

  modelSettings: {
    storedModel: string | null;
    defaultModel: string | null;
    loaded: boolean;
  };
  availableModelsByRepo: Record<string, string[]>;

  permissionMode: PermissionMode;

  // UI表示で必要なら保持。不要ならeffects内で完結させてstoreから外す
  connection: {
    wsConnected: boolean;
  };
};

export const initialConversationState: ConversationState = {
  repos: [],
  focusedRepoId: null,
  threadsByRepo: {},
  focusedThreadId: null,
  sessionStatusByRepo: {},

  messagesByThread: {},
  diffsByThread: {},
  fileChangesByThread: {},
  approvalsByThread: {},
  activeTurnByThread: {},
  threadStatusByThread: {},

  modelSettings: { storedModel: null, defaultModel: null, loaded: false },
  availableModelsByRepo: {},

  permissionMode: "ReadOnly",
  connection: { wsConnected: false },
};
```

### ConversationAction (型案)
```ts
export type ConversationAction =
  // Repo/Thread list
  | { type: "repos/loaded"; repos: Repo[] }
  | { type: "repo/focused"; repoId: string | null }
  | { type: "threads/loaded"; repoId: string; threads: ThreadSummary[] }
  | { type: "threads/optimistic_add"; repoId: string; thread: ThreadSummary }
  | { type: "threads/optimistic_remove"; repoId: string; threadId: string }
  | { type: "thread/focused"; threadId: string | null }
  | {
      type: "thread/preview_updated";
      repoId: string;
      threadId: string;
      preview: string;
    }
  | {
      type: "thread/lastMessageAt_updated";
      repoId: string;
      threadId: string;
      lastMessageAt: string;
    }
  | { type: "session/status"; repoId: string; status: SessionStatus }

  // Messages / reasoning / diffs / file changes
  | { type: "messages/replace"; threadId: string; messages: ChatMessage[] }
  | { type: "message/append"; threadId: string; message: ChatMessage }
  | { type: "message/remove_pending"; threadId: string; messageId: string }
  | { type: "message/delta"; threadId: string; itemId: string; deltaText: string }
  | {
      type: "message/started";
      threadId: string;
      itemId: string;
      role: "user" | "agent" | "assistant";
      text?: string;
    }
  | {
      type: "reasoning/started";
      threadId: string;
      itemId: string;
      summary: string;
      content: string;
    }
  | {
      type: "reasoning/delta";
      threadId: string;
      itemId: string;
      deltaText: string;
      isSummary: boolean;
    }
  | { type: "diff/updated"; threadId: string; turnId: string; diffText: string }
  | {
      type: "fileChange/updated";
      threadId: string;
      itemId: string;
      turnId?: string;
      status?: string;
      changes: FileChangeEntry["changes"];
    }

  // Approvals
  | { type: "approval/received"; threadId: string; request: ApprovalRequest }
  | { type: "approval/resolved"; threadId: string; rpcId: number | string }

  // Turn / thread status
  | { type: "turn/started"; threadId: string; turnId: string }
  | {
      type: "turn/finished";
      threadId: string;
      status: "completed" | "failed" | "error" | "interrupted";
    }
  | { type: "thread/status"; threadId: string; patch: Partial<ThreadStatusFlags> }

  // Settings
  | {
      type: "model/settings_loaded";
      storedModel: string | null;
      defaultModel: string | null;
    }
  | { type: "model/available_loaded"; repoId: string; models: string[] }
  | { type: "permission/loaded"; mode: PermissionMode }
  | { type: "permission/changed"; mode: PermissionMode }

  // Connection
  | { type: "connection/status"; wsConnected: boolean };
```

### Reducer 実装ルール (要点)
- `message/delta` / `reasoning/delta` は **itemIdでupsert** (重複通知に耐える)
- **順序逆転時の扱い**:
  - `message/delta` が先行した場合は **仮メッセージを生成** して追記
  - 後続の `message/started` は **既存エントリを上書き補正** (role/text/pendingの整合)
  - `reasoning/delta` も同様に **仮生成 → startedで補正** を許容
- `approval/received` は **rpcId重複排除**
- `turn/started` は `activeTurnByThread[threadId]=turnId` + `thread/status` で `processing=true`
- `turn/finished` は `activeTurnByThread[threadId]=null` + `processing=false`
  - `reviewing` は **turn/finishedでfalse** に落とす
  - `unread` は **維持** (別アクションで明示的にクリア)
- `thread/status` は **patch適用型** (過剰な上書きを避ける)
- `messages/replace` は resume 時に使用 (完全置換)

## Effects / Commands 具体化 (ドラフト)

### 基本方針
- UIは**command**のみ呼び出し、reducerは**純粋**に保つ
- Effectsは `dispatch` と現在stateの読み取りのみを使い、DOM依存は持たない
- WS/HTTP/Toast/auto-approval は Effects に集約

### Commands API (例)
```ts
export type ConversationCommands = {
  loadInitialData(): void;
  connectWs(): void;
  disconnectWs(): void;

  focusRepo(repoId: string | null): void;
  focusThread(repoId: string, threadId: string): void;

  createThread(repoId: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
  startReview(target: ReviewTarget): Promise<void>;
  stopActiveTurn(): Promise<void>;

  updateModel(model: string | null): Promise<void>;
  updatePermissionMode(mode: PermissionMode): Promise<void>;
  approveRequest(
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ): void;
};
```

### useWsEffects (設計)
- 役割:
  - WS接続/再接続/購読管理
  - 受信メッセージをAction化して `dispatch`
  - app-server request への応答送信 (`approveRequest` の送信部)
- 状態:
  - `wsRef`, `subscribedRepoIds` は effects 内で保持 (storeには置かない)
- 再接続ポリシー:
  - `open -> subscribe -> ack` を徹底
  - close/error 時に `connection/status=false` を dispatch
  - **再購読対象の基準**: `repos` 全件 (focusedのみではなく全repo)
  - 再接続時は **最新のrepos** を参照して再購読
  - 二重購読は `subscribedRepoIds` で抑止
- cleanup:
  - unmountで `ws.close()` とタイマーを必ず解除
- 注意:
  - processing は turnイベントでのみ更新する (item/completedでのトグルは禁止)

### useHttpEffects (設計)
- 役割:
  - 初期ロード (repos, settings, permission)
  - focus repo 時の session start / threads list / resume
  - models list の取得
  - thread作成・review開始・turn開始/停止
- 失敗時:
  - reducerを壊さず、必要に応じて `toast` へ通知 (toastは別effects)
- 依存:
  - `api.ts` を直接呼ぶ
  - 返却結果を **action** に変換して `dispatch`
- resume と WS 競合の扱い:
  - `focusThread` / `resumeThread` 中は **該当 threadId の WS イベントを一時バッファ**
  - バッファは **thread単位** (他スレッドには影響させない)
  - 上限: 200件 / 10秒 (超過時は古い順に破棄)
  - `messages/replace` を適用後に **バッファを順に再生**して整合性を保つ

### Commands と Effects の接続 (補足)
- `ConversationCommands` は **effects層の薄いFacade**
- 実体は `useConversationEffects` が持ち、
  - `command -> (必要ならHTTP/WS呼び出し) -> dispatch(action)` の流れ
- UIは **dispatchを直接呼ばない** (command経由)

### useToastEffects (設計)
- 役割:
  - command/HTTP/WS の失敗通知をUIに伝える
  - reducerへは影響を与えない

### auto-approval (FullAccess) の扱い
- 位置づけ: **effects内の副作用** (storeには持たない)
- `ws/notification` 受信時に、FullAccessなら auto-approval message を `message/append` で注入
- 重複防止: `seenAutoApprovedIdsByThread` を effects 内で管理

## Selectors 詳細設計 (ドラフト)

### ルール
- selectorは **純関数** とし、副作用を持たない
- 入力は `ConversationState` のみ (外部参照なし)
- 返り値は **プリミティブ or 永続参照** を意識し、不要な新規オブジェクト生成を避ける
- `useConversationSelector(selector)` 側で `Object.is` か shallow 比較を行う前提

### Core
- `selectFocusedRepoId(state): string | null`
- `selectFocusedRepo(state): Repo | null`
- `selectFocusedThreadId(state): string | null`
- `selectFocusedThread(state): ThreadSummary | null`
- `selectSessionStatusByRepo(state): Record<string, SessionStatus>`

### Thread lists / groups
- `selectRepoGroups(state): { repo: Repo; threads: ThreadSummary[]; sessionStatus: SessionStatus }[]`
  - `threadsByRepo` を **repo.path基準でフィルタ** (現行ロジック踏襲)
  - repoIdではなく path基準を維持する前提
  - `sessionStatusByRepo` と結合

### Messages / diffs / approvals
- `selectFocusedThreadMessages(state): ChatMessage[]`
- `selectFocusedThreadDiffs(state): DiffEntry[]`
- `selectFocusedThreadFileChanges(state): Record<string, FileChangeEntry>`
- `selectFocusedThreadApprovals(state): ApprovalRequest[]`
- `selectFocusedThreadActiveTurnId(state): string | null`

### Thread UI status
- `selectThreadUiStatusById(state): Record<string, ThreadUiStatus>`
  - `threadStatusByThread` と `approvalsByThread` を合成
  - priority: approvals > reviewing > processing > unread > ready

### Model / permission
- `selectAvailableModels(state): string[] | undefined`
  - focused repo に紐づく models を返す
- `selectFocusedModel(state): string | null`
  - stored > default > first model の順で解決
- `selectPermissionMode(state): PermissionMode`

### Connection
- `selectWsConnected(state): boolean`
  - 使いどころは `HeaderBar` の接続表示などに限定

### Running
- `selectFocusedThreadRunning(state): boolean`
  - `threadStatusByThread[focusedThreadId]?.processing` を返す

### Selector テスト方針 (最低限)
- `selectFocusedModel` の優先順位を検証
- `selectThreadUiStatusById` の優先順位を検証
  - approvals+reviewing が同時に true の場合は **approval を優先**
  - processing+unread の同時発火時は **processing を優先**
- `selectRepoGroups` のフィルタ/結合を検証

## Reducer 擬似コード (主要アクション)

> 目的: 実装時の迷いを減らすため、アクションごとの更新手順を明文化する。

### Repo/Thread
- `repos/loaded`
  - `state.repos = repos`
  - `focusedRepoId` が未設定なら `repos[0]?.repoId ?? null`
  - `repoPathById` 相当は selector で処理 (stateに持たない)
- `repo/focused`
  - `focusedRepoId = repoId`
  - `focusedThreadId` は **維持** (HTTP effects側でresume後に更新)
- `threads/loaded`
  - `threadsByRepo[repoId] = threads`
- `threads/optimistic_add`
  - `threadsByRepo[repoId]` に `thread` を追加 (重複は無視)
- `threads/optimistic_remove`
  - `threadsByRepo[repoId]` から `threadId` を削除
- `thread/focused`
  - `focusedThreadId = threadId`
  - `threadStatusByThread[threadId]` は未初期化なら `{ processing:false, reviewing:false, unread:false }` で初期化
  - `threadStatusByThread[threadId].unread = false`
- `thread/preview_updated`
  - `threadsByRepo[repoId]` の該当threadの `preview` を更新
- `thread/lastMessageAt_updated`
  - `threadsByRepo[repoId]` の該当threadの `lastMessageAt` を更新
- `session/status`
  - `sessionStatusByRepo[repoId] = status`

### Messages / Reasoning
- `messages/replace`
  - `messagesByThread[threadId] = messages`
- `message/append`
  - `messagesByThread[threadId] = [...current, message]`
- `message/remove_pending`
  - `messagesByThread[threadId]` から `messageId` を削除
- `message/delta`
  - `upsertAgentDelta(messages, itemId, deltaText)` を使用
  - 既存が無ければ **仮メッセージを生成**
- `message/started`
  - role が user/agent/assistant に応じて `applyUserMessageStart` or `applyAgentMessageStart`
  - 既存エントリがあれば **上書き補正**
  - **pending user message が存在する場合**は、itemId を付与して既存pendingを置換
  - 置換対象が特定できない場合は **最初の pending user message を消費**
- `reasoning/started`
  - `applyReasoningStart` を使用 (summary/content を正規化して保存)
- `reasoning/delta`
  - `upsertReasoningDelta` を使用
  - 既存が無ければ **仮メッセージを生成**

### Diffs / FileChanges
- `diff/updated`
  - `applyDiffUpdate` を使用し `turnId` 単位で upsert
- `fileChange/updated`
  - `applyFileChangeUpdate` を使用し `itemId` 単位で upsert

### processing の真実
- **processing は turn を唯一の真実とする**
  - `turn/started` で true
  - `turn/finished` で false
  - itemイベント (`item/completed`) では **processing を変更しない**

### Approvals
- `approval/received`
  - `approvalsByThread[threadId]` に追加
  - `rpcId` が既存なら **追加しない**
  - `threadStatusByThread[threadId]` は未初期化なら `{ processing:false, reviewing:false, unread:false }` で初期化
  - focused thread でなければ `threadStatusByThread[threadId].unread = true`
- `approval/resolved`
  - `approvalsByThread[threadId]` から `rpcId` を削除

### Turn / ThreadStatus
- `turn/started`
  - `activeTurnByThread[threadId] = turnId`
  - `threadStatusByThread[threadId]` は未初期化なら `{ processing:false, reviewing:false, unread:false }` で初期化
  - `threadStatusByThread[threadId].processing = true`
- `turn/finished`
  - `activeTurnByThread[threadId] = null`
  - `threadStatusByThread[threadId].processing = false`
  - `threadStatusByThread[threadId].reviewing` は **維持** (entered/exitedReviewMode を真実とする)
  - `unread` は維持 (別イベントで消す)
- `thread/status`
  - `current = threadStatusByThread[threadId] ?? { processing: false, reviewing: false, unread: false }`
  - `threadStatusByThread[threadId] = { ...current, ...patch }`

### Settings / Connection
- `model/settings_loaded`
  - `modelSettings = { storedModel, defaultModel, loaded: true }`
- `model/available_loaded`
  - `availableModelsByRepo[repoId] = models`
- `permission/loaded`
  - `permissionMode = mode`
- `permission/changed`
  - `permissionMode = mode`
- `connection/status`
  - `connection.wsConnected = wsConnected`

## Effects → Actions マッピング表 (ドラフト)

### WS 受信 → Action
- `session_status`
  - `dispatch({ type: "session/status", repoId, status })`
- `thread_list_updated`
  - `dispatch({ type: "threads/loaded", repoId, threads })`
- `app_server_notification`
  - `message/delta` (item/agentMessage|assistantMessage/delta)
  - `reasoning/started` (item/started|completed for reasoning)
  - `reasoning/delta` (item/reasoning/*Delta)
  - `message/started` (item/started|completed for user/agent/assistant)
  - `diff/updated` (turn/diff/updated)
  - `fileChange/updated` (item/fileChange)
  - `turn/started` (turn/started)
  - `turn/finished` (turn/completed|turn/failed|turn/error)
  - `thread/status` (reviewing/unread のpatchのみ)
- `app_server_request`
  - `approval/received` (requestApproval系)

### HTTP 結果 → Action
- `api.listRepos`
  - `repos/loaded`
- `api.listThreads`
  - `threads/loaded`
- `api.getModelSettings`
  - `model/settings_loaded`
- `api.getPermissionModeSettings`
  - `permission/loaded`
- `api.listModels`
  - `model/available_loaded`
- `api.resumeThread`
  - `messages/replace`
  - `thread/status` (reviewing のみ反映。processingはturnイベントで管理)
- `api.startTurn`
  - `turn/started`
- `api.startReview`
  - `turn/started`

### Command → HTTP / WS / Action
- `loadInitialData`
  - `api.listRepos` → `repos/loaded`
  - `api.getModelSettings` → `model/settings_loaded`
  - `api.getPermissionModeSettings` → `permission/loaded`
- `connectWs`
  - WS接続 → `connection/status`
  - open後 `subscribe` (repos全件)
- `focusRepo`
  - `dispatch(repo/focused)`
  - `api.startSession` + `api.listThreads` → `threads/loaded`
  - 必要なら `api.resumeThread` → `messages/replace`
- `focusThread`
  - `dispatch(thread/focused)`
  - `api.resumeThread` → `messages/replace`
  - `thread/status` (reviewing のみ反映。processingはturnイベントで管理)
- `createThread`
  - `api.createThread` → `threads/loaded` 再取得 or optimistic追加
- `sendMessage`
  - optimistic `message/append`
  - `api.startTurn` → `turn/started`
  - 失敗時 rollback action
- `startReview`
  - `api.startReview` → `turn/started`
- `stopActiveTurn`
  - `api.cancelTurn`
- `updateModel`
  - optimistic `model/settings_loaded` (storedModelのみ更新でも可)
  - `api.updateModelSetting` → `model/settings_loaded`
- `updatePermissionMode`
  - `permission/changed`
- `approveRequest`
  - WS `app_server_response` 送信
  - `approval/resolved`

## WSイベント詳細 (app_server_notification) → Action

### delta系
- `item/agentMessage/delta` / `item/assistantMessage/delta`
  - `message/delta` (itemIdはparamsから抽出)
- `item/reasoning/summaryTextDelta` / `item/reasoning/textDelta`
  - `reasoning/delta` (isSummary=true/false)

### item started/completed
- `item/started` / `item/completed`
  - `item.type === "userMessage"`
    - `message/started` (role=user)
  - `item.type === "agentMessage"` or `"assistantMessage"`
    - `message/started` (role=agent for agentMessage, role=assistant for assistantMessage)
    - focused thread 以外なら `thread/status` で `unread=true`
  - `item.type === "reasoning"`
    - `reasoning/started` (summary/content を抽出)
  - `item.type === "fileChange"`
    - `fileChange/updated` (changes/status/turnId を抽出)
  - `item.type === "enteredReviewMode"`
    - `thread/status` で `reviewing=true`
  - `item.type === "exitedReviewMode"`
    - `thread/status` で `reviewing=false`

### turn系
- `turn/started`
  - `turn/started` (activeTurn)
- `turn/completed` / `turn/failed` / `turn/error`
  - `turn/finished`
  - `reviewing` は **維持** (entered/exitedReviewMode を真実とする)

## Command 失敗時の Rollback 設計 (ドラフト)

### 原則
- rollback は **明示的な action** で行い、effects側で集中管理
- reducerは「楽観更新 → 失敗時の復元」の両方を扱う
- 失敗時に UI入力の復元が必要な場合は UIローカルで処理

### 送信 (sendMessage)
- optimistic:
  - `message/append` で pending user message を追加
  - `thread/lastMessageAt_updated` と `thread/preview_updated` を更新
- 失敗時 rollback:
  - `message/remove_pending` (messageIdで削除) を追加するか、
    `messages/replace` で巻き戻し
  - `thread/preview_updated` / `thread/lastMessageAt_updated` を**直前値で再dispatch**
  - UI入力は **local state** に戻す
- 突合ルール (optimistic ↔ server echo):
  - pending message には `messageId` を付与して保持
  - `message/started` (userMessage) が来たら **pending user message を消費して itemId を付与**
  - `itemId` が既知ならそのエントリを更新、未特定なら最初の pending を置換
  - **同一スレッドの同時送信は1件まで**を前提にする
  - もし複数同時送信を許容するなら、`clientMessageId` を送信payloadに含めて突合する

### スレッド作成 (createThread)
- optimistic:
  - `threads/optimistic_add` (NEW_THREAD_PREVIEW)
- 失敗時 rollback:
  - `threads/optimistic_remove` (threadIdで削除)

### モデル更新 (updateModel)
- optimistic:
  - `model/settings_loaded` (storedModelだけ即時更新可)
- 失敗時 rollback:
  - `model/settings_loaded` を直前値で再dispatch

### レビュー開始 (startReview)
- optimistic:
  - (処理中表示は `turn/started` を待つ)
- 失敗時 rollback:
  - (処理中表示のrollback不要)

### ターン停止 (stopActiveTurn)
- 失敗時 rollback:
  - 基本的に UI側で通知のみ (stateは変更しない)

### approval 応答 (approveRequest)
- WS送信失敗時:
  - `approval/resolved` は送信成功後に dispatch
  - 失敗時は **approvalを残す** (再送可能にする)

## UI移行タスク分解 (具体)

### 0) Provider / Store 導入
- `ConversationProvider` を `App` 直下に配置
- `useConversationSelector` / `useConversationCommands` を用意
- 旧 `useConversationState` は **並走** (UI移行完了後に削除)

### 1) HeaderBar
- `wsConnected` の参照を `selectWsConnected` に置換
- 影響ファイル: `src/components/HeaderBar.tsx` (想定)

### 2) Sidebar
- 置換対象:
  - `repoGroups` → `selectRepoGroups`
  - `threadUiStatusByThread` → `selectThreadUiStatusById`
  - `selectedRepoId` / `selectedThreadId` → `selectFocusedRepoId` / `selectFocusedThreadId`
  - `running` → `selectFocusedThreadRunning`
- イベント:
  - `onSelectRepo` → `commands.focusRepo`
  - `onCreateThread` → `commands.createThread`
  - `onSelectThread` → `commands.focusThread`

### 3) MainPanel (会話領域)
- 置換対象:
  - `messages` → `selectFocusedThreadMessages`
  - `diffs` → `selectFocusedThreadDiffs`
  - `fileChanges` → `selectFocusedThreadFileChanges`
  - `approvals` → `selectFocusedThreadApprovals`
  - `activeTurnId` → `selectFocusedThreadActiveTurnId`
  - `running` → `selectFocusedThreadRunning`
  - `selectedRepoId` / `selectedRepoPath` / `selectedThreadId` → selectorで取得
  - `selectedModel` / `availableModels` / `permissionMode` → selectorで取得
- イベント:
  - `onSend` → `commands.sendMessage`
  - `onReviewStart` → `commands.startReview`
  - `onStop` → `commands.stopActiveTurn`
  - `onModelChange` → `commands.updateModel`
  - `onPermissionModeChange` → `commands.updatePermissionMode`
  - `onApprove` → `commands.approveRequest`

### 4) Composer (入力UI)
- `inputText` / `reviewTarget*` は **ローカルstate** に移動
- `onInputTextChange` / `onReviewTargetTypeChange` 等はローカルで完結
- submit時のみ `commands.sendMessage` / `commands.startReview` を呼ぶ

### 5) useConversationState 削除
- すべてのUIが selector/command に置換されたら削除
- `src/modules/conversation/ui/useConversationState.ts` と関連テストを整理

## テスト移行計画 (具体)

### 目的
- 旧 `useConversationState` のテスト資産を、**store/reducer/selector/effects/commands** に分解して再配置する
- E2E的な広いテストは減らし、**純関数テスト + command/effectsの統合テスト** に寄せる

### 1) reducer テスト
- 移行元:
  - `src/modules/conversation/domain/state.test.ts` を継続・拡張
- 追加すべきケース:
  - `message/delta` → `message/started` の逆転順序
  - `approval/received` の重複排除
  - `turn/started` / `turn/finished` による processing のみ更新
  - `thread/status` の初期化ガード

### 2) selector テスト
- 新規作成:
  - `src/modules/conversation/store/selectors.test.ts`
- 対象:
  - `selectFocusedModel` の優先順位
  - `selectThreadUiStatusById` の優先順位 (approval > reviewing > processing > unread > ready)
  - `selectRepoGroups` の path基準フィルタ
  - `selectFocusedThreadRunning`

### 3) effects / commands テスト
- 新規作成:
  - `src/modules/conversation/effects/useWsEffects.test.ts`
  - `src/modules/conversation/effects/useHttpEffects.test.ts`
  - `src/modules/conversation/provider/useConversationCommands.test.ts`
- 目的:
  - WS受信 → action dispatch のマッピング
  - resume中の WS バッファ処理
  - optimistic → rollback の正しさ
  - command → dispatch の流れが崩れないこと

### 4) UIコンポーネントテスト
- 移行元:
  - `src/modules/conversation/ui/useConversationState.test.ts` は削除予定
- 置換:
  - `Sidebar` / `MainPanel` / `Composer` の最小限の振る舞いテストに分割
  - UIは**selector結果が反映されるか**に焦点

### 5) 既存テストの整理
- `useConversationState` 依存テストは **段階的に削除**
- 旧テストの意図を `reducer/selector/effects` テストに割り当てる

## 実装タスク分割 (チケット粒度)

### Phase 1: Store基盤
- T1: `store/state.ts` + `store/actions.ts` + `store/reducer.ts` を作成
  - 受け入れ基準: `initialConversationState` と `ConversationAction` が型チェックを通る
- T2: `store/selectors.ts` を作成
  - 受け入れ基準: selectorテストの雛形が通る
- T3: `provider/ConversationProvider.tsx` + `provider/useConversationSelector.ts`
  - 受け入れ基準: `useSyncExternalStore` で購読できる

### Phase 2: Effects/Commands
- T4: `effects/useWsEffects.ts`
  - 受け入れ基準: WS受信が Action へ変換される
- T5: `effects/useHttpEffects.ts`
  - 受け入れ基準: 初期ロードとfocus/resumeが Action に反映される
- T6: `provider/useConversationCommands.ts`
  - 受け入れ基準: command経由で effects/dispatch が動く

### Phase 3: UI移行
- T7: `HeaderBar` を selector に切り替え
- T8: `Sidebar` を selector/command に切り替え
- T9: `MainPanel` を selector/command に切り替え
- T10: `Composer` をローカルstateへ移動
  - 受け入れ基準: UIが現行と同等に動作

### Phase 4: テスト移行
- T11: `selectors.test.ts` を追加
- T12: `useWsEffects.test.ts` / `useHttpEffects.test.ts` を追加
- T13: 旧 `useConversationState` テストを削除/置換

### Phase 5: クリーンアップ
- T14: `useConversationState` を削除
- T15: 未使用コード/型/テストの削除
  - 受け入れ基準: `pnpm check` が通る

## 冪等性・順序依存への対応方針
- 重複通知に備えて reducer を **冪等** にする
  - `message/delta` は `itemId` で upsert (既存に追記/上書き)
  - `approval/received` は `rpcId` で重複排除
  - `turn/started` / `turn/finished` は `turnId` で上書き可能に
- 再接続時の再送を吸収するため、**既存エントリの更新を許容する**設計にする
- 必要なら `seenItemIdsByThread` のような軽量トラッキングを追加検討

## Migration Plan (ステップ)
1. **ConversationStore + Provider + Selector** の骨格を先に導入
2. `wsHandlers` を action生成に置き換え (旧stateは維持しつつ並走)
3. **MainPanel (messages/diffs/approvals)** を selectorに置き換え
4. **Sidebar (repos/threads/status)** を selectorに置き換え
5. HTTP fetchロジックを Effects に移動し、旧フローを削除
6. `useConversationState` を削除

## リスク / 注意点
- WebSocket通知の順序依存 (delta → started → completed) を reducerで正確に再現する
- optimistic thread 作成のロールバック挙動を壊しやすい
- permissionMode による auto-approval の副作用は effects へ
- `threadUiStatusByThread` は派生に寄せる (stateに残さない)
- Effectsの再接続/購読が破綻しないよう、責務を明文化する

## テスト戦略
- reducerは **純関数テスト** をVitestで追加
- ws通知のシーケンスをテスト (delta/started/completed)
- optimistic thread / rollback のテスト
- selectorsのテストを最低限追加 (派生データの検証)
- `pnpm check` を必ず通す

## 参考ファイル (現状)
- `src/modules/conversation/ui/useConversationState.ts`
- `src/modules/conversation/infra/wsHandlers.ts`
- `src/modules/conversation/domain/state.ts`
- `src/components/ChatHistory.tsx`
- `src/components/ReasoningItem.tsx`
- `src/components/Sidebar.tsx`
- `server/createApp.ts`
- `server/repoRegistry.ts`
- `server/turnState.ts`

## 決定事項
- 後方互換性は考慮しない
- 状態管理ライブラリは導入しない (React標準のみ)
- `useConversationState` は廃止
- store実装は `useSyncExternalStore` + selector購読で進める
- UI入力stateはローカルに寄せる
- Provider境界はアプリ全体 (App直下) に置く

## 未決定 / 要確認
- `seenItemIdsByThread` のような追加トラッキングを導入するか
  - 目安: delta/started の逆転や重複が実運用で頻発する場合に導入
