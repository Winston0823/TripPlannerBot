# TripPlannerBot - iMessage App Extension 开发 Handoff 文档

## 你是谁

你是一个帮我将现有 Node.js iMessage Bot 项目转型为 **原生 iOS iMessage App Extension** 的开发助手。请完整阅读本文档后开始工作。

---

## 一、当前项目概况

这是一个 **基于 Node.js 的 iMessage 旅行规划机器人**，目前通过第三方 SDK (`@photon-ai/imessage-kit`) 在 macOS 后台运行，以纯文本方式与用户交互。

### 现有功能

1. **智能对话** — 使用 Minimax LLM (`Minimax-M2.5`) 作为 AI 引擎，支持多轮对话（每个聊天最多 20 条历史）
2. **地点搜索** — 集成 Foursquare Places API v3，搜索餐厅/酒店/景点，返回前 5 个结果
3. **旅行管理** — 创建旅行记录（名称、目的地、起止日期），每个群聊绑定一个旅行
4. **投票系统** — 创建投票（最多 6 个选项，1️⃣-6️⃣），记录投票、查看结果、关闭投票
5. **参与者追踪** — 自动注册参与者，关联用户身份与姓名
6. **消息路由** — 私聊直接响应，群聊需 `@bot` 触发

### 现有技术栈

- Node.js (ES Modules)
- Minimax API (通过 OpenAI SDK 兼容接口，baseURL: `https://api.minimax.io/v1`)
- Foursquare Places API v3
- SQLite (better-sqlite3)
- `@photon-ai/imessage-kit` 第三方 iMessage SDK
- Jest + Babel 测试

### 现有源代码

以下是完整的现有代码，用于理解业务逻辑。新项目的后端 API 需要基于这些逻辑改造。

#### imessageAgent.js（主入口，LLM 编排，工具执行）

```javascript
import { IMessageSDK } from '@photon-ai/imessage-kit';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { onDirectMessage, onGroupMessage } from './messageHandlers.js';
import { foursquareSearch } from './tools.js';
import {
    createTrip, getTripByChatId,
    createParticipant, getParticipantBySenderId,
    createPoll, getActivePollByChatId,
    recordVote, getVotesForPoll, closePoll
} from './database.js';

if (process.env.NODE_ENV !== 'test') {
    dotenv.config();
}

const sdk = new IMessageSDK({ debug: true });

const openai = new OpenAI({
    apiKey: process.env.MINIMAX_API_KEY,
    baseURL: 'https://api.minimax.io/v1',
});

console.log('iMessage AI Agent started...');

// --- Conversation History ---
const conversationHistories = new Map();
const MAX_HISTORY = 20;

function getHistory(chatId) {
    return conversationHistories.get(chatId) || [];
}

function addToHistory(chatId, message) {
    if (!conversationHistories.has(chatId)) {
        conversationHistories.set(chatId, []);
    }
    const history = conversationHistories.get(chatId);
    history.push(message);
    if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
    }
}

// --- System Prompt ---
const SYSTEM_PROMPT = `You are a trip planning assistant in an iMessage group chat. Help groups plan trips together.

Your tools:
- foursquareSearch: Find restaurants, hotels, attractions, and points of interest via Foursquare
- createTrip: Create a trip when the group decides on a destination
- createPoll: Create a poll when you need group consensus (destination, dates, restaurants, activities, etc.)
- recordVote: Record a participant's vote on the active poll

