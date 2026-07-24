const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getAnthropicClient } = require('../lib/anthropicClient');

const router = express.Router();

// Lets a member translate any case summary or contribution write-up to
// English on demand. Gated behind auth since each call costs real money.
router.post('/translate', requireAuth, async (req, res) => {
  const text = req.body?.text?.trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  if (text.length > 8000) return res.status(400).json({ error: 'Text is too long to translate' });

  const anthropicClient = getAnthropicClient();
  if (!anthropicClient) return res.status(503).json({ error: 'Translation is not available right now' });

  try {
    const message = await anthropicClient.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Translate the following text to English. Respond with ONLY the translated text — no commentary, no quotes, no notes. If the text is already in English, return it unchanged.\n\n${text}`,
        },
      ],
    });
    const translated = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();
    res.json({ translated });
  } catch (err) {
    console.error('Translation failed:', err.message);
    res.status(502).json({ error: 'Translation failed, try again' });
  }
});

module.exports = router;
