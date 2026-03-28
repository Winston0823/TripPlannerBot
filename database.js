import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'trip_planner.db');
const db = new Database(dbPath);

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
            options TEXT, -- JSON string of options
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
    console.log('Database initialized.');
}

// Initialize the database when this module is imported
initializeDatabase();

export const getDb = () => db;

// Helper functions for database operations (to be implemented later)
export const createTrip = (chat_id, name, destination, start_date, end_date) => {
    const stmt = db.prepare('INSERT INTO trips (chat_id, name, destination, start_date, end_date) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(chat_id, name, destination, start_date, end_date);
    return info.lastInsertRowid;
};

export const getTripByChatId = (chat_id) => {
    const stmt = db.prepare('SELECT * FROM trips WHERE chat_id = ?');
    return stmt.get(chat_id);
};

export const createParticipant = (trip_id, sender_id, name) => {
    const stmt = db.prepare('INSERT INTO participants (trip_id, sender_id, name) VALUES (?, ?, ?) ON CONFLICT(sender_id) DO UPDATE SET name=excluded.name');
    const info = stmt.run(trip_id, sender_id, name);
    return info.lastInsertRowid;
};

export const getParticipantBySenderId = (sender_id) => {
    const stmt = db.prepare('SELECT * FROM participants WHERE sender_id = ?');
    return stmt.get(sender_id);
};

export const createPoll = (trip_id, message_id, question, options) => {
    const stmt = db.prepare('INSERT INTO polls (trip_id, message_id, question, options) VALUES (?, ?, ?, ?)');
    const info = stmt.run(trip_id, message_id, question, JSON.stringify(options));
    return info.lastInsertRowid;
};

export const getPollByMessageId = (message_id) => {
    const stmt = db.prepare('SELECT * FROM polls WHERE message_id = ?');
    const poll = stmt.get(message_id);
    if (poll) {
        poll.options = JSON.parse(poll.options);
    }
    return poll;
};

export const recordVote = (poll_id, participant_id, option_emoji) => {
    const stmt = db.prepare('INSERT INTO votes (poll_id, participant_id, option_emoji) VALUES (?, ?, ?)');
    const info = stmt.run(poll_id, participant_id, option_emoji);
    return info.lastInsertRowid;
};

export const getVotesForPoll = (poll_id) => {
    const stmt = db.prepare('SELECT p.name AS participant_name, v.option_emoji FROM votes v JOIN participants p ON v.participant_id = p.id WHERE v.poll_id = ?');
    return stmt.all(poll_id);
};

export const closePoll = (poll_id) => {
    const stmt = db.prepare('UPDATE polls SET status = "closed" WHERE id = ?');
    return stmt.run(poll_id);
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
    if (poll) {
        poll.options = JSON.parse(poll.options);
    }
    return poll;
};