Guidelines:
- Keep responses concise — this is iMessage, not email
- When multiple options are being discussed and the group hasn't decided, create a poll
- When the group agrees on a destination (through poll results or clear consensus), create a trip
- Use foursquareSearch proactively to find and recommend places being discussed
- For general travel knowledge (visa info, best times to visit, tips), use your training data
- When someone responds to a poll (e.g. "2", "option 1", or names an option directly), record their vote
- After votes come in, summarize the current standings
- In group chats, messages are prefixed with [SenderName] so you know who said what`;

// --- Tool Definitions ---
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

const tools = [
    {
        type: 'function',
        function: {
            name: 'foursquareSearch',
            description: 'Search for restaurants, hotels, attractions, and points of interest using Foursquare.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'What to search for (e.g. "sushi", "hotels", "museums")' },
                    near: { type: 'string', description: 'Location to search near (e.g. "Tokyo, Japan", "downtown LA")' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'createTrip',
            description: 'Create a new trip for this group chat. Use when the group has decided on a destination.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'A name for the trip (e.g. "Tokyo Spring Trip")' },
                    destination: { type: 'string', description: 'The trip destination' },
                    start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
                    end_date: { type: 'string', description: 'End date in YYYY-MM-DD format (optional)' },
                },
                required: ['name', 'destination'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'createPoll',
            description: 'Create a poll to gather group input. Use for consensus on choices like destination, dates, restaurants, or activities.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The poll question' },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of options (2-6)',
                    },
                },
                required: ['question', 'options'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'recordVote',
            description: "Record a vote from the current message sender on the active poll in this chat.",
            parameters: {
                type: 'object',
                properties: {
                    option_number: {
                        type: 'number',
                        description: 'The 1-based option number the participant chose',
                    },
                },
                required: ['option_number'],
            },
        },
    },
];

// --- Tool Execution ---
async function executeTool(toolCall, context) {
    const { name } = toolCall.function;
    const args = JSON.parse(toolCall.function.arguments);
    const { chatId, sender, senderName } = context;

    switch (name) {
        case 'foursquareSearch':
            return await foursquareSearch(args.query, args.near);

        case 'createTrip': {
            const existing = getTripByChatId(chatId);
            if (existing) {
                return JSON.stringify({
                    error: `A trip already exists for this chat: "${existing.name}" to ${existing.destination}`,
                });
            }
            const tripId = createTrip(
                chatId, args.name, args.destination,
                args.start_date || null, args.end_date || null
            );
            createParticipant(tripId, sender, senderName || sender);
            return JSON.stringify({
                success: true, tripId,
                name: args.name, destination: args.destination,
                start_date: args.start_date || null,
                end_date: args.end_date || null,
            });
        }

        case 'createPoll': {
            const trip = getTripByChatId(chatId);
            if (!trip) {
                return JSON.stringify({
                    error: 'No trip exists for this chat yet. Create a trip first.',
                });
            }
            const options = args.options.slice(0, 6).map((opt, i) => ({
                emoji: NUMBER_EMOJIS[i],
                text: opt,
            }));
            const pollId = createPoll(trip.id, `poll_${Date.now()}`, args.question, options);
            const formatted = options.map(o => `${o.emoji} ${o.text}`).join('\n');
            return JSON.stringify({
                success: true, pollId,
                formatted: `📊 ${args.question}\n\n${formatted}\n\nReply with the option number to vote!`,
            });
        }

        case 'recordVote': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const activePoll = getActivePollByChatId(chatId);
            if (!activePoll) return JSON.stringify({ error: 'No active poll in this chat.' });

            let participant = getParticipantBySenderId(sender);
            if (!participant) {
                const pId = createParticipant(trip.id, sender, senderName || sender);
                participant = { id: pId };
            }

            const optionIndex = args.option_number - 1;
            if (optionIndex < 0 || optionIndex >= activePoll.options.length) {
                return JSON.stringify({
                    error: `Invalid option. Choose 1-${activePoll.options.length}.`,
                });
            }

            const chosen = activePoll.options[optionIndex];
            recordVote(activePoll.id, participant.id, chosen.emoji);

            const allVotes = getVotesForPoll(activePoll.id);
            return JSON.stringify({
                success: true,
                voter: senderName || sender,
                choice: chosen.text,
                totalVotes: allVotes.length,
                summary: allVotes.map(v => `${v.participant_name}: ${v.option_emoji}`),
            });
        }

        default:
            return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
}

// --- Main API Call ---
const MAX_TOOL_ROUNDS = 5;

export async function callMinimaxAPI(messageText, context = {}) {
    const chatId = context.chatId || 'dm';
    const senderName = context.senderName || context.sender || 'User';

    const userContent = context.chatId
        ? `[${senderName}]: ${messageText}`
        : messageText;
    addToHistory(chatId, { role: 'user', content: userContent });

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...getHistory(chatId),
    ];

    try {
        let response = await openai.chat.completions.create({
            model: 'Minimax-M2.5',
            messages,
            tools,
            tool_choice: 'auto',
        });

        let responseMessage = response.choices[0].message;
        let rounds = 0;

        while (responseMessage.tool_calls && rounds < MAX_TOOL_ROUNDS) {
            rounds++;
            messages.push(responseMessage);

            for (const toolCall of responseMessage.tool_calls) {
                const result = await executeTool(toolCall, context);
                messages.push({
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    name: toolCall.function.name,
                    content: result,
                });
            }

            response = await openai.chat.completions.create({
                model: 'Minimax-M2.5',
                messages,
                tools,
                tool_choice: 'auto',
            });
            responseMessage = response.choices[0].message;
        }

        const finalContent = responseMessage.content;
        addToHistory(chatId, { role: 'assistant', content: finalContent });
        return finalContent;

    } catch (error) {
        console.error('Error calling Minimax API:', error);
        return 'Something went wrong — try again in a sec.';
    }
}

sdk.startWatching({
    onDirectMessage,
    onGroupMessage,
    onError: (error) => {
        console.error('iMessage SDK Error:', error);
    },
});

process.on('SIGINT', async () => {
    console.log('Shutting down iMessage AI Agent...');
    await sdk.close();
    process.exit();
});

export default sdk;
```

