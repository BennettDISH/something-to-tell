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

  const presets = {
    semantic: `Determine if these secrets are essentially about the same thing — not word-for-word identical, but equivalent in meaning and intent. For example, "I like you" and "I have a crush on you" would match.`,
    seriousness: `Determine if these secrets have a similar level of "seriousness" or "gravity." They don't need to be about the same topic, but they should feel like they carry equal weight (e.g., both are lighthearted confessions, or both are deep life-changing secrets).`,
    sentiment: `Determine if both secrets express a similar sentiment or "vibe." For example, both are things most people want to hear (positive/affirming), or both are expressions of fear/anxiety.`,
    custom: customPrompt || `Determine if these secrets match based on the context of the group.`
  };

  const instructions = presets[matchMode] || presets.semantic;

  const prompt = `You are an impartial judge for a secret exchange platform. 
You must decide if two secrets match based on the CRITERIA below.

CRITERIA:
${instructions}

Secret A: "${secretA}"
Secret B: "${secretB}"

Respond with JSON only. 
The "user_summary" is CRITICAL: it must be a short, safe sentence (10-15 words) that explains the relationship between the secrets WITHOUT revealing their specific contents. 
Example summaries: "Both secrets share a similar level of personal vulnerability," or "These secrets appear to be about entirely unrelated topics."

{
  "match": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation for why they match or don't, referencing content for the admin",
  "user_summary": "safe, vague summary for the users involved"
}`;

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
