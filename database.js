import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'trip_planner.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Stage pipeline ---
export const STAGES = [
    'setup', 'preferences', 'activity_types', 'venues',
    'day_assignment', 'logistics', 'review', 'booked'
];

// --- Schema versioning ---
function getSchemaVersion() {
    return db.pragma('user_version', { simple: true });
}

function setSchemaVersion(v) {
    db.pragma(`user_version = ${v}`);
}

// --- Initialization ---
function initializeDatabase() {
    console.log('Initializing database...');

    db.exec(`
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT UNIQUE,
            name TEXT,
            destination TEXT,
            start_date TEXT,
            end_date TEXT,
            stage TEXT DEFAULT 'setup',
            organizer_sender_id TEXT,
            free_day_count INTEGER,
            rough_schedule TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            sender_id TEXT NOT NULL,
            name TEXT,
            role TEXT DEFAULT 'member',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trip_id) REFERENCES trips(id),
            UNIQUE(trip_id, sender_id)
        );

        CREATE TABLE IF NOT EXISTS polls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            message_id TEXT UNIQUE,
            question TEXT,
            options TEXT,
            status TEXT DEFAULT 'open',
            stage TEXT,
            winning_option TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trip_id) REFERENCES trips(id)
        );

        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            poll_id INTEGER NOT NULL,
            participant_id INTEGER NOT NULL,
            option_emoji TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (poll_id) REFERENCES polls(id),
            FOREIGN KEY (participant_id) REFERENCES participants(id),
            UNIQUE(poll_id, participant_id)
        );

        CREATE TABLE IF NOT EXISTS preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            participant_id INTEGER NOT NULL,
            pace INTEGER CHECK(pace BETWEEN 1 AND 5),
            budget INTEGER CHECK(budget BETWEEN 1 AND 5),
            adventure INTEGER CHECK(adventure BETWEEN 1 AND 5),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trip_id) REFERENCES trips(id),
            FOREIGN KEY (participant_id) REFERENCES participants(id),
            UNIQUE(trip_id, participant_id)
        );

        CREATE TABLE IF NOT EXISTS stops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            confidence TEXT DEFAULT 'open',
            day_number INTEGER,
            type TEXT DEFAULT 'proposed',
            venues TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trip_id) REFERENCES trips(id)
        );

        CREATE TABLE IF NOT EXISTS itinerary_days (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            day_number INTEGER NOT NULL,
            date TEXT,
            is_free_day INTEGER DEFAULT 0,
            FOREIGN KEY (trip_id) REFERENCES trips(id),
            UNIQUE(trip_id, day_number)
        );

        CREATE TABLE IF NOT EXISTS itinerary_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day_id INTEGER NOT NULL,
            venue_name TEXT NOT NULL,
            time TEXT,
            type TEXT DEFAULT 'confirmed',
            booking_url TEXT,
            notes TEXT,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (day_id) REFERENCES itinerary_days(id)
        );

        CREATE TABLE IF NOT EXISTS eliminated_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            stage TEXT NOT NULL,
            option_value TEXT NOT NULL,
            eliminated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trip_id) REFERENCES trips(id)
        );

        CREATE TABLE IF NOT EXISTS conversation_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_conv_msg_chat ON conversation_messages(chat_id, created_at);
    `);

    migrate();
    console.log('Database initialized.');
}

