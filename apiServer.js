import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import {
    createTrip, getTripByChatId, getTripById,
    createParticipant, getParticipantBySenderId, getParticipantsByTripId,
    createPoll, getActivePollByChatId, closePoll,
    recordVote, getVotesForPoll,
    upsertPreferences, getAggregatedPreferences, hasSubmittedPreferences,
    updatePollOptions, eliminateOption,
    getPollsByTripId,
    getItinerary,
    getStopsByTripId,
    getDb,
    getTripByJoinCode,
    addConversationMessage, getConversationHistory, trimConversationHistory
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

const MAX_CHAT_HISTORY = 20;

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
    const userContent = senderName ? `[${senderName}]: ${message}` : message;
    addConversationMessage(sessionKey, 'user', userContent);
    trimConversationHistory(sessionKey, MAX_CHAT_HISTORY);

    const history = getConversationHistory(sessionKey, MAX_CHAT_HISTORY);

    try {
        const response = await getOpenAI().chat.completions.create({
            model: 'Minimax-M2.5',
            messages: [
                { role: 'system', content: CHAT_SYSTEM_PROMPT },
                ...history,
            ],
        });

        const reply = response.choices[0].message.content;
        addConversationMessage(sessionKey, 'assistant', reply);

        res.json({ reply });
    } catch (error) {
        console.error('Chat API error:', error.message);
        res.status(500).json({ error: 'AI service unavailable' });
    }
});

// --- Join trip with code (Extension links user to trip) ---
app.post('/trip/join', (req, res) => {
    const { joinCode, participantID, name } = req.body;

    if (!joinCode || !participantID) {
        return res.status(400).json({ error: 'joinCode and participantID are required' });
    }

    const trip = getTripByJoinCode(joinCode.toUpperCase());
    if (!trip) {
        return res.status(404).json({ error: 'Invalid join code' });
    }

    // Add this Extension user as a participant
    const displayName = name || `User-${participantID.substring(0, 6)}`;
    createParticipant(trip.id, participantID, displayName);

    res.json({
        success: true,
        tripId: trip.id,
        tripName: trip.name,
        destination: trip.destination,
    });
});

// --- Get join code for a trip ---
app.get('/session/:sessionId/join-code', (req, res) => {
    const trip = getTripFromSession(req.params.sessionId);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    res.json({ joinCode: trip.join_code });
});

