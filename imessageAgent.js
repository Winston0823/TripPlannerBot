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
            description: 'Create a poll to gather group input. Use when you need consensus on choices like destination, dates, restaurants, or activities.',
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
                    error: 'No trip exists for this chat yet. Create a trip first, or just discuss — a trip can be created once the group decides on a destination.',
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
    const chatId = context.chatId || `dm_${context.sender || 'unknown'}`;
    const senderName = context.senderName || context.sender || 'User';

    // Normalize context so executeTool always has a valid chatId
    context = { ...context, chatId };

    const userContent = context.chatId && !context.chatId.startsWith('dm_')
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
