import { IMessageSDK } from '@photon-ai/imessage-kit';
import dotenv from 'dotenv';
dotenv.config();

const sdk = new IMessageSDK({
    debug: true,
    // We'll add more configuration here later
});

console.log('iMessage AI Agent started...');

// Start watching for messages
sdk.startWatching({
    onDirectMessage: async (msg) => {
        console.log(`DM from ${msg.sender}: ${msg.text}`);
        const minimaxResponse = await callMinimaxAPI(msg.text);
        let finalResponse = minimaxResponse;

        // Simulate decision making based on Minimax response
        if (minimaxResponse.includes('Searching for hotels...')) {
            const hotelResults = await searchHotels(msg.text); // In real app, Minimax would extract query
            finalResponse += '\n' + hotelResults;
        } else if (minimaxResponse.includes('Looking for flights/transportation...')) {
            const flightResults = await searchFlights(msg.text); // In real app, Minimax would extract query
            finalResponse += '\n' + flightResults;
        }

        await sdk.send(msg.sender, finalResponse);
    },
    onGroupMessage: async (msg) => {
        console.log(`Group message in ${msg.chatId} from ${msg.sender}: ${msg.text}`);
        const minimaxResponse = await callMinimaxAPI(msg.text);
        let finalResponse = minimaxResponse;

        // Simulate decision making based on Minimax response
        if (minimaxResponse.includes('Searching for hotels...')) {
            const hotelResults = await searchHotels(msg.text); // In real app, Minimax would extract query
            finalResponse += '\n' + hotelResults;
        } else if (minimaxResponse.includes('Looking for flights/transportation...')) {
            const flightResults = await searchFlights(msg.text); // In real app, Minimax would extract query
            finalResponse += '\n' + flightResults;
        }
        await sdk.send(msg.chatId, finalResponse);
    },
    onError: (error) => {
        console.error('iMessage SDK Error:', error);
    }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down iMessage AI Agent...');
    await sdk.close();
    process.exit();
});

// Placeholder for Minimax API integration
async function callMinimaxAPI(messageText) {
    console.log('Calling Minimax API with:', messageText);
    // In a real scenario, you would make an HTTP request to the Minimax API here.
    // For now, we'll return a dummy response.
    if (messageText.toLowerCase().includes('hello')) {
        return 'Hello from Minimax! I can help you plan your trip. What are your travel dates and destination?';
    } else if (messageText.toLowerCase().includes('plan trip')) {
        return 'Great! To start planning, please tell me your desired destination, travel dates, and how many people are traveling.';
    } else if (messageText.toLowerCase().includes('hotel')) {
        return 'Searching for hotels... What are your preferences (e.g., budget, location, amenities)?';
    } else if (messageText.toLowerCase().includes('flight') || messageText.toLowerCase().includes('transportation')) {
        return 'Looking for flights/transportation... What are your departure and arrival cities, and preferred dates?';
    }
    return 'I received your message: "' + messageText + '" and I am processing it with Minimax. More features coming soon!';
}

// Placeholder for external travel API integrations
async function searchHotels(query) {
    console.log('Searching hotels for:', query);
    // In a real scenario, you would make an HTTP request to a hotel API.
    return 'I found several hotels matching your criteria: Hotel A ($150/night), Hotel B ($120/night). Need more details?';
}

async function searchFlights(query) {
    console.log('Searching flights for:', query);
    // In a real scenario, you would make an HTTP request to a flight API.
    return 'Flights available: Flight X ( departs 9 AM, $200), Flight Y (departs 2 PM, $250). Interested in booking?';
}
