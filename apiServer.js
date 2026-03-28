import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import {
    getTripByChatId, getTripById,
    createParticipant, getParticipantBySenderId, getParticipantsByTripId,
    createPoll, getActivePollByChatId, closePoll,
    recordVote, getVotesForPoll,
    upsertPreferences, getAggregatedPreferences, hasSubmittedPreferences,
    updatePollOptions, eliminateOption,
    getPollsByTripId,
    getDb
} from './database.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || process.env.API_PORT || 3001;

// --- Helpers ---

// Session ID = chat_id (the trip's chat identifier)
function getTripFromSession(sessionId) {
    return getTripByChatId(sessionId);
}

function getParticipant(tripId, participantId) {
    // participantId is a SHA256 hash from the extension — look up by sender_id
    return getParticipantBySenderId(participantId, tripId);
}

function ensureParticipant(tripId, participantId) {
    let p = getParticipant(tripId, participantId);
    if (!p) {
        const id = createParticipant(tripId, participantId, participantId);
        p = { id, sender_id: participantId };
    }
    return p;
}

// Find a poll by its DB id within a trip
function getPollById(tripId, voteId) {
    const polls = getPollsByTripId(tripId);
    return polls.find(p => String(p.id) === String(voteId));
}

// Get active or specific poll
function getActivePollForSession(sessionId) {
    return getActivePollByChatId(sessionId);
}

// --- Preference Endpoints ---

// GET /session/:sessionId/preference-status?participant=:participantId
app.get('/session/:sessionId/preference-status', (req, res) => {
    const { sessionId } = req.params;
    const participantId = req.query.participant;

    const trip = getTripFromSession(sessionId);
    if (!trip) return res.status(404).json({ error: 'Session not found' });

    const participant = ensureParticipant(trip.id, participantId);
    const responded = hasSubmittedPreferences(trip.id, participant.id);
    const allParticipants = getParticipantsByTripId(trip.id);
    const agg = getAggregatedPreferences(trip.id);

    res.json({
        responded,
        responseCount: agg.response_count || 0,
        totalCount: allParticipants.length,
    });
});

// POST /session/:sessionId/preferences
app.post('/session/:sessionId/preferences', (req, res) => {
    const { sessionId } = req.params;
    const { participantID, pace, budget, adventure } = req.body;

    const trip = getTripFromSession(sessionId);
    if (!trip) return res.status(404).json({ error: 'Session not found' });

    // Validate scores
    for (const [key, val] of Object.entries({ pace, budget, adventure })) {
        if (!Number.isInteger(val) || val < 1 || val > 5) {
            return res.status(400).json({ error: `${key} must be an integer from 1 to 5` });
        }
    }

    const participant = ensureParticipant(trip.id, participantID);
    upsertPreferences(trip.id, participant.id, pace, budget, adventure);

    res.json({ success: true });
});

// --- Vote Endpoints ---

// GET /session/:sessionId/vote/:voteId?participant=:participantId
app.get('/session/:sessionId/vote/:voteId', (req, res) => {
    const { sessionId, voteId } = req.params;
    const participantId = req.query.participant;

    const trip = getTripFromSession(sessionId);
    if (!trip) return res.status(404).json({ error: 'Session not found' });

    const poll = getPollById(trip.id, voteId);
    if (!poll) return res.status(404).json({ error: 'Vote not found' });

    const participant = participantId ? ensureParticipant(trip.id, participantId) : null;
    const allVotes = getVotesForPoll(poll.id);

    // Build vote counts per option
    const voteCounts = {};
    let userVote = null;

    for (const opt of poll.options) {
        const optId = opt.emoji || opt.id || opt.text;
        voteCounts[optId] = 0;
    }

    for (const v of allVotes) {
        voteCounts[v.option_emoji] = (voteCounts[v.option_emoji] || 0) + 1;
        if (participant && v.participant_name === participant.name) {
            userVote = v.option_emoji;
        }
    }

    // Map options to the VenueOption format the extension expects
    const options = poll.options.map((opt, i) => ({
        id: opt.emoji || `opt_${i}`,
        name: opt.text,
        category: opt.category || '',
        description: opt.description || '',
        url: opt.url || null,
    }));

    res.json({
        question: poll.question,
        options,
        userVote,
        closed: poll.status !== 'open',
        voteCounts,
    });
});

