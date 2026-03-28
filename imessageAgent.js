import { IMessageSDK } from '@photon-ai/imessage-kit';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { onDirectMessage, onGroupMessage, sendToGroupChat } from './messageHandlers.js';
import { geminiResearch, appleMapSearch } from './tools.js';
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
    getItinerary,
    eliminateOption, isEliminated, getEliminatedOptions,
    updatePollOptions, deleteTrip
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
const SYSTEM_PROMPT = `You are a trip planning assistant in an iMessage group chat.

CRITICAL RULES:
- Keep responses to 1-2 short sentences. Bullet lists are fine. Emojis only at the start of a line.
- Ask ONE question at a time. Wait for the answer before asking the next.
- NEVER create a poll if one is already open. Wait for the current poll to close first.
- NEVER dump multiple questions or options in one message.

FIRST INTERACTION: If no trip exists, greet briefly and ask: "Where are you going?" Wait for the answer. Then ask dates. One thing at a time.

Roles:
- Organizer: first person to provide destination + dates. Sets levers, overrides votes, advances stages.
- Member: votes, submits preferences, proposes options.

Trip stages: setup → preferences → activity_types → venues → day_assignment → logistics → review → booked

SETUP STAGE:
After trip creation, ask the organizer ONE lever at a time:
1. "How many free days?" (wait for answer or "skip")
2. "Any must-visit stops?" (wait for answer or "skip")
3. "Want to pre-assign anything to specific days?" (wait for answer or "skip")
After all levers are addressed (or skipped), use advanceStage.

PREFERENCES STAGE:
Ask the group to share their preferences. Tell them they can either:
1. Reply with 3 numbers (pace, budget, adventure, each 1-5) and you'll record it
2. Open the TripPlanner app in the iMessage app drawer for an interactive slider experience
When someone replies with numbers, call submitPreferences. NEVER repeat individual scores. When organizer says to continue, advanceStage and show aggregates only.

ACTIVITY TYPES STAGE:
Create ONE poll with activity categories relevant to the destination and preferences. Wait for it to close before doing anything else.

VENUES STAGE:
For ONE winning activity type at a time:
1. Use geminiResearch (type "places") to find real venues at the destination
2. Create ONE poll with the shortlist
3. Wait for poll to close
4. Move to the next activity type
Repeat until all activity types have venues. Then advanceStage.
Scale options by trip length: 1-2 days → 4-6, 3-5 days → 6-8, 6+ days → 8-10.

RESEARCH: Use geminiResearch for all research needs:
- type "places" — find restaurants, attractions, activities with URLs
- type "safety" — check if an area is safe for tourists
- type "hotels" — find hotels, Airbnbs, hostels with booking URLs
- type "distances" — estimate travel times between stops
- type "general" — any other travel research
Always research safety when a new destination is set. Include URLs in suggestions when available.

VOTING RULES:
- Every subjective decision goes to a vote — never pick for the group
- Majority rules. Ties: ask organizer to break it
- Polls auto-close when all members vote. You don't need to close them manually.
- If a member proposes a new option, use addPollOption
- Voted-out options are gone forever
- If zero votes after organizer advances, pick based on preferences and explain why
- Logistical decisions are FYI messages, not polls

Guidelines:
- Messages are prefixed with [SenderName] in group chats
- Only the organizer can use setFreeDays, setLocationConfidence, setSchedule, advanceStage, closePollWithResult, organizerOverride, and deleteTrip`;

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
];

// --- Tool Execution ---
async function executeTool(toolCall, context) {
    const { name } = toolCall.function;
    const args = JSON.parse(toolCall.function.arguments);
    const { chatId, sender, senderName } = context;

    // Organizer-only tools
    const organizerTools = ['setFreeDays', 'setLocationConfidence', 'setSchedule', 'advanceStage', 'closePollWithResult', 'organizerOverride', 'deleteTrip'];
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

            return JSON.stringify({
                success: true, tripId,
                name: args.name, destination: args.destination,
                start_date: args.start_date || null,
                end_date: args.end_date || null,
                organizer: senderName || sender,
                stage: 'setup',
                safety: safetyInfo,
                message: 'Trip created. You are the organizer. Share the safety summary with the group, then ask about optional setup: free day count, must-visit stops, or rough schedule. Say "done with setup" when ready.',
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

            return JSON.stringify({
                success: true,
                action: isUpdate ? 'updated' : 'recorded',
                voter: senderName || sender,
                responses_so_far: `${prefs.response_count} of ${total}`,
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
            const pollId = createPoll(trip.id, `poll_${Date.now()}`, args.question, options, trip.stage);
            const formatted = options.map(o => `${o.emoji} ${o.text}`).join('\n');
            return JSON.stringify({
                success: true, pollId,
                formatted: `📊 ${args.question}\n\n${formatted}\n\nVote by replying with the option number, or open the TripPlanner app in iMessage for the full interactive experience! 🗳️`,
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
            recordVote(activePoll.id, participant.id, chosen.emoji);

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
                let result;
                try {
                    result = await executeTool(toolCall, context);
                } catch (err) {
                    console.error(`Tool ${toolCall.function.name} threw:`, err);
                    result = JSON.stringify({ error: `Tool error: ${err.message}` });
                }
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

        // Strip <think> tags that some models emit (Minimax chain-of-thought)
        let finalContent = responseMessage.content || '';
        finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

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

// --- API Server for iMessage extension ---
startApiServer();

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
    await sdk.close();
    process.exit();
});

export default sdk;
