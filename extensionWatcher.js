import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

// Read-only connection to the iMessage database
const CHAT_DB_PATH = path.join(process.env.HOME, 'Library/Messages/chat.db');
const TRIP_PLANNER_BUNDLE = 'TripPlanner';
const POLL_INTERVAL = 3000; // Check every 3 seconds

let lastRowId = 0;
let chatDb = null;
let onPollUpdate = null;

function openChatDb() {
    try {
        chatDb = new Database(CHAT_DB_PATH, { readonly: true });
        // Get the latest message ROWID to start watching from
        const latest = chatDb.prepare('SELECT MAX(ROWID) as maxId FROM message').get();
        lastRowId = latest?.maxId || 0;
        console.log(`Extension watcher: connected to chat.db, starting from ROWID ${lastRowId}`);
    } catch (err) {
        console.error('Extension watcher: failed to open chat.db:', err.message);
    }
}

function parsePayloadUrl(payloadData) {
    // The payload is a binary plist (NSKeyedArchiver). We extract the URL string from it.
    // Write to temp file and use plutil to convert
    const tmpPath = '/tmp/tripplanner_payload.plist';
    try {
        fs.writeFileSync(tmpPath, payloadData);
        const xml = execSync(`plutil -convert xml1 -o - ${tmpPath}`, { encoding: 'utf8' });

        // Extract the URL string — it's the value containing "?type=poll"
        const urlMatch = xml.match(/<string>\?(type=poll[^<]*)<\/string>/);
        if (!urlMatch) return null;

        const params = new URLSearchParams(urlMatch[1]);
        return Object.fromEntries(params.entries());
    } catch (err) {
        console.error('Extension watcher: failed to parse payload:', err.message);
        return null;
    }
}

function checkForNewMessages() {
    if (!chatDb) return;

    try {
        const newMessages = chatDb.prepare(`
            SELECT m.ROWID, m.balloon_bundle_id, m.payload_data, m.is_from_me, m.date,
                   c.chat_identifier, h.id as sender_id
            FROM message m
            LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            LEFT JOIN chat c ON cmj.chat_id = c.ROWID
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.ROWID > ?
              AND m.balloon_bundle_id LIKE '%${TRIP_PLANNER_BUNDLE}%'
            ORDER BY m.ROWID ASC
        `).all(lastRowId);

        for (const msg of newMessages) {
            lastRowId = msg.ROWID;

            if (!msg.payload_data) continue;

            const pollData = parsePayloadUrl(msg.payload_data);
            if (!pollData || pollData.type !== 'poll') continue;

            console.log(`Extension watcher: poll update from ${msg.sender_id || 'me'} in ${msg.chat_identifier}`);
            console.log(`  Poll: "${pollData.question}" (${pollData.optionCount} options)`);

            // Build structured poll result
            const optionCount = parseInt(pollData.optionCount, 10) || 0;
            const options = [];
            for (let i = 0; i < optionCount; i++) {
                options.push({
                    text: pollData[`opt${i}`] || `Option ${i + 1}`,
                    votes: parseInt(pollData[`votes${i}`], 10) || 0,
                });
            }

            const result = {
                pollId: pollData.pollId,
                question: pollData.question,
                options,
                chatId: msg.chat_identifier,
                sender: msg.is_from_me ? 'me' : msg.sender_id,
                totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
            };

            if (onPollUpdate) {
                onPollUpdate(result);
            }
        }
    } catch (err) {
        // chat.db may be locked momentarily by Messages.app
        if (!err.message.includes('database is locked')) {
            console.error('Extension watcher: error checking messages:', err.message);
        }
    }
}

export function startExtensionWatcher(callback) {
    onPollUpdate = callback;
    openChatDb();

    if (!chatDb) {
        console.error('Extension watcher: could not start (no chat.db access)');
        return;
    }

    setInterval(checkForNewMessages, POLL_INTERVAL);
    console.log(`Extension watcher: polling every ${POLL_INTERVAL / 1000}s for TripPlanner extension messages`);
}

export function stopExtensionWatcher() {
    if (chatDb) {
        chatDb.close();
        chatDb = null;
    }
}