// --- Migration for existing DBs ---
function migrate() {
    const version = getSchemaVersion();

    if (version < 1) {
        // Check if this is an old-schema DB by looking for missing columns
        const tripCols = db.prepare("PRAGMA table_info(trips)").all().map(c => c.name);
        if (!tripCols.includes('stage')) {
            db.exec('BEGIN');
            try {
                // Add new columns to trips
                db.exec(`ALTER TABLE trips ADD COLUMN stage TEXT DEFAULT 'setup'`);
                db.exec(`ALTER TABLE trips ADD COLUMN organizer_sender_id TEXT`);
                db.exec(`ALTER TABLE trips ADD COLUMN free_day_count INTEGER`);
                db.exec(`ALTER TABLE trips ADD COLUMN rough_schedule TEXT`);

                // Rebuild participants: sender_id UNIQUE → (trip_id, sender_id) UNIQUE + role
                db.exec(`
                    CREATE TABLE participants_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        trip_id INTEGER NOT NULL,
                        sender_id TEXT NOT NULL,
                        name TEXT,
                        role TEXT DEFAULT 'member',
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (trip_id) REFERENCES trips(id),
                        UNIQUE(trip_id, sender_id)
                    );
                    INSERT INTO participants_new (id, trip_id, sender_id, name, created_at)
                        SELECT id, trip_id, sender_id, name, created_at FROM participants;
                    DROP TABLE participants;
                    ALTER TABLE participants_new RENAME TO participants;
                `);

                // Add columns to polls
                db.exec(`ALTER TABLE polls ADD COLUMN stage TEXT`);
                db.exec(`ALTER TABLE polls ADD COLUMN winning_option TEXT`);

                // Rebuild votes: add UNIQUE(poll_id, participant_id)
                db.exec(`
                    CREATE TABLE votes_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        poll_id INTEGER NOT NULL,
                        participant_id INTEGER NOT NULL,
                        option_emoji TEXT,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (poll_id) REFERENCES polls(id),
                        FOREIGN KEY (participant_id) REFERENCES participants(id),
                        UNIQUE(poll_id, participant_id)
                    );
                    INSERT INTO votes_new (id, poll_id, participant_id, option_emoji, created_at)
                        SELECT id, poll_id, participant_id, option_emoji, created_at FROM votes;
                    DROP TABLE votes;
                    ALTER TABLE votes_new RENAME TO votes;
                `);

                // Backfill: first participant per trip becomes organizer
                db.exec(`
                    UPDATE trips SET organizer_sender_id = (
                        SELECT sender_id FROM participants
                        WHERE participants.trip_id = trips.id
                        ORDER BY created_at ASC LIMIT 1
                    );
                    UPDATE participants SET role = 'organizer'
                    WHERE id IN (
                        SELECT p.id FROM participants p
                        JOIN trips t ON t.id = p.trip_id
                        WHERE p.sender_id = t.organizer_sender_id
                    );
                `);

                db.exec('COMMIT');
            } catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        }
        setSchemaVersion(1);
    }

    if (version < 2) {
        // Add conversation_messages table for persistent chat history
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_messages'").get();
        if (!tables) {
            db.exec(`
                CREATE TABLE conversation_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX idx_conv_msg_chat ON conversation_messages(chat_id, created_at);
            `);
        }
        setSchemaVersion(2);
    }

    if (version < 3) {
        const tripCols = db.prepare("PRAGMA table_info(trips)").all().map(c => c.name);
        if (!tripCols.includes('join_code')) {
            db.exec(`ALTER TABLE trips ADD COLUMN join_code TEXT`);
            // Generate join codes for existing trips
            const trips = db.prepare('SELECT id FROM trips WHERE join_code IS NULL').all();
            const updateStmt = db.prepare('UPDATE trips SET join_code = ? WHERE id = ?');
            for (const trip of trips) {
                const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                updateStmt.run(code, trip.id);
            }
        }
        setSchemaVersion(3);
    }
}

initializeDatabase();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// --- Trips ---

export const createTrip = (chat_id, name, destination, start_date, end_date, organizer_sender_id) => {
    const join_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const stmt = db.prepare(
        `INSERT INTO trips (chat_id, name, destination, start_date, end_date, organizer_sender_id, stage, join_code)
         VALUES (?, ?, ?, ?, ?, ?, 'setup', ?)`
    );
    const info = stmt.run(chat_id, name, destination, start_date, end_date, organizer_sender_id, join_code);
    return info.lastInsertRowid;
};

