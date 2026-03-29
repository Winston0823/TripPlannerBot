import { IMessageSDK } from '@photon-ai/imessage-kit';
import axios from 'axios';
import { AdvancedIMessageKit, isPollMessage, isPollVote, parsePollVotes, parsePollDefinition } from '@photon-ai/advanced-imessage-kit';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { onDirectMessage, onGroupMessage, sendToGroupChat } from './messageHandlers.js';
import { geminiResearch, appleMapSearch, generateItineraryPlan, editItineraryDayPlan } from './tools.js';
import { startExtensionWatcher, stopExtensionWatcher } from './extensionWatcher.js';
import { startApiServer } from './apiServer.js';
import {
    STAGES,
    createTrip, getTripByChatId,
    createParticipant, getParticipantBySenderId,
    createPoll, getActivePollByChatId,
    recordVote, getVotesForPoll, closePoll,
    getParticipantsByTripId, getPollsByTripId,
    getTripStage, advanceStage, isOrganizer,
    setFreeDayCount, setRoughSchedule,
    createStop, getStopsByTripId, updateStop,
    getAggregatedPreferences, getPreferenceVariance,
    upsertPreferences, hasSubmittedPreferences,
    getItinerary, createItineraryDay, addItineraryItem, clearItinerary,
    getItineraryDay, clearItineraryDay,
    eliminateOption, isEliminated, getEliminatedOptions,
    updatePollOptions, deleteTrip, reopenStage, getDb,
    addConversationMessage, getConversationHistory, trimConversationHistory,
    getGroupChatMembers
} from './database.js';

if (process.env.NODE_ENV !== 'test') {
    dotenv.config();
}

const sdk = new IMessageSDK({ debug: true });

const openai = new OpenAI({
    apiKey: process.env.MINIMAX_API_KEY,
    baseURL: 'https://api.minimax.io/v1',
    timeout: 45000, // 45s timeout per request
});

// --- BlueBubbles Private API (native polls, reactions, effects) ---
let advancedSdk = null;

async function initBlueBubbles() {
    const serverUrl = process.env.BLUEBUBBLES_URL;
    const password = process.env.BLUEBUBBLES_API_KEY;
    if (!serverUrl || !password) {
        console.log('BlueBubbles not configured — native polls disabled. Set BLUEBUBBLES_URL and BLUEBUBBLES_API_KEY in .env');
        return;
    }
    try {
        // Don't pass apiKey — that triggers SDK's { apiKey } socket auth which BB rejects.
        // Instead, use no apiKey (legacy mode) and inject password via socket query params.
        advancedSdk = new AdvancedIMessageKit({ serverUrl, logLevel: 'warn' });

        // BlueBubbles authenticates via query param, not socket auth
        advancedSdk.socket.io.opts.query = { password };

        // Also patch HTTP client for REST calls (polls, messages, etc.)
        advancedSdk.http.defaults.params = { password };

        // Wait for the 'ready' event to confirm full connection
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timed out'));
            }, 10000);

            advancedSdk.on('ready', () => {
                clearTimeout(timeout);
                resolve();
            });

            advancedSdk.connect().catch(reject);
        });

        console.log('BlueBubbles Private API connected — native polls enabled');
        setupPollVoteListener();
    } catch (err) {
        console.error('BlueBubbles connection failed — falling back to text polls:', err.message);
        advancedSdk = null;
    }
}

function chatGuid(chatId) {
    if (chatId.startsWith('iMessage;')) return chatId;
    return `iMessage;+;${chatId}`;
}

function setupPollVoteListener() {
    if (!advancedSdk) return;

    advancedSdk.on('new-message', (msg) => {
        try {
            if (!isPollVote(msg)) return;

            const voteData = parsePollVotes(msg);
            if (!voteData?.votes?.length) return;

            const rawChatGuid = msg.chats?.[0]?.guid || msg.chatGuid;
            if (!rawChatGuid) return;

            const chatId = rawChatGuid.replace(/^iMessage;\+;/, '');
            const trip = getTripByChatId(chatId);
            if (!trip) return;

            const activePoll = getActivePollByChatId(chatId);
            if (!activePoll) return;

            for (const vote of voteData.votes) {
                const handle = vote.participantHandle;
                let participant = getParticipantBySenderId(handle, trip.id);
                if (!participant) {
                    const pId = createParticipant(trip.id, handle, handle);
                    participant = { id: pId };
                }

                const pollDef = parsePollDefinition(msg);
                if (!pollDef) continue;

                const votedOption = pollDef.options.find(o => o.optionIdentifier === vote.voteOptionIdentifier);
                if (!votedOption) continue;

                const matchedOption = activePoll.options.find(o => o.text === votedOption.text);
                if (!matchedOption) continue;

                recordVote(activePoll.id, participant.id, matchedOption.emoji);
                console.log(`Poll vote synced: ${handle} → "${matchedOption.text}"`);
            }

            // Check auto-close
            const allVotes = getVotesForPoll(activePoll.id);
            const totalMembers = getParticipantsByTripId(trip.id).length;

            if (allVotes.length >= totalMembers && totalMembers > 0) {
                const tally = {};
                for (const v of allVotes) {
                    tally[v.option_emoji] = (tally[v.option_emoji] || 0) + 1;
                }
                const maxCount = Math.max(...Object.values(tally));
                const winners = Object.entries(tally).filter(([, c]) => c === maxCount);

                if (winners.length === 1) {
                    const winEmoji = winners[0][0];
                    const winOption = activePoll.options.find(o => o.emoji === winEmoji);
                    closePoll(activePoll.id, winOption.text);
                    for (const opt of activePoll.options) {
                        if (opt.emoji !== winEmoji) {
                            eliminateOption(trip.id, trip.stage, opt.text);
                        }
                    }
                    sendToGroupChat(chatId, `Poll closed! "${winOption.text}" wins!`);
                } else {
                    const tiedNames = winners.map(([emoji]) =>
                        activePoll.options.find(o => o.emoji === emoji)?.text
                    ).filter(Boolean);
                    sendToGroupChat(chatId, `Poll tied between ${tiedNames.join(' and ')}. Organizer, break the tie.`);
                }
            }
        } catch (err) {
            console.error('Poll vote listener error:', err.message);
        }
    });
}

console.log('iMessage AI Agent started...');

// --- Conversation History (persisted to SQLite) ---
const MAX_HISTORY = 10;

function getHistory(chatId) {
    return getConversationHistory(chatId, MAX_HISTORY);
}

