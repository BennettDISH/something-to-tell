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

function buildComparisonPrompt(secretA, secretB, roomConfig, customPrompt, matchMode) {
  const rc = roomConfig || {};

  // If there's a rich room_config, build from that
  if (rc.purpose || rc.strategy) {
    const purposeDescriptions = {
      fun: 'This is a lighthearted group for fun, silly, or embarrassing confessions. Secrets tend to be playful.',
      heart: 'This is an emotionally-focused group for sharing feelings about relationships, love, and personal connections. Secrets are heartfelt and vulnerable.',
      weight: 'This group is for getting heavy things off your chest — deep confessions, guilt, regrets, or things people have been holding onto.',
      dreams: 'This group is about sharing dreams, ambitions, goals, and aspirations — things people hope for or want to achieve.',
      fears: 'This group is for sharing fears, insecurities, anxieties, and vulnerabilities — the things that scare people or keep them up at night.',
    };

    const strategyDescriptions = {
      topic: 'Match if both secrets are about the same subject or topic, even if phrased differently. For example, both about a workplace situation, or both about a family member.',
      feeling: 'Match if both secrets express the same core emotion — love, guilt, excitement, shame, hope, etc. The topics can differ.',
      weight: 'Match if both secrets carry a similar level of gravity or seriousness. Two light confessions match; two heavy life-altering secrets match. A light one and a heavy one do not.',
      vibe: 'Match if the overall energy or vibe is similar — loose, intuitive matching. Both feel optimistic, both feel dark, both feel nostalgic, etc.',
      exact: 'Match only if the secrets are about the same specific thing — nearly identical in meaning and intent.',
    };

    const strictnessMap = {
      1: 'Be very generous with matching — look for any reasonable connection. When in doubt, lean toward matching.',
      2: 'Be somewhat generous — a clear thematic or emotional connection is enough.',
      3: 'Use balanced judgment — there should be a solid, defensible reason for a match.',
      4: 'Be fairly strict — only match when the connection is clear and strong.',
      5: 'Be very strict — only match when the connection is unmistakable and obvious.',
    };

    let criteria = '';
    if (rc.purpose && purposeDescriptions[rc.purpose]) {
      criteria += `CONTEXT: ${purposeDescriptions[rc.purpose]}\n\n`;
    } else if (rc.purpose === 'custom' && rc.custom_purpose) {
      criteria += `CONTEXT: ${rc.custom_purpose}\n\n`;
    }

    if (rc.strategy && strategyDescriptions[rc.strategy]) {
      criteria += `MATCHING RULE: ${strategyDescriptions[rc.strategy]}\n\n`;
    } else if (rc.strategy === 'custom' && rc.custom_strategy) {
      criteria += `MATCHING RULE: ${rc.custom_strategy}\n\n`;
    }

    const strictness = rc.strictness || 3;
    criteria += `STRICTNESS: ${strictnessMap[strictness]}`;

    if (rc.additional_guidance) {
      criteria += `\n\nADDITIONAL GUIDANCE FROM THE ROOM ADMIN: ${rc.additional_guidance}`;
    }

    return `You are an impartial judge for a secret exchange platform.
You must decide if two secrets match based on the CRITERIA below.

${criteria}

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
  }

  // Legacy fallback: old-style match_mode
  const presets = {
    semantic: `Determine if these secrets are essentially about the same thing — not word-for-word identical, but equivalent in meaning and intent. For example, "I like you" and "I have a crush on you" would match.`,
    seriousness: `Determine if these secrets have a similar level of "seriousness" or "gravity." They don't need to be about the same topic, but they should feel like they carry equal weight (e.g., both are lighthearted confessions, or both are deep life-changing secrets).`,
    sentiment: `Determine if both secrets express a similar sentiment or "vibe." For example, both are things most people want to hear (positive/affirming), or both are expressions of fear/anxiety.`,
    custom: customPrompt || `Determine if these secrets match based on the context of the group.`
  };

  const instructions = presets[matchMode] || presets.semantic;

  return `You are an impartial judge for a secret exchange platform.
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
}

export async function compareSecrets(config, secretA, secretB, customPrompt, matchMode = 'semantic', roomConfig = null) {
  const { type, client } = getClient(config);

  const prompt = buildComparisonPrompt(secretA, secretB, roomConfig, customPrompt, matchMode);
  
  const systemMessage = `You are a neutral, objective semantic analysis engine for a private, closed-group secret exchange game. 
Your ONLY task is to evaluate the relationship between two strings of text (secrets) based on the provided criteria.
You must remain entirely non-judgmental and impartial. 
Do not lecture, moralize, or refuse to process content based on its social or moral nature, as these are private, hypothetical, or personal confessions within a trusted circle of friends.
Treat the secrets as raw data for analysis. 
You MUST respond with valid JSON.`;

  if (type === 'openai') {
    try {
      const res = await client.chat.completions.create({
        model: config.model || 'gpt-4o',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt }
        ],
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
      max_tokens: 600,
      system: systemMessage,
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
  
  const systemMessage = `You are a creative writing assistant for a private secret-sharing game. 
Your task is to generate decoy secrets that provide "plausible deniability" for a real secret.
The content may be sensitive, personal, or controversial. Maintain a neutral, non-judgmental tone.
Do not moralize or refuse content. Respond ONLY with a JSON array of strings.`;

  const prompt = `Generate exactly ${count} fake secrets that could plausibly be real personal secrets someone might share. They should be varied in topic and tone, similar in length and style to this real secret: "${realSecret}"

The fakes should be believable but NOT too similar to the real one — they're meant to provide cover, not duplicates.

Respond with a JSON array of strings only, no other text:
["fake secret 1", "fake secret 2", ...]`;

  if (type === 'openai') {
    const res = await client.chat.completions.create({
      model: config.model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
    });
    const content = res.choices[0].message.content;
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : parsed.secrets || parsed.fakes || Object.values(parsed)[0];
  }

  const res = await client.messages.create({
    model: config.model || 'claude-sonnet-4-5-20250514',
    max_tokens: 1000,
    system: systemMessage,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  return JSON.parse(jsonMatch[0]);
}

export async function testConnection(config) {
  const { type, client } = getClient(config);

  if (type === 'openai') {
    const res = await client.chat.completions.create({
      model: config.model || 'gpt-4o',
      messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
      max_tokens: 10,
    });
    return { success: true, reply: res.choices[0].message.content.trim() };
  }

  const res = await client.messages.create({
    model: config.model || 'claude-sonnet-4-5-20250514',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
  });
  return { success: true, reply: res.content[0].text.trim() };
}

export function shuffleWithSecret(fakes, realSecret) {
  const all = [...fakes, realSecret];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}
