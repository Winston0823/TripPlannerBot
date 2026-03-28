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

const { onDirectMessage, onGroupMessage } = require('./messageHandlers.js');

describe('iMessage AI Agent', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('onDirectMessage', () => {
        test('should always respond to DMs without needing @bot', async () => {
            mockCallMinimaxAPI.mockResolvedValue('Hello! Where would you like to go?');

            const msg = { sender: 'user1', senderName: 'Alice', text: 'hello' };
            await onDirectMessage(msg);

            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('hello', {
                sender: 'user1',
                senderName: 'Alice',
            });
            expect(mockSdkSend).toHaveBeenCalledWith('user1', 'Hello! Where would you like to go?');
        });

        test('should strip @bot from DM text before sending to API', async () => {
            mockCallMinimaxAPI.mockResolvedValue('Sure!');

            const msg = { sender: 'user1', senderName: 'Alice', text: '@bot find hotels' };
            await onDirectMessage(msg);

            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('find hotels', {
                sender: 'user1',
                senderName: 'Alice',
            });
        });
    });

    describe('onGroupMessage', () => {
        test('should respond in group chats when @bot is mentioned', async () => {
            mockCallMinimaxAPI.mockResolvedValue('Let me search for that!');

            const msg = {
                chatId: 'group_123',
                sender: 'user_abc',
                senderName: 'Alice',
                text: '@bot lets go to bali',
            };
            await onGroupMessage(msg);

            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('lets go to bali', {
                chatId: 'group_123',
                sender: 'user_abc',
                senderName: 'Alice',
            });
            expect(mockSdkSend).toHaveBeenCalledWith('group_123', 'Let me search for that!');
        });

        test('should ignore group messages without @bot', async () => {
            const msg = {
                chatId: 'group_123',
                sender: 'user_abc',
                senderName: 'Alice',
                text: 'hey everyone whats up',
            };
            await onGroupMessage(msg);

            expect(mockCallMinimaxAPI).not.toHaveBeenCalled();
            expect(mockSdkSend).not.toHaveBeenCalled();
        });

        test('should handle @Bot case-insensitively', async () => {
            mockCallMinimaxAPI.mockResolvedValue('On it!');

            const msg = {
                chatId: 'group_456',
                sender: 'user_xyz',
                senderName: 'Bob',
                text: '@Bot find restaurants',
            };
            await onGroupMessage(msg);

            expect(mockCallMinimaxAPI).toHaveBeenCalledWith('find restaurants', {
                chatId: 'group_456',
                sender: 'user_xyz',
                senderName: 'Bob',
            });
        });
    });
});
