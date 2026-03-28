import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// --- Gemini Research Tool ---

async function callGemini(prompt) {
    if (!GEMINI_API_KEY) {
        return JSON.stringify({ error: 'GOOGLE_API_KEY is not set in .env' });
    }

    try {
        const response = await axios.post(GEMINI_URL, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2048,
            },
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
        });

        const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return JSON.stringify({ error: 'Gemini returned empty response' });
        return text;
    } catch (error) {
        console.error('Gemini API error:', error.response?.data?.error?.message || error.message);
        return JSON.stringify({ error: `Gemini error: ${error.response?.data?.error?.message || error.message}` });
    }
}

export async function geminiResearch(query, location, researchType) {
    console.log(`Gemini research [${researchType}]: "${query}" near "${location || 'general'}"`);

    const typePrompts = {
        places: `You are a travel research assistant. Find real, specific places for this query.

Query: "${query}"
Location: ${location || 'not specified'}

Return a JSON array of 5-8 results. Each result must have:
- name: exact business/place name
- category: type of place
- description: 1 sentence about why it's good
- price_level: "$", "$$", "$$$", or "$$$$"
- url: the place's actual website URL (google it, be accurate)
- estimated_address: best guess at the address

Return ONLY the JSON array, no markdown or explanation.`,

        safety: `You are a travel safety advisor. Assess the safety of this area for tourists.

Location: ${location || query}

Provide a JSON object with:
- overall_rating: "safe", "mostly_safe", "exercise_caution", or "avoid"
- summary: 2-3 sentence safety overview
- tips: array of 3-5 specific safety tips for tourists
- areas_to_avoid: array of specific neighborhoods or areas to be cautious in
- emergency_number: local emergency number

Return ONLY the JSON object, no markdown.`,

        hotels: `You are a travel accommodation expert. Find real hotels and Airbnb-style stays.

Query: "${query}"
Location: ${location || 'not specified'}

Return a JSON array of 5-6 options mixing hotels and vacation rentals. Each must have:
- name: exact property name
- type: "hotel", "airbnb", "hostel", or "resort"
- price_range: approximate nightly rate range (e.g. "$80-120/night")
- description: 1 sentence highlight
- url: booking URL (Airbnb, Booking.com, or hotel's own site)
- neighborhood: which area it's in

Return ONLY the JSON array, no markdown.`,

        distances: `You are a travel logistics expert. Estimate distances and travel times between locations.

Query: "${query}"
Location context: ${location || 'not specified'}

Provide a JSON object with:
- routes: array of route segments, each with:
  - from: starting point
  - to: destination
  - distance_miles: estimated distance
  - drive_time: estimated driving time
  - transit_options: brief note on public transit if available
- total_distance_miles: sum of all segments
- total_drive_time: total driving time
- recommendation: 1 sentence on best way to get around

Return ONLY the JSON object, no markdown.`,

        general: `You are a travel research assistant helping plan a trip.

Query: "${query}"
Location: ${location || 'not specified'}

Provide helpful, specific, and accurate travel information. Include real place names, URLs where relevant, and practical details. Keep it concise and actionable.`,
    };

    const prompt = typePrompts[researchType] || typePrompts.general;
    const result = await callGemini(prompt);

    // Try to parse as JSON for structured types, fall back to raw text
    if (['places', 'safety', 'hotels', 'distances'].includes(researchType)) {
        try {
            // Strip markdown code fences if present
            const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            JSON.parse(cleaned); // validate it's valid JSON
            return cleaned;
        } catch {
            // If Gemini didn't return valid JSON, wrap the text response
            return JSON.stringify({ raw_response: result });
        }
    }

    return result;
}

// --- Apple Maps API (stub — ready for integration) ---

export async function appleMapSearch(query, near) {
    const APPLE_MAPS_TOKEN = process.env.APPLE_MAPS_TOKEN;

    if (!APPLE_MAPS_TOKEN) {
        return JSON.stringify({ error: 'APPLE_MAPS_TOKEN is not set in .env. Using Gemini research for now.' });
    }

    console.log(`Apple Maps search: "${query}" near "${near || 'auto'}"`);

    try {
        const response = await axios.get('https://maps-api.apple.com/v1/search', {
            headers: {
                Authorization: `Bearer ${APPLE_MAPS_TOKEN}`,
            },
            params: {
                q: query,
                searchLocation: near || undefined,
                lang: 'en-US',
            },
        });

        const places = response.data.results?.map(p => ({
            name: p.name,
            address: p.formattedAddressLines?.join(', ') || '',
            category: p.pointOfInterestCategory || '',
            url: p.url || '',
            mapsLink: `https://maps.apple.com/?q=${encodeURIComponent(p.name)}&ll=${p.coordinate?.latitude},${p.coordinate?.longitude}`,
        })) || [];

        return JSON.stringify(places);
    } catch (error) {
        console.error('Apple Maps API error:', error.message);
        return JSON.stringify({ error: error.message });
    }
}