// POST /session/:sessionId/vote/:voteId/cast
app.post('/session/:sessionId/vote/:voteId/cast', (req, res) => {
    const { sessionId, voteId } = req.params;
    const { participantID, optionID } = req.body;

    const trip = getTripFromSession(sessionId);
    if (!trip) return res.status(404).json({ error: 'Session not found' });

    const poll = getPollById(trip.id, voteId);
    if (!poll) return res.status(404).json({ error: 'Vote not found' });
    if (poll.status !== 'open') return res.status(400).json({ error: 'Poll is closed' });

    // Validate option exists
    const option = poll.options.find(o => (o.emoji || o.id || o.text) === optionID);
    if (!option) return res.status(400).json({ error: 'Invalid option' });

    const participant = ensureParticipant(trip.id, participantID);
    recordVote(poll.id, participant.id, optionID);

    // Check if all members voted → auto-close
    const allVotes = getVotesForPoll(poll.id);
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
            const winOption = poll.options.find(o => (o.emoji || o.id || o.text) === winEmoji);
            closePoll(poll.id, winOption?.text || winEmoji);
            for (const opt of poll.options) {
                const optId = opt.emoji || opt.id || opt.text;
                if (optId !== winEmoji) {
                    eliminateOption(trip.id, trip.stage || 'venues', opt.text);
                }
            }
        }
    }

    res.json({ success: true });
});

// POST /session/:sessionId/vote/:voteId/suggest
app.post('/session/:sessionId/vote/:voteId/suggest', (req, res) => {
    const { sessionId, voteId } = req.params;
    const { participantID, name, description, url } = req.body;

    const trip = getTripFromSession(sessionId);
    if (!trip) return res.status(404).json({ error: 'Session not found' });

    const poll = getPollById(trip.id, voteId);
    if (!poll) return res.status(404).json({ error: 'Vote not found' });
    if (poll.status !== 'open') return res.status(400).json({ error: 'Poll is closed' });
    if (poll.options.length >= 6) return res.status(400).json({ error: 'Maximum 6 options' });

    // Check for duplicate
    const duplicate = poll.options.find(o => o.text.toLowerCase() === name.toLowerCase());
    if (duplicate) return res.status(400).json({ error: 'Option already exists' });

    const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
    const newOption = {
        emoji: NUMBER_EMOJIS[poll.options.length],
        text: name,
        category: '',
        description: description || '',
        url: url || null,
    };

    poll.options.push(newOption);
    updatePollOptions(poll.id, poll.options);

    res.json({ success: true });
});

// --- Chat Endpoint ---

let openai = null;
function getOpenAI() {
    if (!openai) {
        if (!process.env.MINIMAX_API_KEY) {
            throw new Error('MINIMAX_API_KEY not set in .env');
        }
        openai = new OpenAI({
            apiKey: process.env.MINIMAX_API_KEY,
            baseURL: 'https://api.minimax.io/v1',
        });
    }
    return openai;
}

const chatHistories = new Map();
const MAX_HISTORY = 20;

const CHAT_SYSTEM_PROMPT = `You are a trip planning assistant in an iMessage group chat. Help groups plan trips together.

Guidelines:
- Keep responses concise — this is iMessage, not email
- When asked about destinations, give specific suggestions with brief reasons
- For general travel knowledge (visa info, best times to visit, tips), use your training data
- Be friendly and helpful`;

app.post('/chat', async (req, res) => {
    const { message, chatId, senderName } = req.body;

    if (!message) return res.status(400).json({ error: 'message is required' });

    const sessionKey = chatId || 'default';
    if (!chatHistories.has(sessionKey)) {
        chatHistories.set(sessionKey, []);
    }
    const history = chatHistories.get(sessionKey);

    const userContent = senderName ? `[${senderName}]: ${message}` : message;
    history.push({ role: 'user', content: userContent });
    if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
    }

    try {
        const response = await getOpenAI().chat.completions.create({
            model: 'Minimax-M2.5',
            messages: [
                { role: 'system', content: CHAT_SYSTEM_PROMPT },
                ...history,
            ],
        });

        const reply = response.choices[0].message.content;
        history.push({ role: 'assistant', content: reply });

        res.json({ reply });
    } catch (error) {
        console.error('Chat API error:', error.message);
        res.status(500).json({ error: 'AI service unavailable' });
    }
});

