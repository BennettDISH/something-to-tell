import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import pool from '../config/db.js';

export async function getUserAiConfig(centralUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM ai_configs WHERE central_user_id = $1',
    [centralUserId]
  );
  return rows[0] || null;
}

function getClient(config) {
  console.log(`[AI] Initializing ${config.provider} client with model: ${config.model || 'default'} (Key: ${config.api_key?.substring(0, 7)}...)`);
  if (config.provider === 'openai') {
    return { type: 'openai', client: new OpenAI({ apiKey: config.api_key }) };
  }
  return { type: 'anthropic', client: new Anthropic({ apiKey: config.api_key }) };
}

export async function compareSecrets(config, secretA, secretB, customPrompt, matchMode = 'semantic') {
  const { type, client } = getClient(config);
  
  // ... (rest of the prompt logic)
  
  if (type === 'openai') {
    try {
      const res = await client.chat.completions.create({
        model: config.model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });
      console.log(`[AI] OpenAI response received. Status: success`);
      return JSON.parse(res.choices[0].message.content);
    } catch (err) {
      console.error(`[AI] OpenAI Error: ${err.message}`);
      throw err;
    }
  }

  try {
    const res = await client.messages.create({
      model: config.model || 'claude-sonnet-4-5-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    console.log(`[AI] Anthropic response received. Status: success`);
    const text = res.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error(`[AI] Anthropic Error: ${err.message}`);
    throw err;
  }
}

export async function generateObfuscation(config, realSecret, level) {
  const count = Math.max(1, Math.min(level, 20));
  const { type, client } = getClient(config);
  const prompt = `Generate exactly ${count} fake secrets that could plausibly be real personal secrets someone might share. They should be varied in topic and tone, similar in length and style to this real secret: "${realSecret}"

The fakes should be believable but NOT too similar to the real one — they're meant to provide cover, not duplicates.

Respond with a JSON array of strings only, no other text:
["fake secret 1", "fake secret 2", ...]`;

  if (type === 'openai') {
    const res = await client.chat.completions.create({
      model: config.model || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    return Array.isArray(parsed) ? parsed : parsed.secrets || parsed.fakes || Object.values(parsed)[0];
  }

  const res = await client.messages.create({
    model: config.model || 'claude-sonnet-4-5-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  return JSON.parse(jsonMatch[0]);
}

export function shuffleWithSecret(fakes, realSecret) {
  const all = [...fakes, realSecret];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}