#### messageHandlers.js（消息路由）

```javascript
import { callMinimaxAPI } from './imessageAgent.js';
import sdk from './imessageAgent.js';

const BOT_TRIGGER = /@bot/i;

export const onDirectMessage = async (msg) => {
    console.log(`DM from ${msg.sender}: ${msg.text}`);
    const cleanedText = msg.text.replace(BOT_TRIGGER, '').trim();
    const response = await callMinimaxAPI(cleanedText, {
        sender: msg.sender,
        senderName: msg.senderName,
    });
    await sdk.send(msg.sender, response);
};

export const onGroupMessage = async (msg) => {
    console.log(`Group message in ${msg.chatId} from ${msg.sender}: ${msg.text}`);
    if (!BOT_TRIGGER.test(msg.text)) return;

    const cleanedText = msg.text.replace(BOT_TRIGGER, '').trim();
    const response = await callMinimaxAPI(cleanedText, {
        chatId: msg.chatId,
        sender: msg.sender,
        senderName: msg.senderName,
    });
    await sdk.send(msg.chatId, response);
};
```

#### database.js（SQLite 数据层）

```javascript
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'trip_planner.db');
const db = new Database(dbPath);

function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT UNIQUE,
            name TEXT,
            destination TEXT,
            start_date TEXT,
            end_date TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER,
            sender_id TEXT UNIQUE,
            name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trip_id) REFERENCES trips(id)
        );

        CREATE TABLE IF NOT EXISTS polls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER,
            message_id TEXT UNIQUE,
            question TEXT,
            options TEXT,
            status TEXT DEFAULT 'open',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trip_id) REFERENCES trips(id)
        );

        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            poll_id INTEGER,
            participant_id INTEGER,
            option_emoji TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (poll_id) REFERENCES polls(id),
            FOREIGN KEY (participant_id) REFERENCES participants(id)
        );
    `);
}

initializeDatabase();

export const getDb = () => db;

export const createTrip = (chat_id, name, destination, start_date, end_date) => {
    const stmt = db.prepare('INSERT INTO trips (chat_id, name, destination, start_date, end_date) VALUES (?, ?, ?, ?, ?)');
    return stmt.run(chat_id, name, destination, start_date, end_date).lastInsertRowid;
};

export const getTripByChatId = (chat_id) => {
    return db.prepare('SELECT * FROM trips WHERE chat_id = ?').get(chat_id);
};

