import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.mimetype))
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// Telegram initData verification function
function verifyTelegramWebAppData(initData, botToken) {
  if (!initData || !botToken) return null;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== hash) return null;

    // Parse user data
    const userStr = urlParams.get('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch (error) {
    console.error('Telegram verification error:', error);
    return null;
  }
}

// Analyze chart endpoint
app.post('/api/analyze', upload.single('chart'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No chart image provided' });
    if (!req.body.timeframe) return res.status(400).json({ error: 'Timeframe is required' });
    if (!process.env.OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    // Verify Telegram user (optional for web fallback)
    let telegramUser = null;
    if (req.body.initData && process.env.TELEGRAM_BOT_TOKEN) {
      telegramUser = verifyTelegramWebAppData(req.body.initData, process.env.TELEGRAM_BOT_TOKEN);
      if (!telegramUser) {
        console.warn('Invalid Telegram initData, proceeding without auth');
      } else {
        console.log('Telegram user verified:', telegramUser.id, telegramUser.first_name);
      }
    }

    const imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Build AI prompt based on timeframe mode
    const isAutoDetect = req.body.timeframe === 'auto';
    const timeframeText = isAutoDetect
      ? 'Determine the timeframe from the chart (look for labels, time intervals, or date ranges visible)'
      : `${req.body.timeframe} timeframe`;

    const prompt = isAutoDetect
      ? `Analyze this crypto chart. First, detect what timeframe this chart is showing (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M, etc). This could be a candlestick chart OR a line/area chart (like from Phantom wallet). Look for time labels on the X-axis, date ranges, or candle spacing. Respond ONLY with valid JSON: {"timeframe":"detected timeframe","timeframeConfidence":"high/medium/low","chartType":"candlestick/line/area","recommendation":"LONG/SHORT","certainty":85,"entryPrice":"$X (desc)","stopLoss":"$X (-X%)","takeProfit":"$X (+X%)","riskRewardRatio":"X:1","report":"Detailed analysis with patterns, SL/TP justification"}. Min 2:1 R:R required.`
      : `Analyze this ${req.body.timeframe} crypto chart. This could be a candlestick chart OR a line/area chart (like from Phantom wallet). Respond ONLY with valid JSON: {"recommendation":"LONG/SHORT","certainty":85,"entryPrice":"$X (desc)","stopLoss":"$X (-X%)","takeProfit":"$X (+X%)","riskRewardRatio":"X:1","report":"Detailed analysis with patterns, SL/TP justification"}. Min 2:1 R:R required.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-nano-12b-v2-vl:free',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: prompt }
          ]
        }],
        temperature: 0.7,
        max_tokens: 1500
      })
    });

    if (!response.ok) return res.status(response.status).json({ error: 'Failed to analyze chart' });

    const content = (await response.json()).choices[0]?.message?.content;
    if (!content) return res.status(500).json({ error: 'No response from AI' });

    let analysis;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch (e) {
      analysis = {
        recommendation: content.toUpperCase().includes('LONG') ? 'LONG' : 'SHORT',
        certainty: 75,
        entryPrice: 'See report',
        stopLoss: 'See report',
        takeProfit: 'See report',
        riskRewardRatio: '2:1',
        report: content
      };
    }

    res.json({
      recommendation: analysis.recommendation || 'N/A',
      certainty: analysis.certainty || 0,
      entryPrice: analysis.entryPrice || 'Not specified',
      stopLoss: analysis.stopLoss || 'Not specified',
      takeProfit: analysis.takeProfit || 'Not specified',
      riskRewardRatio: analysis.riskRewardRatio || 'N/A',
      report: analysis.report || content,
      timeframe: analysis.timeframe || req.body.timeframe,
      timeframeConfidence: analysis.timeframeConfidence || 'high',
      chartType: analysis.chartType || 'candlestick'
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to analyze chart', message: error.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', apiConfigured: !!process.env.OPENROUTER_API_KEY }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (process.env.NODE_ENV !== 'production') {
  app.listen(process.env.PORT || 3000, () => console.log('🚀 Server running on port', process.env.PORT || 3000));
}

export default app;
