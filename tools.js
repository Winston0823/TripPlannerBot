import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export async function foursquareSearch(query, near) {
    console.log(`Performing Foursquare search for: "${query}" near: "${near || 'auto'}"`);
    const apiKey = process.env.FOURSQUARE_API_KEY;

    if (!apiKey) {
        return JSON.stringify({ error: 'FOURSQUARE_API_KEY is not set in .env' });
    }

    const params = { query, limit: 5 };
    if (near) params.near = near;

    try {
        const response = await axios.get('https://api.foursquare.com/v3/places/search', {
            headers: {
                Authorization: apiKey,
                Accept: 'application/json',
            },
            params,
        });

        const places = response.data.results.map(p => ({
            name: p.name,
            address: p.location?.formatted_address || p.location?.address || 'No address',
            categories: p.categories?.map(c => c.name).join(', ') || 'N/A',
            distance: p.distance,
        }));

        return JSON.stringify(places);
    } catch (error) {
        console.error('Error during Foursquare search:', error.message);
        return JSON.stringify({ error: error.message });
    }
}