export const createParticipant = (trip_id, sender_id, name) => {
    const stmt = db.prepare('INSERT INTO participants (trip_id, sender_id, name) VALUES (?, ?, ?) ON CONFLICT(sender_id) DO UPDATE SET name=excluded.name');
    return stmt.run(trip_id, sender_id, name).lastInsertRowid;
};

export const getParticipantBySenderId = (sender_id) => {
    return db.prepare('SELECT * FROM participants WHERE sender_id = ?').get(sender_id);
};

export const createPoll = (trip_id, message_id, question, options) => {
    const stmt = db.prepare('INSERT INTO polls (trip_id, message_id, question, options) VALUES (?, ?, ?, ?)');
    return stmt.run(trip_id, message_id, question, JSON.stringify(options)).lastInsertRowid;
};

export const getPollByMessageId = (message_id) => {
    const poll = db.prepare('SELECT * FROM polls WHERE message_id = ?').get(message_id);
    if (poll) poll.options = JSON.parse(poll.options);
    return poll;
};

export const recordVote = (poll_id, participant_id, option_emoji) => {
    const stmt = db.prepare('INSERT INTO votes (poll_id, participant_id, option_emoji) VALUES (?, ?, ?)');
    return stmt.run(poll_id, participant_id, option_emoji).lastInsertRowid;
};

export const getVotesForPoll = (poll_id) => {
    return db.prepare('SELECT p.name AS participant_name, v.option_emoji FROM votes v JOIN participants p ON v.participant_id = p.id WHERE v.poll_id = ?').all(poll_id);
};

export const closePoll = (poll_id) => {
    db.prepare('UPDATE polls SET status = "closed" WHERE id = ?').run(poll_id);
};

export const getActivePollByChatId = (chatId) => {
    const poll = db.prepare(`
        SELECT p.* FROM polls p
        JOIN trips t ON p.trip_id = t.id
        WHERE t.chat_id = ? AND p.status = 'open'
        ORDER BY p.created_at DESC LIMIT 1
    `).get(chatId);
    if (poll) poll.options = JSON.parse(poll.options);
    return poll;
};
```

#### tools.js（Foursquare 地点搜索）

```javascript
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export async function foursquareSearch(query, near) {
    const apiKey = process.env.FOURSQUARE_API_KEY;
    if (!apiKey) {
        return JSON.stringify({ error: 'FOURSQUARE_API_KEY is not set in .env' });
    }

    const params = { query, limit: 5 };
    if (near) params.near = near;

    try {
        const response = await axios.get('https://api.foursquare.com/v3/places/search', {
            headers: { Authorization: apiKey, Accept: 'application/json' },
            params,
        });

        const places = response.data.results.map(p => ({
            name: p.name,
            address: p.location?.formatted_address || p.location?.address || 'No address',
            categories: p.categories?.map(c => c.name).join(', ') || 'N/A',
            distance: p.distance,
        }));

        return JSON.stringify(places);
    } catch (error) {
        return JSON.stringify({ error: error.message });
    }
}
```

#### package.json

```json
{
  "name": "trip-planner-bot",
  "version": "1.0.0",
  "type": "module",
  "main": "imessageAgent.js",
  "scripts": { "test": "jest" },
  "dependencies": {
    "@photon-ai/imessage-kit": "^2.1.2",
    "axios": "^1.14.0",
    "better-sqlite3": "^12.8.0",
    "dotenv": "^16.4.5",
    "openai": "^4.0.0"
  },
  "devDependencies": {
    "@babel/preset-env": "^7.29.2",
    "babel-jest": "^30.3.0",
    "jest": "^30.3.0"
  }
}
```

---

## 二、目标：转型为 iMessage App Extension

我想把这个纯文本机器人变成一个 **原生 iOS iMessage App Extension**，类似于 GamePigeon 那样的 iMessage 小应用——用户可以在 iMessage 的应用抽屉中点击打开，有交互式 UI 界面，发送的内容以可点击的交互式气泡呈现在聊天中。

### 前提条件（已满足）

- 我已有 Apple Developer 账号（年度付费会员）
- 我有 Mac 可以使用 Xcode 开发

---

## 三、目标架构

```
┌─────────────────────────────────────┐
│  iMessage App Extension (Swift/SwiftUI)  │  ← 新建，运行在 iOS 设备
│                                           │
│  Compact 模式（键盘上方半屏）:              │
│  ├─ AI 对话输入框                         │
│  ├─ 快速地点搜索                          │
│  └─ 发起投票按钮                          │
│                                           │
│  Expanded 模式（全屏）:                    │
│  ├─ 旅行详情面板                          │
│  ├─ 投票界面（创建 + 投票）                │
│  ├─ 地点搜索结果列表                      │
│  └─ 行程总览                              │
│                                           │
│  发送 Interactive Message Bubble:          │
│  ├─ 投票卡片（其他人点击可投票）            │
│  ├─ 地点推荐卡片                          │
│  └─ 旅行摘要卡片                          │
└──────────────┬────────────────────────────┘
               │ HTTPS REST API
               ▼