export const getTripByJoinCode = (join_code) => {
    return db.prepare('SELECT * FROM trips WHERE join_code = ?').get(join_code);
};

export const getTripByChatId = (chat_id) => {
    const stmt = db.prepare('SELECT * FROM trips WHERE chat_id = ?');
    return stmt.get(chat_id);
};

export const getTripById = (trip_id) => {
    return db.prepare('SELECT * FROM trips WHERE id = ?').get(trip_id);
};

// --- Stage management ---

export const getTripStage = (trip_id) => {
    const row = db.prepare('SELECT stage FROM trips WHERE id = ?').get(trip_id);
    return row?.stage;
};

export const advanceStage = (trip_id) => {
    const trip = db.prepare('SELECT stage FROM trips WHERE id = ?').get(trip_id);
    const idx = STAGES.indexOf(trip.stage);
    if (idx < 0 || idx >= STAGES.length - 1) return null;
    const next = STAGES[idx + 1];
    db.prepare('UPDATE trips SET stage = ? WHERE id = ?').run(next, trip_id);
    return next;
};

export const reopenStage = (trip_id, target_stage) => {
    const idx = STAGES.indexOf(target_stage);
    if (idx < 0) return null;
    const downstream = STAGES.slice(idx + 1);
    db.prepare('UPDATE trips SET stage = ? WHERE id = ?').run(target_stage, trip_id);
    if (downstream.length) {
        const placeholders = downstream.map(() => '?').join(',');
        db.prepare(
            `UPDATE polls SET status = 'invalidated' WHERE trip_id = ? AND stage IN (${placeholders})`
        ).run(trip_id, ...downstream);
    }
    return target_stage;
};

// --- Organizer ---

export const isOrganizer = (trip_id, sender_id) => {
    const trip = db.prepare('SELECT organizer_sender_id FROM trips WHERE id = ?').get(trip_id);
    return trip?.organizer_sender_id === sender_id;
};

export const setFreeDayCount = (trip_id, count) => {
    db.prepare('UPDATE trips SET free_day_count = ? WHERE id = ?').run(count, trip_id);
};

export const setRoughSchedule = (trip_id, schedule) => {
    db.prepare('UPDATE trips SET rough_schedule = ? WHERE id = ?')
        .run(JSON.stringify(schedule), trip_id);
};

// --- Participants ---

export const createParticipant = (trip_id, sender_id, name, role = 'member') => {
    const stmt = db.prepare(
        `INSERT INTO participants (trip_id, sender_id, name, role)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(trip_id, sender_id) DO UPDATE SET name=excluded.name`
    );
    const info = stmt.run(trip_id, sender_id, name, role);
    return info.lastInsertRowid;
};

export const getParticipantBySenderId = (sender_id, trip_id) => {
    const stmt = db.prepare('SELECT * FROM participants WHERE sender_id = ? AND trip_id = ?');
    return stmt.get(sender_id, trip_id);
};

export const getParticipantsByTripId = (tripId) => {
    return db.prepare('SELECT * FROM participants WHERE trip_id = ?').all(tripId);
};

// --- Polls ---

export const createPoll = (trip_id, message_id, question, options, stage = null) => {
    const stmt = db.prepare(
        'INSERT INTO polls (trip_id, message_id, question, options, stage) VALUES (?, ?, ?, ?, ?)'
    );
    const info = stmt.run(trip_id, message_id, question, JSON.stringify(options), stage);
    return info.lastInsertRowid;
};

export const getPollByMessageId = (message_id) => {
    const stmt = db.prepare('SELECT * FROM polls WHERE message_id = ?');
    const poll = stmt.get(message_id);
    if (poll) poll.options = JSON.parse(poll.options);
    return poll;
};

