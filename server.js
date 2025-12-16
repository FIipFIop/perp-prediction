import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.mimetype))
});

app.use(express.json());
app.use(express.static('public'));

// Analyze chart endpoint
app.post('/api/analyze', upload.single('chart'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No chart image provided' });
    if (!req.body.timeframe) return res.status(400).json({ error: 'Timeframe is required' });
    if (!process.env.OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    const imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

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
            { type: 'text', text: `Analyze this ${req.body.timeframe} crypto chart. Respond ONLY with valid JSON: {"recommendation":"LONG/SHORT","certainty":85,"entryPrice":"$X (desc)","stopLoss":"$X (-X%)","takeProfit":"$X (+X%)","riskRewardRatio":"X:1","report":"Detailed analysis with patterns, SL/TP justification"}. Min 2:1 R:R required.` }
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
      report: analysis.report || content
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to analyze chart', message: error.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', apiConfigured: !!process.env.OPENROUTER_API_KEY }));

app.listen(process.env.PORT || 3000, () => console.log('🚀 Server running on port', process.env.PORT || 3000));