┌─────────────────────────────────────┐
│  Backend Server (Node.js)            │  ← 改造现有代码
│                                      │
│  POST /api/chat                      │  → AI 对话 (Minimax API)
│  GET  /api/search?q=...&near=...     │  → Foursquare 地点搜索
│  POST /api/trips                     │  → 创建旅行
│  GET  /api/trips/:chatId             │  → 获取旅行
│  POST /api/polls                     │  → 创建投票
│  POST /api/polls/:id/vote            │  → 记录投票
│  GET  /api/polls/:id/results         │  → 获取投票结果
│                                      │
│  数据库: PostgreSQL 或 SQLite         │
│  部署: Railway / Render / Vercel     │
└──────────────────────────────────────┘
```

---

## 四、开发步骤（按顺序执行）

### 第 1 步：创建 Xcode 项目 + 跑通空白 iMessage Extension

1. 打开 Xcode → File → New → Project → iOS → App
2. Product Name: `TripPlanner`，Team 选 Apple Developer 账号，Interface: SwiftUI，Language: Swift
3. File → New → Target → iOS → iMessage Extension，Product Name: `TripPlannerMessages`
4. 选择 `TripPlannerMessages` scheme，在 iPhone 模拟器上运行
5. 验证能在 Messages 模拟器的应用抽屉中看到扩展图标

### 第 2 步：构建基础 UI

在 iMessage Extension 中实现基础界面：

**MessagesViewController（继承 MSMessagesAppViewController）：**
- Compact 模式：显示一个简单的「新建旅行」和「搜索地点」按钮
- Expanded 模式：显示完整交互界面
- 使用 SwiftUI 通过 UIHostingController 嵌入

**关键 Apple Framework：**
- `Messages` — MSMessagesAppViewController, MSMessage, MSMessageTemplateLayout
- `MessagesUI` — UI 相关

**交互式消息气泡（MSMessage + MSMessageTemplateLayout）：**
- 投票卡片：显示问题 + 选项，收件人点击可打开投票界面
- 地点卡片：显示搜索到的地点信息
- 旅行摘要卡片：显示旅行名称、目的地、日期

### 第 3 步：改造 Node.js 后端为 REST API

将现有代码改造为 Express/Fastify REST API 服务器：
- 移除 `@photon-ai/imessage-kit` 依赖和相关代码
- 移除 `messageHandlers.js`（路由逻辑由 iOS 端处理）
- 添加 Express 框架，暴露 REST API 端点
- 保留 Minimax AI 调用逻辑、Foursquare 搜索、数据库操作
- 添加基础认证（API Key 或 JWT）
- 部署到云服务器

### 第 4 步：iOS 端连接后端 API

- 在 Swift 中创建 `APIService` 网络层
- 使用 URLSession 调用后端 REST API
- 将 API 返回数据绑定到 SwiftUI 视图

### 第 5 步：完善交互体验

- 投票流程：创建投票 → 发送投票卡片到群聊 → 其他人点击卡片投票 → 实时更新结果
- 地点搜索：输入搜索 → 展示结果列表 → 选择后发送地点卡片到聊天
- AI 对话：输入问题 → 调用后端 AI → 展示回复（可选：以卡片形式发送）

### 第 6 步：TestFlight 测试 + App Store 上架

- Archive → 上传到 App Store Connect
- 添加 TestFlight 测试人员
- 测试通过后提交审核

---

## 五、关键技术参考

### iMessage Extension 核心代码结构

```swift
import Messages