function addToHistory(chatId, role, content) {
    if (!content) return;
    addConversationMessage(chatId, role, content);
    trimConversationHistory(chatId, MAX_HISTORY);
}

// --- System Prompt: Core + Stage-Scoped ---
const CORE_PROMPT = `You are a trip planning agent in an iMessage group chat. You see all messages (prefixed [SenderName]) but only respond when @mentioned. Keep messages short (1-2 sentences or bullet lists). Emojis only at line start.

CRITICAL RULES:
- NEVER mention tool names, function names, or commands to users. Respond to natural language only.
- When users say "close poll", "move on", "next", "skip" — YOU call the tool. Never ask them to type commands.
- When a poll has a clear winner (majority votes), YOU close it automatically. Only escalate ties to organizer.
- AUTO-PROGRESS: When a stage completes, YOU advance and begin the next stage immediately.
- NEVER reveal individual preference scores. Only show aggregates. Organizer is NOT exempt.
- NEVER create a poll if one is already open.
- ALL suggestions must come from real-time web search (geminiResearch), not training data.
- ALWAYS include Apple Maps or website links with every venue/place suggestion.
- For flights, include search links (Google Flights, Kayak) with approximate prices.
- JOIN CODE: Every trip has a join code (6 chars). When asked for "join code", "trip code", or "extension code", use getTripOverview to get it and share it. It links the TripPlanner Extension/App to this trip.

ROLES:
- ORGANIZER: First to interact. Sets destination, dates, levers. Can override votes. /organizer @name to reassign.
- MEMBER: Votes, submits prefs, proposes options, declares transport.
- AGENT (you): Research, suggest, tally, auto-handle logistics, build itinerary.

PIPELINE: setup → preferences → activity_types → venues → day_assignment → logistics → review → booked

VOTING: Majority rules. Tie → organizer decides. Zero votes → agent picks best match to prefs + explains. Multi-select for activity types (vote 2-3). Voted-out options gone forever unless organizer re-adds.

ORGANIZER-ONLY TOOLS: setFreeDays, setLocationConfidence, setSchedule, advanceStage, closePollWithResult, organizerOverride, deleteTrip, approveItinerary, reopenStage, setTransport`;

const STAGE_PROMPTS = {
    setup: `SETUP RULES:
- Ask for destination and dates. BOTH required before proceeding.
- Accept optional levers: free day count, locked locations, rough schedule.
- Confirmed locations → show as locked, no vote. Organizer options → vote on those only. Open → web search later.
- After foundation confirmed, ask "Where is everyone coming from?" Research travel options (flights + prices for long distance). Present BEFORE activities.
- Then collect transport: cars, seats, rental needs, designated drivers, departure points.
- Short trips (1-2 days): skip destination stage, no free days, weight budget+adventure higher.`,

    preferences: `PREFERENCES RULES:
- Post preference bubble. Collect 3 scores: pace (1-5), budget (1-5), adventure (1-5).
- Submissions are silent. NEVER post individual values in chat.
- Show only "X of Y responded". Compute averages, round to 1 decimal.
- stddev > 1.5 → note to organizer "Group split on [dim]". Zero responses → use 3/3/3.`,

    activity_types: `ACTIVITY TYPES RULES:
- Immediately use geminiResearch to find activity categories for the destination.
- Present numbered list. Members vote for top 2-3 (multi-select). Top 2-3 by votes advance.
- Members can propose additions. Scale: 1-2 days → 4-6 options; 3-5 days → 6-8; 6+ → 8-10.
- Filter by prefs: budget 1-2 → no luxury. Adventure 1-2 → no niche/experimental.
- Batch all options in ONE message.`,

    venues: `VENUE RULES:
- For each winning activity type, immediately research specific venues via geminiResearch.
- Present numbered poll with: name, one-line description, direct link (Apple Maps or website URL).
- Include map links for every venue. Members can propose additions.
- Scale options by trip length. Filter through aggregated prefs.
- Check parking at each venue. Flag no-parking; suggest rideshare.`,

    day_assignment: `DAY ASSIGNMENT RULES:
- Use generateItinerary to create day-by-day plan from stops, poll winners, preferences.
- Present as soft plan. Encourage edits ("edit day 2: swap lunch").
- Free days: if not set, infer from pace (1-2→30-40% free, 3→15-20%, 4-5→0-10%).
- Free days have NO mandatory items. Generate 4-6 optional low-effort suggestions each.
- Distinguish [Confirmed] vs [Group choice] stops.`,

    logistics: `LOGISTICS RULES:
- Research hotels, distances, transport between stops.
- Calculate seats vs group. Shortfall → rental search links.
- Designated drivers → flag alcohol venues when DD < cars. Never assume drinking.
- Split departures → calc drive times, use longest for Day 1 start.
- Flights/trains → search links in booking output. Constrain Day 1/final day.
- Carpooling assignment if multiple cars. Include per-leg transport notes.
- Post as FYI messages, not polls. Skip transport if data not provided.`,

    review: `REVIEW RULES:
- Assemble final itinerary. One block per day: stops, times, transport notes, parking, reservations.
- Carpooling in header per day. Editable until booking links sent.
- After group confirms: post booking links per venue (name, URL, deadline). Include rental/flight/train.
- If organizer reopens prior stage: invalidate downstream, re-run from that point.`,

    booked: `BOOKED: Trip is finalized. Answer questions about the itinerary. Notify of any changes.`,
};

function getSystemPrompt(stage) {
    const stageRules = STAGE_PROMPTS[stage] || STAGE_PROMPTS.setup;
    return `${CORE_PROMPT}\n\nCURRENT STAGE: ${stage}\n${stageRules}`;
}

