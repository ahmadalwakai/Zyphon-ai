#!/usr/bin/env node
/**
 * Groq LLM Health Test
 * 
 * Tests the Groq API connection and measures latency.
 * 
 * Usage:
 *   node scripts/test-groq.mjs
 * 
 * Required env vars:
 *   GROQ_API_KEY - Your Groq API key
 * 
 * Optional env vars:
 *   GROQ_MODEL - Model to use (default: llama-3.3-70b-versatile)
 *   GROQ_BASE_URL - API base URL (default: https://api.groq.com/openai/v1)
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';

async function testGroq() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              GROQ LLM HEALTH TEST                          ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Model:    ${GROQ_MODEL.padEnd(47)}║`);
  console.log(`║  Base URL: ${GROQ_BASE_URL.substring(0, 47).padEnd(47)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  if (!GROQ_API_KEY) {
    console.error('❌ ERROR: GROQ_API_KEY environment variable is not set');
    console.error('   Set it with: $env:GROQ_API_KEY = "gsk_your_key_here"');
    process.exit(1);
  }

  console.log('1. Testing API connection...');
  const startTime = Date.now();

  try {
    // Test models endpoint first
    const modelsResponse = await fetch(`${GROQ_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
    });

    if (!modelsResponse.ok) {
      const errorText = await modelsResponse.text();
      throw new Error(`Models API failed: ${modelsResponse.status} - ${errorText}`);
    }

    const modelsData = await modelsResponse.json();
    const modelCount = modelsData.data?.length || 0;
    console.log(`   ✓ API connection OK (${modelCount} models available)`);

    // Test chat completion
    console.log('\n2. Testing chat completion...');
    const chatStartTime = Date.now();

    const chatResponse = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise.' },
          { role: 'user', content: 'Say hello in one sentence.' },
        ],
        temperature: 0.1,
        max_tokens: 100,
        stream: false,
      }),
    });

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      throw new Error(`Chat API failed: ${chatResponse.status} - ${errorText}`);
    }

    const chatData = await chatResponse.json();
    const latency = Date.now() - chatStartTime;
    const content = chatData.choices?.[0]?.message?.content || '';
    const tokens = chatData.usage?.total_tokens || 0;

    console.log(`   ✓ Chat completion OK`);
    console.log(`   Latency: ${latency}ms`);
    console.log(`   Tokens used: ${tokens}`);
    console.log(`   Response (first 80 chars):`);
    console.log(`   "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`);

    // Summary
    const totalTime = Date.now() - startTime;
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST RESULTS                            ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Status:       ✓ PASSED                                    ║`);
    console.log(`║  Total time:   ${String(totalTime).padEnd(43)}ms║`);
    console.log(`║  Chat latency: ${String(latency).padEnd(43)}ms║`);
    console.log('╚════════════════════════════════════════════════════════════╝');

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`\n❌ FAILED after ${totalTime}ms`);
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }
}

testGroq();