// --- Find active session by participant (Extension calls this on open) ---
// The Extension doesn't know the chat_id, but it knows the participantID.
// This finds the most recent trip that participant is in.
app.get('/participant/:participantId/active', (req, res) => {
    const { participantId } = req.params;

    // Find all trips this participant is in
    const participant = getDb().prepare(
        'SELECT * FROM participants WHERE sender_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(participantId);

    if (!participant) {
        return res.json({ hasTrip: false, activePoll: null, needsPreferences: false });
    }

    const trip = getTripById(participant.trip_id);
    if (!trip) {
        return res.json({ hasTrip: false, activePoll: null, needsPreferences: false });
    }

    // Get active poll
    const activePoll = getActivePollByChatId(trip.chat_id);
    let pollData = null;
    if (activePoll) {
        const allVotes = getVotesForPoll(activePoll.id);
        const voteCounts = {};
        let userVote = null;

        for (const opt of activePoll.options) {
            const optId = opt.emoji || opt.id || opt.text;
            voteCounts[optId] = 0;
        }
        for (const v of allVotes) {
            voteCounts[v.option_emoji] = (voteCounts[v.option_emoji] || 0) + 1;
            if (v.participant_name === participant.name) {
                userVote = v.option_emoji;
            }
        }

        pollData = {
            pollId: String(activePoll.id),
            question: activePoll.question,
            options: activePoll.options.map((opt, i) => ({
                id: opt.emoji || `opt_${i}`,
                name: opt.text,
                category: opt.category || '',
                description: opt.description || '',
                url: opt.url || null,
            })),
            userVote,
            closed: false,
            voteCounts,
        };
    }

    // Check preferences
    const needsPrefs = !hasSubmittedPreferences(trip.id, participant.id);
    const prefAgg = getAggregatedPreferences(trip.id);
    const allParticipants = getParticipantsByTripId(trip.id);

    res.json({
        hasTrip: true,
        sessionId: trip.chat_id,
        trip: {
            name: trip.name,
            destination: trip.destination,
            startDate: trip.start_date,
            endDate: trip.end_date,
            stage: trip.stage,
        },
        activePoll: pollData,
        needsPreferences: needsPrefs,
        preferenceStatus: {
            responseCount: prefAgg.response_count || 0,
            totalCount: allParticipants.length,
        },
    });
});

// --- Active items for a chat (Extension pulls this on open) ---

// GET /session/:sessionId/active
// Returns what the extension should show when a user opens it for this chat
app.get('/session/:sessionId/active', (req, res) => {
    const { sessionId } = req.params;
    const participantId = req.query.participant;

    const trip = getTripFromSession(sessionId);
    if (!trip) {
        return res.json({ hasTrip: false, activePoll: null, needsPreferences: false });
    }

    // Check for active poll
    const activePoll = getActivePollForSession(sessionId);
    let pollData = null;
    if (activePoll) {
        const participant = participantId ? getParticipant(trip.id, participantId) : null;
        const allVotes = getVotesForPoll(activePoll.id);
        const voteCounts = {};
        let userVote = null;

        for (const opt of activePoll.options) {
            const optId = opt.emoji || opt.id || opt.text;
            voteCounts[optId] = 0;
        }
        for (const v of allVotes) {
            voteCounts[v.option_emoji] = (voteCounts[v.option_emoji] || 0) + 1;
            if (participant && v.participant_name === participant.name) {
                userVote = v.option_emoji;
            }
        }

        pollData = {
            pollId: activePoll.id,
            question: activePoll.question,
            options: activePoll.options.map((opt, i) => ({
                id: opt.emoji || `opt_${i}`,
                name: opt.text,
                category: opt.category || '',
                description: opt.description || '',
                url: opt.url || null,
            })),
            userVote,
            closed: false,
            voteCounts,
        };
    }

    // Check if preferences needed
    const participant = participantId ? ensureParticipant(trip.id, participantId) : null;
    const needsPreferences = participant
        ? !hasSubmittedPreferences(trip.id, participant.id)
        : false;
    const prefAgg = getAggregatedPreferences(trip.id);
    const allParticipants = getParticipantsByTripId(trip.id);

    res.json({
        hasTrip: true,
        trip: {
            name: trip.name,
            destination: trip.destination,
            startDate: trip.start_date,
            endDate: trip.end_date,
            stage: trip.stage,
        },
        activePoll: pollData,
        needsPreferences,
        preferenceStatus: {
            responseCount: prefAgg.response_count || 0,
            totalCount: allParticipants.length,
        },
    });
});

// --- Health check ---
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Start server ---
export function startApiServer() {
    app.listen(PORT, () => {
        console.log(`API server running on http://localhost:${PORT}`);
    });
    return app;
}

export default app;
