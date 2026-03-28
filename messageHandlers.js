import { callMinimaxAPI } from './imessageAgent.js';
import sdk from './imessageAgent.js';
import { execSync } from 'child_process';
import {
    getTripByChatId, getParticipantsByTripId,
    getPollsByTripId, getVotesForPoll,
    getAggregatedPreferences, getStopsByTripId
} from './database.js';

const BOT_TRIGGER = /@(?:bot|shyt)/i;
const OVERVIEW_CMD = /@shyt\s+overview/i;

// --- AppleScript group chat fix ---
// The SDK uses `chat id "chatXXX"` but AppleScript needs `chat id "iMessage;+;chatXXX"`
export function sendToGroupChat(chatId, text) {
    const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const applescriptId = `iMessage;+;${chatId}`;
    const script = `tell application "Messages"
    set targetChat to chat id "${applescriptId}"
    send "${escapedText}" to targetChat
end tell`;

    try {
        execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        console.log(`Sent to group ${chatId}`);
    } catch (error) {
        console.error(`Failed to send to group ${chatId}:`, error.message);
        // Fallback: try SDK's default method
        return sdk.send(chatId, text);
    }
}

function buildOverviewMessage(chatId) {
    const trip = getTripByChatId(chatId);
    if (!trip) return 'No trip planned yet.';

    const parts = [`${trip.name} — ${trip.destination}`];
    parts.push(`Stage: ${trip.stage}`);

    if (trip.start_date || trip.end_date) {
        parts.push(`${trip.start_date || '?'} → ${trip.end_date || '?'}`);
    }

    const participants = getParticipantsByTripId(trip.id);
    if (participants.length) {
        const list = participants.map(p => p.role === 'organizer' ? `${p.name} (organizer)` : p.name);
        parts.push(`Who: ${list.join(', ')}`);
    }

    const prefs = getAggregatedPreferences(trip.id);
    if (prefs.response_count > 0) {
        parts.push(`Prefs (${prefs.response_count} responses): Pace ${prefs.avg_pace}/5 · Budget ${prefs.avg_budget}/5 · Adventure ${prefs.avg_adventure}/5`);
    }

    const stops = getStopsByTripId(trip.id);
    if (stops.length) {
        const stopLines = stops.map(s => {
            const day = s.day_number ? `Day ${s.day_number}` : 'unassigned';
            return `- ${s.name} [${s.confidence}] (${day})`;
        });
        parts.push(`Stops:\n${stopLines.join('\n')}`);
    }

    const polls = getPollsByTripId(trip.id);
    for (const poll of polls) {
        const votes = getVotesForPoll(poll.id);
        const status = poll.status === 'open' ? '(open)' : '(closed)';
        const winner = poll.winning_option ? ` → ${poll.winning_option}` : '';
        const voteStr = votes.length
            ? votes.map(v => `${v.participant_name}: ${v.option_emoji}`).join(', ')
            : 'no votes yet';
        parts.push(`${poll.question} ${status}${winner} — ${voteStr}`);
    }

    return parts.join('\n');
}

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

    if (OVERVIEW_CMD.test(msg.text)) {
        const overview = buildOverviewMessage(msg.chatId);
        sendToGroupChat(msg.chatId, overview);
        return;
    }

    if (!BOT_TRIGGER.test(msg.text)) return;

    const cleanedText = msg.text.replace(BOT_TRIGGER, '').trim();
    const response = await callMinimaxAPI(cleanedText, {
        chatId: msg.chatId,
        sender: msg.sender,
        senderName: msg.senderName,
    });
    sendToGroupChat(msg.chatId, response);
};
