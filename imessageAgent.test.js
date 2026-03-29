const mockSdkSend = jest.fn();

jest.mock('@photon-ai/imessage-kit', () => ({
    IMessageSDK: jest.fn().mockImplementation(() => ({
        startWatching: jest.fn(),
        send: mockSdkSend,
        close: jest.fn(),
    })),
}));

const mockCallMinimaxAPI = jest.fn();
const mockSdk = {
    send: mockSdkSend,
    startWatching: jest.fn(),
    close: jest.fn(),
};

jest.mock('./imessageAgent.js', () => ({
    __esModule: true,
    default: mockSdk,
    callMinimaxAPI: mockCallMinimaxAPI,
}));

jest.mock('./database.js', () => ({
    STAGES: ['setup','preferences','activity_types','venues','day_assignment','logistics','review','booked'],
    getTripByChatId: jest.fn(),
    getParticipantsByTripId: jest.fn(),
    getPollsByTripId: jest.fn(),
    getVotesForPoll: jest.fn(),
    getAggregatedPreferences: jest.fn(),
    getStopsByTripId: jest.fn(),
}));

const {
    getTripByChatId, getParticipantsByTripId, getPollsByTripId,
    getVotesForPoll, getAggregatedPreferences, getStopsByTripId
} = require('./database.js');
const { onDirectMessage, onGroupMessage } = require('./messageHandlers.js');

describe('iMessage AI Agent', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('onDirectMessage', () => {
        test('should always respond to DMs without needing @bot', async () => {
            mockCallMinimaxAPI.mockResolvedValue('Where to?');
            const msg = { sender: 'user1', senderName: 'Alice', text: 'hello' };
            await onDirectMessage(msg);

            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('hello', {
                sender: 'user1', senderName: 'Alice',
            });
            expect(mockSdkSend).toHaveBeenCalledWith('user1', 'Where to?');
        });

        test('should strip @bot from DM text', async () => {
            mockCallMinimaxAPI.mockResolvedValue('Sure!');
            const msg = { sender: 'user1', senderName: 'Alice', text: '@bot find hotels' };
            await onDirectMessage(msg);
            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('find hotels', {
                sender: 'user1', senderName: 'Alice',
            });
        });

        test('should strip @shyt from DM text', async () => {
            mockCallMinimaxAPI.mockResolvedValue('Sure!');
            const msg = { sender: 'user1', senderName: 'Alice', text: '@shyt find hotels' };
            await onDirectMessage(msg);
            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('find hotels', {
                sender: 'user1', senderName: 'Alice',
            });
        });
    });

    describe('onGroupMessage', () => {
        test('should respond when @bot is mentioned', async () => {
            mockCallMinimaxAPI.mockResolvedValue('On it.');
            const msg = {
                chatId: 'group_123', sender: 'user_abc',
                senderName: 'Alice', text: '@bot lets go to bali',
            };
            await onGroupMessage(msg);
            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('lets go to bali', {
                chatId: 'group_123', sender: 'user_abc', senderName: 'Alice',
                addressed: true,
            });
        });

        test('should respond when @shyt is mentioned', async () => {
            mockCallMinimaxAPI.mockResolvedValue('On it.');
            const msg = {
                chatId: 'group_123', sender: 'user_abc',
                senderName: 'Alice', text: '@shyt find restaurants',
            };
            await onGroupMessage(msg);
            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('find restaurants', {
                chatId: 'group_123', sender: 'user_abc', senderName: 'Alice',
                addressed: true,
            });
        });

        test('should store non-@ messages for context but not reply', async () => {
            mockCallMinimaxAPI.mockResolvedValue(null);
            const msg = {
                chatId: 'group_123', sender: 'user_abc',
                senderName: 'Alice', text: 'hey everyone',
            };
            await onGroupMessage(msg);
            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('hey everyone', {
                chatId: 'group_123', sender: 'user_abc', senderName: 'Alice',
                addressed: false,
            });
            expect(mockSdkSend).not.toHaveBeenCalled();
        });

        test('@shyt overview returns trip summary with stage and roles', async () => {
            getTripByChatId.mockReturnValue({
                id: 1, name: 'Yosemite Trip', destination: 'Yosemite',
                start_date: '2026-04-10', end_date: '2026-04-13', stage: 'venues',
            });
            getParticipantsByTripId.mockReturnValue([
                { name: 'Alice', role: 'organizer' },
                { name: 'Bob', role: 'member' },
            ]);
            getAggregatedPreferences.mockReturnValue({
                avg_pace: 3.5, avg_budget: 2.0, avg_adventure: 4.0, response_count: 2,
            });
            getStopsByTripId.mockReturnValue([
                { name: 'Half Dome', confidence: 'confirmed', day_number: 1, type: 'confirmed' },
            ]);
            getPollsByTripId.mockReturnValue([
                { id: 1, question: 'When?', status: 'closed', winning_option: 'This month',
                  options: [{ text: 'This month' }] },
            ]);
            getVotesForPoll.mockReturnValue([
                { participant_name: 'Alice', option_emoji: '1️⃣' },
            ]);

            const msg = {
                chatId: 'group_123', sender: 'user_abc',
                senderName: 'Alice', text: '@shyt overview',
            };
            await onGroupMessage(msg);

            expect(mockCallMinimaxAPI).not.toHaveBeenCalled();
            const sent = mockSdkSend.mock.calls[0][1];
            expect(sent).toContain('Yosemite Trip');
            expect(sent).toContain('Stage: venues');
            expect(sent).toContain('Alice (organizer)');
            expect(sent).toContain('Pace 3.5/5');
            expect(sent).toContain('Half Dome');
        });

        test('@shyt overview with no trip returns message', async () => {
            getTripByChatId.mockReturnValue(undefined);
            const msg = {
                chatId: 'group_123', sender: 'user_abc',
                senderName: 'Alice', text: '@shyt overview',
            };
            await onGroupMessage(msg);
            expect(mockSdkSend).toHaveBeenCalledWith('group_123', 'No trip planned yet.');
        });
    });
});