export const getPollsByTripId = (tripId) => {
    const stmt = db.prepare('SELECT id, question, options, status, stage, winning_option FROM polls WHERE trip_id = ? ORDER BY created_at DESC');
    return stmt.all(tripId).map(p => ({ ...p, options: JSON.parse(p.options) }));
};

export const getActivePollByChatId = (chatId) => {
    const stmt = db.prepare(`
        SELECT p.* FROM polls p
        JOIN trips t ON p.trip_id = t.id
        WHERE t.chat_id = ? AND p.status = 'open'
        ORDER BY p.created_at DESC
        LIMIT 1
    `);
    const poll = stmt.get(chatId);
    if (poll) poll.options = JSON.parse(poll.options);
    return poll;
};

export const closePoll = (poll_id, winning_option = null) => {
    const stmt = db.prepare("UPDATE polls SET status = 'closed', winning_option = ? WHERE id = ?");
    return stmt.run(winning_option, poll_id);
};

// --- Votes ---

export const recordVote = (poll_id, participant_id, option_emoji, allow_multi = false) => {
    if (allow_multi) {
        // For multi-select polls (activity types): check if already voted for this specific option
        const existing = db.prepare(
            'SELECT id FROM votes WHERE poll_id = ? AND participant_id = ? AND option_emoji = ?'
        ).get(poll_id, participant_id, option_emoji);
        if (existing) return existing; // Already voted for this option
        return db.prepare(
            'INSERT INTO votes (poll_id, participant_id, option_emoji) VALUES (?, ?, ?)'
        ).run(poll_id, participant_id, option_emoji);
    }
    // Single-select: upsert (replace previous vote)
    const stmt = db.prepare(
        `INSERT INTO votes (poll_id, participant_id, option_emoji)
         VALUES (?, ?, ?)
         ON CONFLICT(poll_id, participant_id) DO UPDATE SET option_emoji=excluded.option_emoji`
    );
    return stmt.run(poll_id, participant_id, option_emoji);
};

export const getVotesForPoll = (poll_id) => {
    const stmt = db.prepare(
        'SELECT p.name AS participant_name, v.option_emoji FROM votes v JOIN participants p ON v.participant_id = p.id WHERE v.poll_id = ?'
    );
    return stmt.all(poll_id);
};

// --- Preferences ---

export const upsertPreferences = (trip_id, participant_id, pace, budget, adventure) => {
    const stmt = db.prepare(
        `INSERT INTO preferences (trip_id, participant_id, pace, budget, adventure, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(trip_id, participant_id)
         DO UPDATE SET pace=excluded.pace, budget=excluded.budget,
                       adventure=excluded.adventure, updated_at=CURRENT_TIMESTAMP`
    );
    return stmt.run(trip_id, participant_id, pace, budget, adventure);
};

export const getAggregatedPreferences = (trip_id) => {
    return db.prepare(
        `SELECT ROUND(AVG(pace),1) as avg_pace,
                ROUND(AVG(budget),1) as avg_budget,
                ROUND(AVG(adventure),1) as avg_adventure,
                COUNT(*) as response_count
         FROM preferences WHERE trip_id = ?`
    ).get(trip_id);
};

export const getPreferenceVariance = (trip_id) => {
    // Returns stddev approximation per dimension
    const rows = db.prepare('SELECT pace, budget, adventure FROM preferences WHERE trip_id = ?').all(trip_id);
    if (rows.length < 2) return { pace: 0, budget: 0, adventure: 0 };

    function stddev(vals) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sqDiffs = vals.map(v => (v - avg) ** 2);
        return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / vals.length);
    }

    return {
        pace: Math.round(stddev(rows.map(r => r.pace)) * 10) / 10,
        budget: Math.round(stddev(rows.map(r => r.budget)) * 10) / 10,
        adventure: Math.round(stddev(rows.map(r => r.adventure)) * 10) / 10,
    };
};

