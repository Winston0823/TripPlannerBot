import { callMinimaxAPI } from './imessageAgent.js';
import sdk from './imessageAgent.js';

const BOT_TRIGGER = /@bot/i;

export const onDirectMessage = async (msg) => {
    console.log(`DM from ${msg.sender}: ${msg.text}`);
    // Always respond to DMs — they messaged the bot directly
    const cleanedText = msg.text.replace(BOT_TRIGGER, '').trim();
    const response = await callMinimaxAPI(cleanedText, {
        sender: msg.sender,
        senderName: msg.senderName,
    });
    await sdk.send(msg.sender, response);
};

export const onGroupMessage = async (msg) => {
    console.log(`Group message in ${msg.chatId} from ${msg.sender}: ${msg.text}`);

    // Only respond in group chats when @bot is mentioned
    if (!BOT_TRIGGER.test(msg.text)) return;

    const cleanedText = msg.text.replace(BOT_TRIGGER, '').trim();
    const response = await callMinimaxAPI(cleanedText, {
        chatId: msg.chatId,
        sender: msg.sender,
        senderName: msg.senderName,
    });
    await sdk.send(msg.chatId, response);
};