// --- Dashboard endpoint (Extension main view) ---
app.get('/participant/:participantId/dashboard', (req, res) => {
    const { participantId } = req.params;

    let participant = getDb().prepare(
        'SELECT * FROM participants WHERE sender_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(participantId);

    let trip;
    if (participant) {
        trip = getTripById(participant.trip_id);
    }

    // Fallback: extension participant ID (SHA256 of iMessage UUID) won't match
    // BlueBubbles sender IDs (phone/email). Find the most recent trip instead.
    if (!trip) {
        trip = getDb().prepare(
            'SELECT * FROM trips ORDER BY created_at DESC LIMIT 1'
        ).get();

        if (!trip) {
            return res.json({ hasTrip: false });
        }

        // Auto-link this extension participant ID to the trip
        if (!participant) {
            const existingInTrip = getDb().prepare(
                'SELECT * FROM participants WHERE sender_id = ? AND trip_id = ?'
            ).get(participantId, trip.id);
            if (!existingInTrip) {
                createParticipant(trip.id, participantId, participantId, 'member');
            }
            participant = getDb().prepare(
                'SELECT * FROM participants WHERE sender_id = ? AND trip_id = ?'
            ).get(participantId, trip.id);
        }
    }

    // Participants
    const allParticipants = getParticipantsByTripId(trip.id);

    // Itinerary
    const itinerary = getItinerary(trip.id);

    // Stops
    const stops = getStopsByTripId(trip.id);

    // Preferences
    const prefAgg = getAggregatedPreferences(trip.id);
    const needsPrefs = !hasSubmittedPreferences(trip.id, participant.id);

    // Polls
    const allPolls = getPollsByTripId(trip.id);
    const activePolls = [];
    const closedPolls = [];

    for (const poll of allPolls) {
        const allVotes = getVotesForPoll(poll.id);
        const voteCounts = {};
        let userVote = null;

        for (const opt of poll.options) {
            const optId = opt.emoji || opt.id || opt.text;
            voteCounts[optId] = 0;
        }
        for (const v of allVotes) {
            voteCounts[v.option_emoji] = (voteCounts[v.option_emoji] || 0) + 1;
            if (v.participant_name === participant.name) {
                userVote = v.option_emoji;
            }
        }

        const pollData = {
            pollId: String(poll.id),
            question: poll.question,
            options: poll.options.map((opt, i) => ({
                id: opt.emoji || `opt_${i}`,
                name: opt.text,
                category: opt.category || '',
                description: opt.description || '',
                url: opt.url || null,
            })),
            userVote,
            voteCounts,
        };

        if (poll.status === 'open') {
            activePolls.push({ ...pollData, closed: false });
        } else {
            closedPolls.push({ ...pollData, closed: true, winningOption: poll.winning_option });
        }
    }

    const organizer = allParticipants.find(p => p.role === 'organizer');
    const roughSchedule = trip.rough_schedule ? JSON.parse(trip.rough_schedule) : null;

    res.json({
        hasTrip: true,
        sessionId: trip.chat_id,
        trip: {
            name: trip.name,
            destination: trip.destination,
            startDate: trip.start_date,
            endDate: trip.end_date,
            stage: trip.stage,
            freeDayCount: trip.free_day_count,
            organizer: organizer?.name || null,
            roughSchedule,
        },
        participants: allParticipants.map(p => ({ name: p.name, role: p.role })),
        itinerary: itinerary.map(day => ({
            dayNumber: day.day_number,
            date: day.date,
            isFreeDay: day.is_free_day,
            items: day.items.map(item => ({
                venueName: item.venue_name,
                time: item.time,
                type: item.type,
                bookingUrl: item.booking_url,
                notes: item.notes,
            })),
        })),
        stops: stops.map(s => ({
            name: s.name,
            dayNumber: s.day_number,
            confidence: s.confidence,
            type: s.type,
        })),
        preferences: {
            avgPace: prefAgg.avg_pace,
            avgBudget: prefAgg.avg_budget,
            avgAdventure: prefAgg.avg_adventure,
            responseCount: prefAgg.response_count || 0,
            totalCount: allParticipants.length,
            needsSubmission: needsPrefs,
        },
        activePolls,
        closedPolls,
    });
});

// --- Find active session by participant (Extension calls this on open) ---
// The Extension doesn't know the chat_id, but it knows the participantID.
// This finds the most recent trip that participant is in.
app.get('/participant/:participantId/active', (req, res) => {
    const { participantId } = req.params;

    let participant = getDb().prepare(
        'SELECT * FROM participants WHERE sender_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(participantId);

    let trip;
    if (participant) {
        trip = getTripById(participant.trip_id);
    }

    // Fallback: find most recent trip (extension ID won't match BB handles)
    if (!trip) {
        trip = getDb().prepare(
            'SELECT * FROM trips ORDER BY created_at DESC LIMIT 1'
        ).get();

        if (!trip) {
            return res.json({ hasTrip: false, activePoll: null, needsPreferences: false });
        }

        if (!participant) {
            const existingInTrip = getDb().prepare(
                'SELECT * FROM participants WHERE sender_id = ? AND trip_id = ?'
            ).get(participantId, trip.id);
            if (!existingInTrip) {
                createParticipant(trip.id, participantId, participantId, 'member');
            }
            participant = getDb().prepare(
                'SELECT * FROM participants WHERE sender_id = ? AND trip_id = ?'
            ).get(participantId, trip.id);
        }
    }

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

    const organizer2 = allParticipants.find(p => p.role === 'organizer');
    res.json({
        hasTrip: true,
        sessionId: trip.chat_id,
        trip: {
            name: trip.name,
            destination: trip.destination,
            startDate: trip.start_date,
            endDate: trip.end_date,
            stage: trip.stage,
            freeDayCount: trip.free_day_count,
            organizer: organizer2?.name || null,
            roughSchedule: trip.rough_schedule ? JSON.parse(trip.rough_schedule) : null,
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

    const organizer3 = allParticipants.find(p => p.role === 'organizer');
    res.json({
        hasTrip: true,
        trip: {
            name: trip.name,
            destination: trip.destination,
            startDate: trip.start_date,
            endDate: trip.end_date,
            stage: trip.stage,
            freeDayCount: trip.free_day_count,
            organizer: organizer3?.name || null,
            roughSchedule: trip.rough_schedule ? JSON.parse(trip.rough_schedule) : null,
        },
        activePoll: pollData,
        needsPreferences,
        preferenceStatus: {
            responseCount: prefAgg.response_count || 0,
            totalCount: allParticipants.length,
        },
    });
});

// --- Vote Web Page ---

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${PORT}`;

// Serve vote page (HTML)
app.get('/vote/:pollId', (req, res) => {
    const { pollId } = req.params;
    const participantId = req.query.p || 'web-user';

    // Find poll by ID
    const poll = getDb().prepare('SELECT p.*, t.name as trip_name, t.destination FROM polls p JOIN trips t ON p.trip_id = t.id WHERE p.id = ?').get(pollId);
    if (!poll) return res.status(404).send('Poll not found');

    const options = JSON.parse(poll.options);
    const allVotes = getVotesForPoll(poll.id);
    const totalVotes = allVotes.length;

    const voteCounts = {};
    for (const opt of options) {
        const optId = opt.emoji || opt.text;
        voteCounts[optId] = 0;
    }
    for (const v of allVotes) {
        voteCounts[v.option_emoji] = (voteCounts[v.option_emoji] || 0) + 1;
    }

    const isClosed = poll.status !== 'open';
    const optionsHtml = options.map((opt, i) => {
        const optId = opt.emoji || `opt_${i}`;
        const count = voteCounts[optId] || 0;
        const pct = totalVotes > 0 ? Math.round(count / totalVotes * 100) : 0;
        const barColor = isClosed ? '#ccc' : '#5E5CE6';
        return `
            <button class="option ${isClosed ? 'closed' : ''}"
                    onclick="${isClosed ? '' : `vote('${pollId}', '${optId}', '${participantId}')`}"
                    ${isClosed ? 'disabled' : ''}>
                <div class="option-header">
                    <span class="option-emoji">${opt.emoji || ''}</span>
                    <span class="option-text">${opt.text}</span>
                    <span class="vote-count">${count}</span>
                </div>
                ${opt.category ? `<div class="option-category">${opt.category}</div>` : ''}
                ${opt.description ? `<div class="option-desc">${opt.description}</div>` : ''}
                <div class="bar-bg"><div class="bar" style="width:${pct}%;background:${barColor}"></div></div>
            </button>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${poll.question}</title>
    <meta property="og:title" content="🗳️ ${poll.question}">
    <meta property="og:description" content="${options.length} options · ${totalVotes} vote${totalVotes !== 1 ? 's' : ''} · ${poll.trip_name} (${poll.destination})">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${BASE_URL}/vote/${pollId}">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', sans-serif;
            background: #f2f2f7; color: #1c1c1e;
            padding: 16px; max-width: 500px; margin: 0 auto;
        }
        @media (prefers-color-scheme: dark) {
            body { background: #1c1c1e; color: #f2f2f7; }
            .card { background: #2c2c2e; }
            .option { background: #3a3a3c; border-color: #48484a; }
            .option:active { background: #48484a; }
            .option-desc, .option-category { color: #98989d; }
            .bar-bg { background: #48484a; }
            .status { color: #98989d; }
        }
        .header { text-align: center; padding: 20px 0; }
        .trip-badge {
            display: inline-block; background: #5E5CE6; color: white;
            padding: 4px 12px; border-radius: 20px; font-size: 12px;
            font-weight: 600; margin-bottom: 12px;
        }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
        .status { font-size: 14px; color: #8e8e93; margin-bottom: 20px; }
        .option {
            display: block; width: 100%; text-align: left;
            background: white; border: 2px solid #e5e5ea;
            border-radius: 14px; padding: 14px 16px; margin-bottom: 10px;
            cursor: pointer; transition: all 0.15s;
            font-family: inherit; font-size: inherit; color: inherit;
        }
        .option:active:not(.closed) { border-color: #5E5CE6; transform: scale(0.98); }
        .option.closed { cursor: default; opacity: 0.8; }
        .option-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .option-emoji { font-size: 20px; }
        .option-text { font-weight: 600; font-size: 16px; flex: 1; }
        .vote-count { font-size: 18px; font-weight: 700; color: #5E5CE6; }
        .option-category { font-size: 12px; color: #5E5CE6; font-weight: 500; margin-bottom: 2px; }
        .option-desc { font-size: 13px; color: #8e8e93; margin-bottom: 8px; }
        .bar-bg { height: 5px; background: #e5e5ea; border-radius: 3px; overflow: hidden; }
        .bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
        .closed-banner {
            background: #ff9500; color: white; text-align: center;
            padding: 10px; border-radius: 10px; font-weight: 600;
            margin-bottom: 16px;
        }
        .success {
            text-align: center; padding: 40px 20px;
            display: none;
        }
        .success .check { font-size: 60px; margin-bottom: 12px; }
        .success h2 { font-size: 20px; margin-bottom: 8px; }
        .success p { color: #8e8e93; }
        #options-list { transition: opacity 0.2s; }
    </style>
</head>
<body>
    <div class="header">
        <div class="trip-badge">✈️ ${poll.trip_name}</div>
        <h1>${poll.question}</h1>
        <div class="status">${totalVotes} vote${totalVotes !== 1 ? 's' : ''} · ${options.length} options</div>
    </div>

    ${isClosed ? '<div class="closed-banner">🔒 Voting is closed</div>' : ''}

    <div id="options-list">${optionsHtml}</div>

    <div class="success" id="success">
        <div class="check">✅</div>
        <h2>Vote recorded!</h2>
        <p>You can close this page.</p>
    </div>

    <script>
    async function vote(pollId, optionId, participantId) {
        try {
            const res = await fetch('/vote-api/' + pollId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantID: participantId, optionID: optionId })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('options-list').style.display = 'none';
                document.getElementById('success').style.display = 'block';
            } else {
                alert(data.error || 'Vote failed');
            }
        } catch (e) {
            alert('Network error. Try again.');
        }
    }
    </script>
</body>
</html>`;

    res.type('html').send(html);
});

// Vote API for web page
app.post('/vote-api/:pollId', (req, res) => {
    const { pollId } = req.params;
    const { participantID, optionID } = req.body;

    const poll = getDb().prepare('SELECT p.*, t.chat_id FROM polls p JOIN trips t ON p.trip_id = t.id WHERE p.id = ?').get(pollId);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    if (poll.status !== 'open') return res.status(400).json({ error: 'Poll is closed' });

    const options = JSON.parse(poll.options);
    const option = options.find(o => (o.emoji || o.id || o.text) === optionID);
    if (!option) return res.status(400).json({ error: 'Invalid option' });

    const participant = ensureParticipant(poll.trip_id, participantID);
    recordVote(poll.id, participant.id, optionID);

    res.json({ success: true });
});

// Preference web page
app.get('/preferences/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const trip = getTripFromSession(sessionId);
    if (!trip) return res.status(404).send('Trip not found');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Travel Preferences — ${trip.name}</title>
    <meta property="og:title" content="📋 Share Your Travel Preferences">
    <meta property="og:description" content="${trip.name} · ${trip.destination} · Rate your pace, budget & adventure style">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', sans-serif;
            background: #f2f2f7; color: #1c1c1e;
            padding: 16px; max-width: 500px; margin: 0 auto;
        }
        @media (prefers-color-scheme: dark) {
            body { background: #1c1c1e; color: #f2f2f7; }
            .slider-card { background: #2c2c2e; }
            .label-row span { color: #98989d; }
        }
        .header { text-align: center; padding: 20px 0; }
        .trip-badge {
            display: inline-block; background: #5E5CE6; color: white;
            padding: 4px 12px; border-radius: 20px; font-size: 12px;
            font-weight: 600; margin-bottom: 12px;
        }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
        .subtitle { font-size: 14px; color: #8e8e93; margin-bottom: 24px; }
        .slider-card {
            background: white; border-radius: 14px; padding: 16px;
            margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        }
        .slider-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .slider-label { font-weight: 600; font-size: 16px; }
        .slider-value {
            font-size: 18px; font-weight: 700; color: #5E5CE6;
            background: rgba(94,92,230,0.1); width: 32px; height: 32px;
            border-radius: 8px; display: flex; align-items: center; justify-content: center;
        }
        input[type=range] { width: 100%; accent-color: #5E5CE6; height: 6px; margin: 8px 0; }
        .label-row { display: flex; justify-content: space-between; }
        .label-row span { font-size: 12px; color: #8e8e93; }
        .submit-btn {
            display: block; width: 100%; padding: 16px; border: none;
            background: #5E5CE6; color: white; font-size: 17px; font-weight: 600;
            border-radius: 14px; cursor: pointer; margin-top: 20px;
            font-family: inherit;
        }
        .submit-btn:active { opacity: 0.8; }
        .submit-btn:disabled { background: #ccc; cursor: default; }
        .success { text-align: center; padding: 40px 20px; display: none; }
        .success .check { font-size: 60px; margin-bottom: 12px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="trip-badge">✈️ ${trip.name}</div>
        <h1>Travel Preferences</h1>
        <div class="subtitle">Help us plan the perfect trip</div>
    </div>

    <div id="form">
        <div class="slider-card">
            <div class="slider-header">
                <span class="slider-label">🚶 Trip Pace</span>
                <span class="slider-value" id="pace-val">3</span>
            </div>
            <input type="range" id="pace" min="1" max="5" value="3" oninput="document.getElementById('pace-val').textContent=this.value">
            <div class="label-row"><span>Relaxed</span><span>Packed</span></div>
        </div>

        <div class="slider-card">
            <div class="slider-header">
                <span class="slider-label">💰 Budget</span>
                <span class="slider-value" id="budget-val">3</span>
            </div>
            <input type="range" id="budget" min="1" max="5" value="3" oninput="document.getElementById('budget-val').textContent=this.value">
            <div class="label-row"><span>Budget-friendly</span><span>Luxury</span></div>
        </div>

        <div class="slider-card">
            <div class="slider-header">
                <span class="slider-label">🏔️ Adventure</span>
                <span class="slider-value" id="adventure-val">3</span>
            </div>
            <input type="range" id="adventure" min="1" max="5" value="3" oninput="document.getElementById('adventure-val').textContent=this.value">
            <div class="label-row"><span>Familiar</span><span>Adventurous</span></div>
        </div>

        <button class="submit-btn" onclick="submitPrefs()">Submit Preferences</button>
    </div>

    <div class="success" id="success">
        <div class="check">✅</div>
        <h2>Preferences saved!</h2>
        <p>You can close this page.</p>
    </div>

    <script>
    async function submitPrefs() {
        const params = new URLSearchParams(window.location.search);
        const participantID = params.get('p') || 'web-user-' + Math.random().toString(36).slice(2,8);
        try {
            const res = await fetch('/session/${sessionId}/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantID,
                    pace: parseInt(document.getElementById('pace').value),
                    budget: parseInt(document.getElementById('budget').value),
                    adventure: parseInt(document.getElementById('adventure').value)
                })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('form').style.display = 'none';
                document.getElementById('success').style.display = 'block';
            } else {
                alert(data.error || 'Failed to save');
            }
        } catch(e) {
            alert('Network error. Try again.');
        }
    }
    </script>
</body>
</html>`;

    res.type('html').send(html);
});

// --- Seed test data ---
app.post('/seed-test-data', (req, res) => {
    const existing = getTripByChatId('demo-trip');
    if (existing) return res.json({ message: 'Test data already exists', pollUrl: `${BASE_URL}/vote/${existing.id}` });

    const tripId = createTrip('demo-trip', 'Tokyo Trip', 'Tokyo, Japan', '2026-04-15', '2026-04-22', 'organizer');
    createParticipant(tripId, 'organizer', 'Organizer', 'organizer');
    createParticipant(tripId, 'alice', 'Alice', 'member');
    createParticipant(tripId, 'bob', 'Bob', 'member');

    const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
    const options = [
        { emoji: NUMBER_EMOJIS[0], text: 'Sukiyabashi Jiro', category: 'Sushi · $$$$', description: 'World-renowned omakase sushi experience' },
        { emoji: NUMBER_EMOJIS[1], text: 'Ichiran Ramen', category: 'Ramen · $', description: 'Famous tonkotsu ramen with private booths' },
        { emoji: NUMBER_EMOJIS[2], text: 'Gonpachi', category: 'Izakaya · $$', description: 'The Kill Bill restaurant — yakitori & atmosphere' },
        { emoji: NUMBER_EMOJIS[3], text: 'Tsuta', category: 'Ramen · $$', description: 'Michelin-starred soba-based ramen' },
    ];
    const pollId = createPoll(tripId, 'poll_demo', 'Day 2 dinner — where should we eat?', options, 'venues');

    res.json({
        message: 'Test data created!',
        voteUrl: `${BASE_URL}/vote/${pollId}`,
        preferencesUrl: `${BASE_URL}/preferences/demo-trip`,
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