export const hasSubmittedPreferences = (trip_id, participant_id) => {
    const row = db.prepare(
        'SELECT id FROM preferences WHERE trip_id = ? AND participant_id = ?'
    ).get(trip_id, participant_id);
    return !!row;
};

// --- Stops ---

export const createStop = (trip_id, name, confidence = 'open', day_number = null, type = 'proposed') => {
    const stmt = db.prepare(
        'INSERT INTO stops (trip_id, name, confidence, day_number, type) VALUES (?, ?, ?, ?, ?)'
    );
    return stmt.run(trip_id, name, confidence, day_number, type).lastInsertRowid;
};

export const updateStop = (stop_id, fields) => {
    const allowed = ['name', 'confidence', 'day_number', 'type', 'venues'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
        if (!allowed.includes(k)) continue;
        sets.push(`${k} = ?`);
        vals.push(k === 'venues' ? JSON.stringify(v) : v);
    }
    if (!sets.length) return;
    vals.push(stop_id);
    db.prepare(`UPDATE stops SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
};

export const getStopsByTripId = (trip_id) => {
    const rows = db.prepare('SELECT * FROM stops WHERE trip_id = ? ORDER BY day_number, id').all(trip_id);
    return rows.map(r => ({ ...r, venues: r.venues ? JSON.parse(r.venues) : [] }));
};

// --- Itinerary ---

export const createItineraryDay = (trip_id, day_number, date = null, is_free_day = false) => {
    const stmt = db.prepare(
        `INSERT INTO itinerary_days (trip_id, day_number, date, is_free_day)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(trip_id, day_number) DO UPDATE SET date=excluded.date, is_free_day=excluded.is_free_day`
    );
    return stmt.run(trip_id, day_number, date, is_free_day ? 1 : 0).lastInsertRowid;
};

export const addItineraryItem = (day_id, venue_name, time, type, booking_url, notes, sort_order) => {
    const stmt = db.prepare(
        `INSERT INTO itinerary_items (day_id, venue_name, time, type, booking_url, notes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    return stmt.run(day_id, venue_name, time, type, booking_url, notes, sort_order).lastInsertRowid;
};

export const getItinerary = (trip_id) => {
    const days = db.prepare(
        'SELECT * FROM itinerary_days WHERE trip_id = ? ORDER BY day_number'
    ).all(trip_id);
    const itemStmt = db.prepare(
        'SELECT * FROM itinerary_items WHERE day_id = ? ORDER BY sort_order'
    );
    return days.map(d => ({
        ...d,
        is_free_day: !!d.is_free_day,
        items: itemStmt.all(d.id),
    }));
};

// --- Itinerary helpers ---

export const clearItinerary = (trip_id) => {
    const dayIds = db.prepare('SELECT id FROM itinerary_days WHERE trip_id = ?').all(trip_id).map(r => r.id);
    for (const dayId of dayIds) {
        db.prepare('DELETE FROM itinerary_items WHERE day_id = ?').run(dayId);
    }
    db.prepare('DELETE FROM itinerary_days WHERE trip_id = ?').run(trip_id);
};

export const getItineraryDay = (trip_id, day_number) => {
    const day = db.prepare(
        'SELECT * FROM itinerary_days WHERE trip_id = ? AND day_number = ?'
    ).get(trip_id, day_number);
    if (!day) return null;
    const items = db.prepare(
        'SELECT * FROM itinerary_items WHERE day_id = ? ORDER BY sort_order'
    ).all(day.id);
    return { ...day, is_free_day: !!day.is_free_day, items };
};

export const clearItineraryDay = (day_id) => {
    db.prepare('DELETE FROM itinerary_items WHERE day_id = ?').run(day_id);
};

// --- Eliminated options ---

export const eliminateOption = (trip_id, stage, option_value) => {
    db.prepare(
        'INSERT OR IGNORE INTO eliminated_options (trip_id, stage, option_value) VALUES (?, ?, ?)'
    ).run(trip_id, stage, option_value);
};

export const getEliminatedOptions = (trip_id, stage = null) => {
    if (stage) {
        return db.prepare(
            'SELECT option_value FROM eliminated_options WHERE trip_id = ? AND stage = ?'
        ).all(trip_id, stage).map(r => r.option_value);
    }
    return db.prepare(
        'SELECT stage, option_value FROM eliminated_options WHERE trip_id = ?'
    ).all(trip_id);
};

export const isEliminated = (trip_id, option_value) => {
    const row = db.prepare(
        'SELECT id FROM eliminated_options WHERE trip_id = ? AND option_value = ?'
    ).get(trip_id, option_value);
    return !!row;
};

// --- Poll options update ---

export const updatePollOptions = (poll_id, options) => {
    db.prepare('UPDATE polls SET options = ? WHERE id = ?')
        .run(JSON.stringify(options), poll_id);
};

// --- Trip deletion (cascading) ---

export const deleteTrip = (trip_id) => {
    // Delete in dependency order
    const pollIds = db.prepare('SELECT id FROM polls WHERE trip_id = ?').all(trip_id).map(r => r.id);
    for (const pollId of pollIds) {
        db.prepare('DELETE FROM votes WHERE poll_id = ?').run(pollId);
    }
    db.prepare('DELETE FROM polls WHERE trip_id = ?').run(trip_id);

    const dayIds = db.prepare('SELECT id FROM itinerary_days WHERE trip_id = ?').all(trip_id).map(r => r.id);
    for (const dayId of dayIds) {
        db.prepare('DELETE FROM itinerary_items WHERE day_id = ?').run(dayId);
    }
    db.prepare('DELETE FROM itinerary_days WHERE trip_id = ?').run(trip_id);

    db.prepare('DELETE FROM preferences WHERE trip_id = ?').run(trip_id);
    db.prepare('DELETE FROM stops WHERE trip_id = ?').run(trip_id);
    db.prepare('DELETE FROM eliminated_options WHERE trip_id = ?').run(trip_id);
    db.prepare('DELETE FROM participants WHERE trip_id = ?').run(trip_id);
    db.prepare('DELETE FROM trips WHERE id = ?').run(trip_id);
};

// --- Group Chat Members (from iMessage DB) ---

export const getGroupChatMembers = (chatGuid) => {
    try {
        const chatDb = new Database(
            require('path').join(require('os').homedir(), 'Library/Messages/chat.db'),
            { readonly: true }
        );
        const members = chatDb.prepare(`
            SELECT h.id FROM handle h
            JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
            JOIN chat c ON c.ROWID = chj.chat_id
            WHERE c.guid = ?
        `).all(chatGuid);
        chatDb.close();
        return members.map(m => m.id);
    } catch (err) {
        console.error('Failed to read group members from chat.db:', err.message);
        return [];
    }
};

// --- Conversation History ---

export const addConversationMessage = (chatId, role, content) => {
    db.prepare(
        'INSERT INTO conversation_messages (chat_id, role, content) VALUES (?, ?, ?)'
    ).run(chatId, role, content);
};

export const getConversationHistory = (chatId, limit = 20) => {
    // Get the last N messages, returned in chronological order
    return db.prepare(`
        SELECT role, content FROM (
            SELECT id, role, content FROM conversation_messages
            WHERE chat_id = ? ORDER BY id DESC LIMIT ?
        ) sub ORDER BY id ASC
    `).all(chatId, limit);
};

export const trimConversationHistory = (chatId, keep = 20) => {
    db.prepare(`
        DELETE FROM conversation_messages WHERE chat_id = ? AND id NOT IN (
            SELECT id FROM conversation_messages WHERE chat_id = ?
            ORDER BY created_at DESC, id DESC LIMIT ?
        )
    `).run(chatId, chatId, keep);
};

export const getDb = () => db;