// --- Trip State Injection ---
function buildTripContext(chatId) {
    const trip = getTripByChatId(chatId);
    if (!trip) return null;

    const parts = [`[TRIP STATE] ${trip.name || 'Untitled'} | Stage: ${trip.stage} | Dest: ${trip.destination || '?'}`];
    if (trip.start_date || trip.end_date) parts[0] += ` | ${trip.start_date || '?'} → ${trip.end_date || '?'}`;

    const participants = getParticipantsByTripId(trip.id);
    const organizer = participants.find(p => p.role === 'organizer');
    parts.push(`Members: ${participants.length} | Organizer: ${organizer?.name || organizer?.sender_id || '?'}`);

    const prefs = getAggregatedPreferences(trip.id);
    if (prefs.response_count > 0) {
        parts.push(`Prefs (${prefs.response_count}): Pace ${prefs.avg_pace} Budget ${prefs.avg_budget} Adventure ${prefs.avg_adventure}`);
    }

    const stops = getStopsByTripId(trip.id);
    if (stops.length) {
        parts.push(`Stops: ${stops.map(s => `${s.name}[${s.confidence}]`).join(', ')}`);
    }

    const activePoll = getActivePollByChatId(chatId);
    if (activePoll) {
        const votes = getVotesForPoll(activePoll.id);
        const tally = {};
        for (const v of votes) tally[v.option_emoji] = (tally[v.option_emoji] || 0) + 1;
        const optSummary = activePoll.options.map(o => `${o.emoji}${o.text}(${tally[o.emoji] || 0})`).join(' ');
        parts.push(`Active poll: "${activePoll.question}" — ${optSummary} [${votes.length}/${participants.length} voted]`);
    }

    if (trip.free_day_count) parts.push(`Free days: ${trip.free_day_count}`);

    return parts.join('\n');
}

// --- Tool Result Compression ---
function compressToolResult(toolName, result) {
    if (!result || result.length <= 1500) return result;

    // Try to compress JSON arrays (Gemini research results)
    if (toolName === 'geminiResearch') {
        try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
                const compressed = parsed.map(item => ({
                    name: item.name,
                    category: item.category,
                    description: item.description?.substring(0, 80),
                    url: item.url,
                    price_level: item.price_level,
                }));
                return JSON.stringify(compressed);
            }
            // Object result (safety, distances) — stringify and truncate
            return JSON.stringify(parsed).substring(0, 1500);
        } catch {
            // Not JSON — truncate raw text
        }
    }

    return result.substring(0, 1500) + '... [truncated]';
}

// --- Tool Definitions ---
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