class MessagesViewController: MSMessagesAppViewController {

    // 当扩展变为活跃状态
    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        // 根据 presentationStyle 显示不同 UI
        presentViewController(for: presentationStyle)
    }

    // 展示模式变化（compact ↔ expanded）
    override func willTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        presentViewController(for: presentationStyle)
    }

    // 收到消息（其他人点击了交互式卡片）
    override func didReceive(_ message: MSMessage, conversation: MSConversation) {
        // 解析 message.url 中的数据，显示对应界面
    }

    func presentViewController(for presentationStyle: MSMessagesAppPresentationStyle) {
        // compact: 显示简洁按钮
        // expanded: 显示完整 UI
    }

    // 发送交互式消息
    func sendInteractiveMessage(in conversation: MSConversation) {
        let message = MSMessage(session: MSSession())
        let layout = MSMessageTemplateLayout()
        layout.caption = "Trip Poll: Where should we go?"
        layout.subcaption = "Tap to vote"
        layout.image = UIImage(named: "poll_icon")

        // 通过 URL 传递数据
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "type", value: "poll"),
            URLQueryItem(name: "pollId", value: "123"),
        ]
        message.url = components.url!
        message.layout = layout

        conversation.insert(message) { error in
            if let error = error { print("Error: \(error)") }
        }
    }
}
```

### SwiftUI 嵌入 iMessage Extension

```swift
import SwiftUI
import UIKit

// 在 MessagesViewController 中嵌入 SwiftUI 视图
func presentViewController(for presentationStyle: MSMessagesAppPresentationStyle) {
    removeAllChildViewControllers()

    let view: AnyView
    switch presentationStyle {
    case .compact:
        view = AnyView(CompactView())
    case .expanded:
        view = AnyView(ExpandedView())
    default:
        view = AnyView(CompactView())
    }

    let hostingController = UIHostingController(rootView: view)
    addChild(hostingController)
    hostingController.view.frame = self.view.bounds
    hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    self.view.addSubview(hostingController.view)
    hostingController.didMove(toParent: self)
}

func removeAllChildViewControllers() {
    for child in children {
        child.willMove(toParent: nil)
        child.view.removeFromSuperview()
        child.removeFromParent()
    }
}
```

### API 网络层示例

```swift
class APIService {
    static let shared = APIService()
    private let baseURL = "https://your-backend-url.com/api"

    func searchPlaces(query: String, near: String?) async throws -> [Place] {
        var components = URLComponents(string: "\(baseURL)/search")!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        if let near = near {
            components.queryItems?.append(URLQueryItem(name: "near", value: near))
        }

        let (data, _) = try await URLSession.shared.data(from: components.url!)
        return try JSONDecoder().decode([Place].self, from: data)
    }

    func chat(message: String, chatId: String) async throws -> ChatResponse {
        var request = URLRequest(url: URL(string: "\(baseURL)/chat")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["message": message, "chatId": chatId])

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(ChatResponse.self, from: data)
    }
}
```

---

## 六、环境变量 / API Keys

后端服务器需要以下环境变量：

```
MINIMAX_API_KEY=<你的 Minimax API Key>
FOURSQUARE_API_KEY=<你的 Foursquare API Key>
```

---

## 七、第一步指令

请从**第 1 步**开始：在 Xcode 中创建项目并添加 iMessage Extension target。创建完成后，帮我实现一个最简单的交互式投票卡片作为 PoC（概念验证）——用户点击扩展后看到一个「创建投票」按钮，填写问题和选项后，发送一个交互式气泡到聊天中，其他人点击气泡可以投票。

先不需要连接后端，用本地 mock 数据即可。等这个 PoC 跑通后，我们再接入后端 API。