const tools = [
    {
        type: 'function',
        function: {
            name: 'geminiResearch',
            description: 'Research tool powered by Gemini AI. Use for finding places, checking safety, finding hotels/Airbnbs, estimating distances, or general travel research.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'What to research (e.g. "best ramen spots", "hotels under $150", "is it safe at night")' },
                    location: { type: 'string', description: 'Location context (e.g. "Tokyo, Japan", "downtown Palm Springs")' },
                    research_type: {
                        type: 'string',
                        enum: ['places', 'safety', 'hotels', 'distances', 'general'],
                        description: 'Type of research: places (restaurants/attractions/activities), safety (area safety check), hotels (hotels/Airbnbs/hostels), distances (travel times between stops), general (anything else)',
                    },
                },
                required: ['query', 'research_type'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'appleMapSearch',
            description: 'Search for places using Apple Maps. Returns Apple Maps links for locations. Use when you need map links or structured location data.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'What to search for' },
                    near: { type: 'string', description: 'Location to search near' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'createTrip',
            description: 'Create a new trip for this group chat. The person who triggers this becomes the organizer. Requires destination; dates are optional but recommended.',
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
            description: 'Create a poll to gather group input on subjective decisions.',
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
            description: "Record a vote from the current message sender on the active poll.",
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
    {
        type: 'function',
        function: {
            name: 'getTripOverview',
            description: 'Get full trip status — stage, destination, dates, participants, preferences, stops, and polls.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'setFreeDays',
            description: 'Organizer only. Set the number of free/unstructured days in the trip. Free days get optional suggestions but no mandatory schedule.',
            parameters: {
                type: 'object',
                properties: {
                    count: { type: 'number', description: 'Number of free days (0 or more)' },
                },
                required: ['count'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'setLocationConfidence',
            description: 'Organizer only. Set a stop/location and how confident the organizer is about it. "confirmed" = locked in, no vote. "options" = organizer provides 2-3 candidates for the group to vote on. "open" = agent searches and suggests.',
            parameters: {
                type: 'object',
                properties: {
                    stop_name: { type: 'string', description: 'Name of the stop or location' },
                    confidence: {
                        type: 'string',
                        enum: ['confirmed', 'options', 'open'],
                        description: 'How decided this stop is',
                    },
                    day_number: { type: 'number', description: 'Which day to assign this stop to (optional)' },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'If confidence is "options", the 2-3 candidates to vote on',
                    },
                },
                required: ['stop_name', 'confidence'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'setSchedule',
            description: 'Organizer only. Pre-assign specific stops or activities to specific days. Agent fills unassigned days during the planning funnel.',
            parameters: {
                type: 'object',
                properties: {
                    schedule: {
                        type: 'object',
                        description: 'Map of day numbers to stop/activity names, e.g. {"1": "Arrival + Shibuya", "3": "Day trip to Hakone"}',
                    },
                },
                required: ['schedule'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'advanceStage',
            description: 'Organizer only. Move the trip to the next planning stage. Use when the current stage is complete.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'submitPreferences',
            description: 'Record a member\'s preference scores. Use when someone shares their pace/budget/adventure numbers. Members can update by submitting again.',
            parameters: {
                type: 'object',
                properties: {
                    pace: { type: 'number', description: '1 (full rest) to 5 (packed schedule)' },
                    budget: { type: 'number', description: '1 (budget) to 5 (luxury)' },
                    adventure: { type: 'number', description: '1 (safe/familiar) to 5 (experimental)' },
                },
                required: ['pace', 'budget', 'adventure'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'closePollWithResult',
            description: 'Organizer only. Close the active poll and declare the winning option. Use after all votes are in or to finalize a result.',
            parameters: {
                type: 'object',
                properties: {
                    winning_option_number: {
                        type: 'number',
                        description: 'The 1-based option number that won (based on majority votes)',
                    },
                },
                required: ['winning_option_number'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'addPollOption',
            description: 'Add a new option to the active poll. Any member can propose. Rejects duplicates and previously eliminated options.',
            parameters: {
                type: 'object',
                properties: {
                    option_text: { type: 'string', description: 'The new option to add' },
                },
                required: ['option_text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'organizerOverride',
            description: 'Organizer only. Override the active poll by directly choosing one of the existing options. Closes the poll and posts a notification.',
            parameters: {
                type: 'object',
                properties: {
                    option_number: {
                        type: 'number',
                        description: 'The 1-based option number the organizer is choosing',
                    },
                },
                required: ['option_number'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'deleteTrip',
            description: 'Organizer only. Delete the current trip and all associated data. Use if a trip was created by mistake.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'reopenStage',
            description: 'Organizer only. Reopen a prior planning stage. Invalidates all downstream polls/decisions from that stage forward and re-runs the funnel from that point.',
            parameters: {
                type: 'object',
                properties: {
                    target_stage: {
                        type: 'string',
                        enum: ['setup', 'preferences', 'activity_types', 'venues', 'day_assignment', 'logistics', 'review'],
                        description: 'Which stage to reopen',
                    },
                },
                required: ['target_stage'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'setTransport',
            description: 'Organizer declares transport details: total cars, seat capacity per car, rental needs, designated drivers, and departure points. Collected during setup.',
            parameters: {
                type: 'object',
                properties: {
                    cars: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                owner: { type: 'string', description: 'Name of car owner' },
                                seats: { type: 'number', description: 'Seat capacity including driver' },
                            },
                            required: ['owner', 'seats'],
                        },
                        description: 'List of available cars with owner and seat count',
                    },
                    needs_rental: { type: 'boolean', description: 'Whether any member needs a rental car' },
                    designated_drivers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Names of designated drivers',
                    },
                    departure_points: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                member: { type: 'string' },
                                location: { type: 'string' },
                            },
                        },
                        description: 'If members depart from different locations',
                    },
                },
                required: ['cars'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'reassignOrganizer',
            description: 'Reassign the organizer role to a different member. Any member can call this with /organizer @username. Permanent once set.',
            parameters: {
                type: 'object',
                properties: {
                    new_organizer_name: { type: 'string', description: 'Name or handle of the new organizer' },
                },
                required: ['new_organizer_name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'generateItinerary',
            description: 'Generate a full day-by-day itinerary from confirmed stops, poll winners, and group preferences. Use during the day_assignment stage. Presents a soft plan that can be edited day by day.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'editItineraryDay',
            description: 'Edit a specific day in the itinerary. Use when a member wants to swap, add, remove, or reorder items on a particular day.',
            parameters: {
                type: 'object',
                properties: {
                    day_number: { type: 'number', description: 'Which day to edit (1-based)' },
                    instruction: { type: 'string', description: 'What to change (e.g. "swap lunch for something cheaper", "add a coffee shop in the morning")' },
                },
                required: ['day_number', 'instruction'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'getFullItinerary',
            description: 'Get the current full itinerary with all days and items. Use to show the group the current plan.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'approveItinerary',
            description: 'Organizer only. Lock in the itinerary and advance to the logistics stage. Use when the group is happy with the plan.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
];

// --- Tool Execution ---
async function executeTool(toolCall, context) {
    const { name } = toolCall.function;
    const args = JSON.parse(toolCall.function.arguments);
    const { chatId, sender, senderName } = context;

    // Organizer-only tools
    const organizerTools = ['setFreeDays', 'setLocationConfidence', 'setSchedule', 'advanceStage', 'closePollWithResult', 'organizerOverride', 'deleteTrip', 'approveItinerary', 'reopenStage', 'setTransport'];
    if (organizerTools.includes(name)) {
        const trip = getTripByChatId(chatId);
        if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });
        if (!isOrganizer(trip.id, sender)) {
            return JSON.stringify({ error: 'Only the organizer can use this command.' });
        }
    }

    switch (name) {
        case 'geminiResearch':
            return await geminiResearch(args.query, args.location, args.research_type);

        case 'appleMapSearch':
            return await appleMapSearch(args.query, args.near);

        case 'createTrip': {
            const existing = getTripByChatId(chatId);
            if (existing) {
                return JSON.stringify({
                    error: `A trip already exists for this chat: "${existing.name}" to ${existing.destination}`,
                });
            }
            const tripId = createTrip(
                chatId, args.name, args.destination,
                args.start_date || null, args.end_date || null,
                sender
            );
            createParticipant(tripId, sender, senderName || sender, 'organizer');

            // Auto-register all group chat members as participants
            if (!chatId.startsWith('dm_')) {
                const chatGuid = `iMessage;+;${chatId}`;
                const members = getGroupChatMembers(chatGuid);
                for (const memberId of members) {
                    if (memberId !== sender) {
                        createParticipant(tripId, memberId, memberId, 'member');
                        console.log(`Auto-registered group member: ${memberId}`);
                    }
                }
            }

            // Auto-research safety for the destination
            let safetyInfo = null;
            try {
                const safetyResult = await geminiResearch(
                    `tourist safety in ${args.destination}`,
                    args.destination,
                    'safety'
                );
                const cleaned = safetyResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                safetyInfo = JSON.parse(cleaned);
            } catch {
                // Safety check failed — non-blocking, continue
            }

            // Get the join code for the Extension
            const createdTrip = getTripByChatId(chatId);
            const joinCode = createdTrip?.join_code || '';

            return JSON.stringify({
                success: true, tripId,
                name: args.name, destination: args.destination,
                start_date: args.start_date || null,
                end_date: args.end_date || null,
                organizer: senderName || sender,
                stage: 'setup',
                joinCode,
                safety: safetyInfo,
                message: `Trip created. You are the organizer. Join code for the TripPlanner app: ${joinCode}\n\nShare the safety summary with the group, then ask about optional setup: free day count, must-visit stops, or rough schedule. Say "done with setup" when ready.`,
            });
        }

        case 'setFreeDays': {
            const trip = getTripByChatId(chatId);
            setFreeDayCount(trip.id, args.count);
            return JSON.stringify({
                success: true,
                free_day_count: args.count,
            });
        }

        case 'setLocationConfidence': {
            const trip = getTripByChatId(chatId);
            const type = args.confidence === 'confirmed' ? 'confirmed' : 'proposed';
            const stopId = createStop(trip.id, args.stop_name, args.confidence, args.day_number || null, type);

            if (args.confidence === 'options' && args.options?.length) {
                updateStop(stopId, { venues: args.options.map(o => ({ name: o })) });
            }

            return JSON.stringify({
                success: true,
                stop: args.stop_name,
                confidence: args.confidence,
                day: args.day_number || null,
                note: args.confidence === 'confirmed'
                    ? `${args.stop_name} is locked in.`
                    : args.confidence === 'options'
                    ? `${args.stop_name} has ${args.options?.length || 0} candidates — will be voted on.`
                    : `${args.stop_name} is open — agent will search for suggestions.`,
            });
        }

        case 'setSchedule': {
            const trip = getTripByChatId(chatId);
            setRoughSchedule(trip.id, args.schedule);
            // Create stops for each scheduled item
            for (const [dayStr, activity] of Object.entries(args.schedule)) {
                const dayNum = parseInt(dayStr, 10);
                if (!isNaN(dayNum)) {
                    createStop(trip.id, activity, 'confirmed', dayNum, 'confirmed');
                }
            }
            return JSON.stringify({
                success: true,
                schedule: args.schedule,
            });
        }

        case 'advanceStage': {
            const trip = getTripByChatId(chatId);
            const previousStage = trip.stage;

            // When leaving preferences stage, compute and return aggregates
            if (previousStage === 'preferences') {
                const prefs = getAggregatedPreferences(trip.id);
                const variance = getPreferenceVariance(trip.id);
                const nextStage = advanceStage(trip.id);

                const result = {
                    success: true,
                    previous_stage: previousStage,
                    current_stage: nextStage,
                };

                if (prefs.response_count > 0) {
                    result.aggregated_preferences = {
                        pace: prefs.avg_pace,
                        budget: prefs.avg_budget,
                        adventure: prefs.avg_adventure,
                        response_count: prefs.response_count,
                    };
                    // Flag high variance dimensions (stddev > 1.5)
                    const splits = [];
                    if (variance.pace > 1.5) splits.push('pace');
                    if (variance.budget > 1.5) splits.push('budget');
                    if (variance.adventure > 1.5) splits.push('adventure');
                    if (splits.length) {
                        result.high_variance = splits;
                        result.note = `Group is split on: ${splits.join(', ')}. Using averages for suggestions.`;
                    }
                } else {
                    result.aggregated_preferences = { pace: 3, budget: 3, adventure: 3, response_count: 0 };
                    result.note = 'No preferences submitted. Using neutral defaults (3/3/3).';
                }
                return JSON.stringify(result);
            }

            const nextStage = advanceStage(trip.id);
            if (!nextStage) {
                return JSON.stringify({ error: 'Already at the final stage.' });
            }
            return JSON.stringify({
                success: true,
                previous_stage: previousStage,
                current_stage: nextStage,
            });
        }

        case 'submitPreferences': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });
            if (trip.stage !== 'preferences') {
                return JSON.stringify({ error: 'Preferences can only be submitted during the preferences stage.' });
            }

            // Validate scores
            for (const key of ['pace', 'budget', 'adventure']) {
                if (args[key] < 1 || args[key] > 5 || !Number.isInteger(args[key])) {
                    return JSON.stringify({ error: `${key} must be a whole number from 1 to 5.` });
                }
            }

            let participant = getParticipantBySenderId(sender, trip.id);
            if (!participant) {
                const pId = createParticipant(trip.id, sender, senderName || sender);
                participant = { id: pId };
            }

            const isUpdate = hasSubmittedPreferences(trip.id, participant.id);
            upsertPreferences(trip.id, participant.id, args.pace, args.budget, args.adventure);

            const total = getParticipantsByTripId(trip.id).length;
            const prefs = getAggregatedPreferences(trip.id);

            // PRIVACY: Only return aggregate info — never individual scores or who submitted what
            return JSON.stringify({
                success: true,
                action: isUpdate ? 'updated' : 'recorded',
                responses_so_far: `${prefs.response_count} of ${total}`,
                note: 'Preferences recorded. Do NOT reveal individual scores — only say how many have responded.',
            });
        }

        case 'createPoll': {
            const trip = getTripByChatId(chatId);
            if (!trip) {
                return JSON.stringify({
                    error: 'No trip exists for this chat yet. Create a trip first.',
                });
            }
            // Only one poll at a time
            const existingPoll = getActivePollByChatId(chatId);
            if (existingPoll) {
                return JSON.stringify({
                    error: `A poll is already open: "${existingPoll.question}". Wait for it to close before creating another.`,
                });
            }
            const options = args.options.slice(0, 6).map((opt, i) => ({
                emoji: NUMBER_EMOJIS[i],
                text: opt,
            }));

            // Try native iMessage poll via Private API
            let nativePollGuid = null;
            if (advancedSdk && !chatId.startsWith('dm_')) {
                try {
                    const nativePoll = await advancedSdk.polls.create({
                        chatGuid: chatGuid(chatId),
                        title: args.question,
                        options: args.options.slice(0, 6),
                    });
                    nativePollGuid = nativePoll.guid;
                    console.log(`Native iMessage poll created: ${nativePollGuid}`);
                } catch (err) {
                    console.error('Native poll creation failed, falling back to text:', err.message);
                }
            }

            const messageId = nativePollGuid || `poll_${Date.now()}`;
            const pollId = createPoll(trip.id, messageId, args.question, options, trip.stage);

            if (nativePollGuid) {
                return JSON.stringify({
                    success: true, pollId,
                    native: true,
                    note: 'Native iMessage poll sent! Members can vote directly in the poll ballot.',
                });
            }

            // Fallback: text-based poll
            const formatted = options.map(o => `${o.emoji} ${o.text}`).join('\n');
            const voteUrl = process.env.PUBLIC_URL
                ? `${process.env.PUBLIC_URL}/vote/${pollId}`
                : `https://glorious-nourishment-production.up.railway.app/vote/${pollId}`;
            return JSON.stringify({
                success: true, pollId,
                formatted: `📊 ${args.question}\n\n${formatted}\n\nReply with the option number to vote, or tap the link for the full experience:\n${voteUrl}`,
            });
        }

        case 'recordVote': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const activePoll = getActivePollByChatId(chatId);
            if (!activePoll) return JSON.stringify({ error: 'No active poll in this chat.' });

            let participant = getParticipantBySenderId(sender, trip.id);
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
            const isMultiSelect = activePoll.stage === 'activity_types';
            recordVote(activePoll.id, participant.id, chosen.emoji, isMultiSelect);

            const allVotes = getVotesForPoll(activePoll.id);
            const totalMembers = getParticipantsByTripId(trip.id).length;
            const result = {
                success: true,
                voter: senderName || sender,
                choice: chosen.text,
                totalVotes: allVotes.length,
                totalMembers,
                summary: allVotes.map(v => `${v.participant_name}: ${v.option_emoji}`),
            };

            // Auto-close when all members have voted
            if (allVotes.length >= totalMembers && totalMembers > 0) {
                const tally = {};
                for (const v of allVotes) {
                    tally[v.option_emoji] = (tally[v.option_emoji] || 0) + 1;
                }
                const maxCount = Math.max(...Object.values(tally));
                const winners = Object.entries(tally).filter(([, c]) => c === maxCount);

                if (winners.length === 1) {
                    // Clear majority — auto-close
                    const winEmoji = winners[0][0];
                    const winOption = activePoll.options.find(o => o.emoji === winEmoji);
                    closePoll(activePoll.id, winOption.text);
                    for (const opt of activePoll.options) {
                        if (opt.emoji !== winEmoji) {
                            eliminateOption(trip.id, trip.stage, opt.text);
                        }
                    }
                    result.poll_closed = true;
                    result.winner = winOption.text;
                    result.note = `All voted. "${winOption.text}" wins! Poll closed.`;
                } else {
                    // Tie — keep open for organizer to break
                    const tiedNames = winners.map(([emoji]) =>
                        activePoll.options.find(o => o.emoji === emoji)?.text
                    ).filter(Boolean);
                    result.tie = tiedNames;
                    result.note = `Tie between: ${tiedNames.join(' and ')}. Organizer, break the tie with organizerOverride.`;
                }
            }

            return JSON.stringify(result);
        }

        case 'closePollWithResult': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const activePoll = getActivePollByChatId(chatId);
            if (!activePoll) return JSON.stringify({ error: 'No active poll to close.' });

            const optionIndex = args.winning_option_number - 1;
            if (optionIndex < 0 || optionIndex >= activePoll.options.length) {
                return JSON.stringify({ error: `Invalid option. Choose 1-${activePoll.options.length}.` });
            }

            const winner = activePoll.options[optionIndex];
            closePoll(activePoll.id, winner.text);

            for (const opt of activePoll.options) {
                if (opt.emoji !== winner.emoji) {
                    eliminateOption(trip.id, trip.stage, opt.text);
                }
            }

            return JSON.stringify({
                success: true,
                poll_question: activePoll.question,
                winner: winner.text,
                eliminated: activePoll.options.filter(o => o.emoji !== winner.emoji).map(o => o.text),
            });
        }

        case 'addPollOption': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const activePoll = getActivePollByChatId(chatId);
            if (!activePoll) return JSON.stringify({ error: 'No active poll to add to.' });

            const existing = activePoll.options.find(o => o.text.toLowerCase() === args.option_text.toLowerCase());
            if (existing) return JSON.stringify({ error: 'This option already exists in the poll.' });

            if (isEliminated(trip.id, args.option_text)) {
                return JSON.stringify({ error: 'This option was previously voted out and cannot be re-added.' });
            }

            if (activePoll.options.length >= 6) {
                return JSON.stringify({ error: 'Poll already has the maximum 6 options.' });
            }

            const newEmoji = NUMBER_EMOJIS[activePoll.options.length];
            activePoll.options.push({ emoji: newEmoji, text: args.option_text });
            updatePollOptions(activePoll.id, activePoll.options);

            // Sync to native poll if available
            if (advancedSdk && activePoll.message_id && !activePoll.message_id.startsWith('poll_')) {
                try {
                    await advancedSdk.polls.addOption({
                        chatGuid: chatGuid(chatId),
                        pollMessageGuid: activePoll.message_id,
                        optionText: args.option_text,
                    });
                } catch (err) {
                    console.error('Failed to add native poll option:', err.message);
                }
            }

            return JSON.stringify({
                success: true,
                added_by: senderName || sender,
                new_option: `${newEmoji} ${args.option_text}`,
                total_options: activePoll.options.length,
            });
        }

        case 'organizerOverride': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const activePoll = getActivePollByChatId(chatId);
            if (!activePoll) return JSON.stringify({ error: 'No active poll to override.' });

            const optionIndex = args.option_number - 1;
            if (optionIndex < 0 || optionIndex >= activePoll.options.length) {
                return JSON.stringify({ error: `Invalid option. Choose 1-${activePoll.options.length}.` });
            }

            const chosen = activePoll.options[optionIndex];
            closePoll(activePoll.id, chosen.text);

            for (const opt of activePoll.options) {
                if (opt.emoji !== chosen.emoji) {
                    eliminateOption(trip.id, trip.stage, opt.text);
                }
            }

            return JSON.stringify({
                success: true,
                poll_question: activePoll.question,
                organizer_choice: chosen.text,
                notification: `Organizer set "${chosen.text}". Vote closed.`,
            });
        }

        case 'deleteTrip': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const tripName = trip.name;
            deleteTrip(trip.id);

            return JSON.stringify({
                success: true,
                deleted: tripName,
                note: 'Trip and all associated data deleted. You can create a new trip.',
            });
        }

        case 'reopenStage': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const result = reopenStage(trip.id, args.target_stage);
            if (!result) return JSON.stringify({ error: `Invalid stage: ${args.target_stage}` });

            return JSON.stringify({
                success: true,
                reopened_to: result,
                note: `Reopened to ${result}. All downstream decisions have been invalidated. Re-running the funnel from this point.`,
            });
        }

        case 'setTransport': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const totalSeats = (args.cars || []).reduce((sum, c) => sum + (c.seats || 0), 0);
            const groupSize = getParticipantsByTripId(trip.id).length;
            const shortfall = groupSize > totalSeats;

            // Store transport data as JSON in trip rough_schedule (extend later with dedicated table)
            const transportData = {
                cars: args.cars || [],
                needs_rental: args.needs_rental || false,
                designated_drivers: args.designated_drivers || [],
                departure_points: args.departure_points || [],
                total_seats: totalSeats,
            };

            // Store in rough_schedule alongside existing data
            let schedule = trip.rough_schedule ? JSON.parse(trip.rough_schedule) : {};
            if (typeof schedule !== 'object' || Array.isArray(schedule)) schedule = { days: schedule };
            schedule.transport = transportData;
            setRoughSchedule(trip.id, schedule);

            const result = {
                success: true,
                total_seats: totalSeats,
                group_size: groupSize,
                cars: args.cars,
            };

            if (shortfall) {
                result.shortfall = true;
                result.seats_needed = groupSize - totalSeats;
                result.note = `Shortfall: ${groupSize} members but only ${totalSeats} seats. Search for rental car options before proceeding.`;
            }

            if (args.designated_drivers?.length > 0) {
                result.designated_drivers = args.designated_drivers;
                const ddCount = args.designated_drivers.length;
                const carCount = (args.cars || []).length;
                if (ddCount < carCount) {
                    result.dd_warning = `${ddCount} DD(s) for ${carCount} car(s). Flag alcohol-centric venues.`;
                }
            }

            if (args.departure_points?.length > 1) {
                result.split_departures = true;
                result.note_departures = 'Calculate drive time from each origin to first stop. Use longest as Day 1 start.';
            }

            return JSON.stringify(result);
        }

        case 'reassignOrganizer': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const participants = getParticipantsByTripId(trip.id);
            const target = participants.find(p =>
                p.name?.toLowerCase() === args.new_organizer_name?.toLowerCase() ||
                p.sender_id === args.new_organizer_name
            );
            if (!target) {
                return JSON.stringify({ error: `Member "${args.new_organizer_name}" not found in this trip.` });
            }

            // Update roles
            const db = getDb();
            db.prepare('UPDATE participants SET role = ? WHERE trip_id = ? AND role = ?').run('member', trip.id, 'organizer');
            db.prepare('UPDATE participants SET role = ? WHERE id = ?').run('organizer', target.id);
            db.prepare('UPDATE trips SET organizer_sender_id = ? WHERE id = ?').run(target.sender_id, trip.id);

            return JSON.stringify({
                success: true,
                new_organizer: target.name || target.sender_id,
                note: `${target.name} is now the organizer. This is permanent.`,
            });
        }

        case 'generateItinerary': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const stops = getStopsByTripId(trip.id);
            const prefs = getAggregatedPreferences(trip.id);
            const polls = getPollsByTripId(trip.id);

            // Collect confirmed stops + poll winners
            const confirmedStops = stops
                .filter(s => s.confidence === 'confirmed' || s.type === 'confirmed')
                .map(s => ({ name: s.name, day: s.day_number }));

            const pollWinners = polls
                .filter(p => p.status === 'closed' && p.winning_option)
                .map(p => ({ name: p.winning_option, from_poll: p.question }));

            const allStops = [...confirmedStops, ...pollWinners];

            const tripData = {
                destination: trip.destination,
                startDate: trip.start_date,
                endDate: trip.end_date,
                stops: allStops,
                preferences: prefs.response_count > 0 ? prefs : { avg_pace: 3, avg_budget: 3, avg_adventure: 3 },
                freeDayCount: trip.free_day_count,
                roughSchedule: trip.rough_schedule ? JSON.parse(trip.rough_schedule) : null,
            };

            const plan = await generateItineraryPlan(tripData);
            if (plan.error) return JSON.stringify(plan);

            // Save to DB (clear first for idempotency)
            clearItinerary(trip.id);
            for (const day of plan) {
                const dayId = createItineraryDay(
                    trip.id, day.day_number, day.date || null, day.is_free_day || false
                );
                for (let i = 0; i < (day.items || []).length; i++) {
                    const item = day.items[i];
                    addItineraryItem(
                        dayId, item.venue_name, item.time || null,
                        item.type || 'suggested', item.booking_url || null,
                        item.notes || null, i
                    );
                }
            }

            // Format for display
            const formatted = plan.map(day => {
                const dayLabel = day.is_free_day ? `Day ${day.day_number} (Free Day)` : `Day ${day.day_number}`;
                const dateStr = day.date ? ` — ${day.date}` : '';
                const items = (day.items || []).map(it =>
                    `  ${it.time || '—'} ${it.venue_name}${it.notes ? ` (${it.notes})` : ''}`
                ).join('\n');
                return `${dayLabel}${dateStr}\n${items}`;
            }).join('\n\n');

            return JSON.stringify({
                success: true,
                total_days: plan.length,
                formatted: `Here's the proposed itinerary:\n\n${formatted}\n\nThis is a soft plan — tell me to edit any day (e.g. "edit day 2: swap lunch for something cheaper"). When everyone's happy, the organizer can approve it.`,
            });
        }

        case 'editItineraryDay': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const dayData = getItineraryDay(trip.id, args.day_number);
            if (!dayData) return JSON.stringify({ error: `Day ${args.day_number} doesn't exist in the itinerary yet.` });

            const updatedItems = await editItineraryDayPlan(dayData.items, args.instruction, trip.destination);
            if (updatedItems.error) return JSON.stringify(updatedItems);

            // Replace items in DB
            clearItineraryDay(dayData.id);
            for (let i = 0; i < updatedItems.length; i++) {
                const item = updatedItems[i];
                addItineraryItem(
                    dayData.id, item.venue_name, item.time || null,
                    item.type || 'suggested', item.booking_url || null,
                    item.notes || null, i
                );
            }

            const formatted = updatedItems.map(it =>
                `  ${it.time || '—'} ${it.venue_name}${it.notes ? ` (${it.notes})` : ''}`
            ).join('\n');

            return JSON.stringify({
                success: true,
                day_number: args.day_number,
                formatted: `Day ${args.day_number} updated:\n${formatted}`,
            });
        }

        case 'getFullItinerary': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });

            const itinerary = getItinerary(trip.id);
            if (!itinerary.length) return JSON.stringify({ error: 'No itinerary generated yet. Use generateItinerary first.' });

            const formatted = itinerary.map(day => {
                const dayLabel = day.is_free_day ? `Day ${day.day_number} (Free Day)` : `Day ${day.day_number}`;
                const dateStr = day.date ? ` — ${day.date}` : '';
                const items = day.items.map(it =>
                    `  ${it.time || '—'} ${it.venue_name}${it.notes ? ` (${it.notes})` : ''}`
                ).join('\n');
                return `${dayLabel}${dateStr}\n${items}`;
            }).join('\n\n');

            return JSON.stringify({ success: true, itinerary, formatted });
        }

        case 'approveItinerary': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip exists for this chat.' });
            if (!isOrganizer(trip.id, sender)) {
                return JSON.stringify({ error: 'Only the organizer can approve the itinerary.' });
            }

            const itinerary = getItinerary(trip.id);
            if (!itinerary.length) return JSON.stringify({ error: 'No itinerary to approve. Generate one first.' });

            const nextStage = advanceStage(trip.id);
            return JSON.stringify({
                success: true,
                previous_stage: 'day_assignment',
                current_stage: nextStage,
                note: 'Itinerary locked in! Moving to logistics — I\'ll research booking links, transport, and accommodation.',
            });
        }

        case 'getTripOverview': {
            const trip = getTripByChatId(chatId);
            if (!trip) return JSON.stringify({ error: 'No trip created yet.' });

            const participants = getParticipantsByTripId(trip.id);
            const polls = getPollsByTripId(trip.id);
            const prefs = getAggregatedPreferences(trip.id);
            const stops = getStopsByTripId(trip.id);
            const itinerary = getItinerary(trip.id);

            const pollSummaries = polls.map(p => {
                const votes = getVotesForPoll(p.id);
                return {
                    question: p.question,
                    status: p.status,
                    stage: p.stage,
                    winning_option: p.winning_option,
                    options: p.options.map(o => o.text),
                    votes: votes.map(v => `${v.participant_name}: ${v.option_emoji}`),
                };
            });

            return JSON.stringify({
                name: trip.name,
                destination: trip.destination,
                start_date: trip.start_date,
                end_date: trip.end_date,
                stage: trip.stage,
                join_code: trip.join_code,
                free_day_count: trip.free_day_count,
                rough_schedule: trip.rough_schedule ? JSON.parse(trip.rough_schedule) : null,
                organizer: participants.find(p => p.role === 'organizer')?.name,
                participants: participants.map(p => ({ name: p.name, role: p.role })),
                preferences: prefs.response_count > 0 ? prefs : null,
                stops: stops.map(s => ({ name: s.name, confidence: s.confidence, day: s.day_number, type: s.type })),
                itinerary: itinerary.length > 0 ? itinerary : null,
                polls: pollSummaries,
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
    const addressed = context.addressed !== false; // default true (DMs are always addressed)

    // Normalize context so executeTool always has a valid chatId
    context = { ...context, chatId };

    const userContent = context.chatId && !context.chatId.startsWith('dm_')
        ? `[${senderName}]: ${messageText}`
        : messageText;
    addToHistory(chatId, 'user', userContent);

    // Auto-register sender as participant if a trip exists for this chat
    if (context.sender && !chatId.startsWith('dm_')) {
        const trip = getTripByChatId(chatId);
        if (trip) {
            const existing = getParticipantBySenderId(context.sender, trip.id);
            if (!existing) {
                createParticipant(trip.id, context.sender, senderName);
                console.log(`Auto-registered ${senderName} as participant`);
            }
        }
    }

    // If not directly @'d, just store the message for context — don't call the LLM
    if (!addressed) {
        return null;
    }

    // Build stage-scoped system prompt
    const trip = getTripByChatId(chatId);
    const stage = trip?.stage || 'setup';
    const systemPrompt = getSystemPrompt(stage);

    // Build messages: system + trip state + history
    const messages = [
        { role: 'system', content: systemPrompt },
    ];

    // Inject compact trip state so LLM has full context without long history
    const tripContext = buildTripContext(chatId);
    if (tripContext) {
        messages.push({ role: 'user', content: tripContext });
        messages.push({ role: 'assistant', content: 'Got it, I have the current trip state.' });
    }

    messages.push(...getHistory(chatId));

    try {
        console.log(`Calling Minimax API (${messages.length} messages)...`);
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
            const toolNames = responseMessage.tool_calls.map(t => t.function.name).join(', ');
            console.log(`Tool round ${rounds}/${MAX_TOOL_ROUNDS}: ${toolNames}`);
            messages.push(responseMessage);

            for (const toolCall of responseMessage.tool_calls) {
                let result;
                try {
                    result = await executeTool(toolCall, context);
                } catch (err) {
                    console.error(`Tool ${toolCall.function.name} threw:`, err);
                    result = JSON.stringify({ error: `Tool error: ${err.message}` });
                }
                // Compress large tool results to save context
                const compressed = compressToolResult(toolCall.function.name, result);
                messages.push({
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    name: toolCall.function.name,
                    content: compressed,
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

        // Strip <think> tags that some models emit (Minimax chain-of-thought)
        let finalContent = responseMessage.content || '';
        finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

        // If LLM returned empty after tool rounds, don't send nothing
        if (!finalContent) {
            console.log('LLM returned empty response after tool rounds — skipping send');
            return null;
        }

        addToHistory(chatId, 'assistant', finalContent);
        return finalContent;

    } catch (error) {
        console.error('Error calling Minimax API:', error);
        return 'Something went wrong — try again in a sec.';
    }
}

// --- Startup ---
async function start() {
    await initBlueBubbles();

    sdk.startWatching({
        onDirectMessage,
        onGroupMessage,
        onError: (error) => {
            console.error('iMessage SDK Error:', error);
        },
    });

    // --- API Server for iMessage extension ---
    startApiServer();
}

start();

// --- Extension watcher: receives poll results from the iMessage extension ---
startExtensionWatcher((pollResult) => {
    const { chatId, question, options, totalVotes } = pollResult;
    if (!chatId) return;

    const trip = getTripByChatId(chatId);
    if (!trip) {
        console.log(`Extension watcher: poll update for unknown chat ${chatId}, ignoring`);
        return;
    }

    // Find the matching active poll in our DB by question
    const activePoll = getActivePollByChatId(chatId);
    if (!activePoll) {
        console.log(`Extension watcher: no active poll for chat ${chatId}, ignoring`);
        return;
    }

    // Log the extension poll state
    const leader = options.reduce((a, b) => a.votes > b.votes ? a : b);
    console.log(`Extension poll "${question}": ${totalVotes} votes, leading: ${leader.text} (${leader.votes})`);

    // Sync extension votes into our database
    // The extension tracks aggregate counts, not per-user votes.
    // We can use this to detect when voting is complete and report results.
    const participantCount = getParticipantsByTripId(trip.id).length;

    if (totalVotes >= participantCount && totalVotes > 0) {
        // Check for clear winner
        const maxVotes = Math.max(...options.map(o => o.votes));
        const winners = options.filter(o => o.votes === maxVotes);

        if (winners.length === 1) {
            // Auto-close with winner
            closePoll(activePoll.id, winners[0].text);
            for (const opt of activePoll.options) {
                if (opt.text !== winners[0].text) {
                    eliminateOption(trip.id, trip.stage, opt.text);
                }
            }
            const msg = `Poll closed! "${winners[0].text}" wins with ${maxVotes} votes.`;
            console.log(`Extension watcher: ${msg}`);
            sendToGroupChat(chatId, msg);
        } else {
            const tiedNames = winners.map(w => w.text).join(' and ');
            const msg = `Poll tied between ${tiedNames}. Organizer, break the tie.`;
            console.log(`Extension watcher: ${msg}`);
            sendToGroupChat(chatId, msg);
        }
    }
});

process.on('SIGINT', async () => {
    console.log('Shutting down iMessage AI Agent...');
    stopExtensionWatcher();
    if (advancedSdk) {
        try { await advancedSdk.close(); } catch {}
    }
    await sdk.close();
    process.exit();
});

export { advancedSdk };
export default sdk;
