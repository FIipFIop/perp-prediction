import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.mimetype))
});

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://vcawdkjknxsdshmomavn.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjYXdka2prbnhzZHNobW9tYXZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NjgxMTUsImV4cCI6MjA4MTU0NDExNX0.PqaCUdtUGPvZ9esVxQX1aalpF2eQh-e-gvChxSCZ9yw'
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// Middleware to verify JWT token from Supabase
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  req.user = user;
  next();
};

// Helper function to get wallet balance using Helius API
async function getWalletBalance(walletAddress) {
  try {
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      throw new Error('Helius API key not configured');
    }

    const response = await fetch(`https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${heliusApiKey}`);

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.statusText}`);
    }

    const data = await response.json();
    // Get native SOL balance (in lamports, 1 SOL = 1,000,000,000 lamports)
    const solBalance = data.nativeBalance / 1000000000;
    return solBalance;
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    throw error;
  }
}

// Helper function to verify transaction using Helius API
async function verifyTransaction(senderWallet, receiverWallet, expectedAmount) {
  try {
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      throw new Error('Helius API key not configured');
    }

    // Get recent transactions for the receiver wallet
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${receiverWallet}/transactions?api-key=${heliusApiKey}&limit=10`);

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.statusText}`);
    }

    const transactions = await response.json();

    // Look for a recent transaction from sender to receiver with the expected amount
    const now = Date.now();
    const twoMinutesAgo = now - (2 * 60 * 1000);

    for (const tx of transactions) {
      const txTimestamp = tx.timestamp * 1000; // Convert to milliseconds

      // Check if transaction is within the last 2 minutes
      if (txTimestamp < twoMinutesAgo) continue;

      // Check if transaction involves both sender and receiver
      const accountKeys = tx.accountData?.map(acc => acc.account) || [];
      if (!accountKeys.includes(senderWallet) || !accountKeys.includes(receiverWallet)) continue;

      // Check native transfers (SOL)
      const nativeTransfers = tx.nativeTransfers || [];
      for (const transfer of nativeTransfers) {
        if (transfer.fromUserAccount === senderWallet &&
            transfer.toUserAccount === receiverWallet) {
          const transferAmount = transfer.amount / 1000000000; // Convert lamports to SOL

          // Allow 1% tolerance for transaction fees
          const tolerance = expectedAmount * 0.01;
          if (Math.abs(transferAmount - expectedAmount) <= tolerance) {
            return {
              verified: true,
              signature: tx.signature,
              amount: transferAmount,
              timestamp: txTimestamp
            };
          }
        }
      }
    }

    return { verified: false };
  } catch (error) {
    console.error('Error verifying transaction:', error);
    throw error;
  }
}

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

// ============= AUTHENTICATION ENDPOINTS =============

// Sign up endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || ''
        }
      }
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Signup successful',
      user: data.user,
      session: data.session
    });
  } catch (error) {
    res.status(500).json({ error: 'Signup failed', message: error.message });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    res.json({
      message: 'Login successful',
      user: data.user,
      session: data.session
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// Logout endpoint
app.post('/api/auth/logout', authenticateUser, async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Logout successful' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed', message: error.message });
  }
});

// Get current user endpoint
app.get('/api/auth/user', authenticateUser, async (req, res) => {
  try {
    // Get user credits
    const { data: creditsData, error: creditsError } = await supabase
      .from('user_credits')
      .select('credits')
      .eq('user_id', req.user.id)
      .single();

    if (creditsError) {
      console.error('Error fetching credits:', creditsError);
    }

    res.json({
      user: req.user,
      credits: creditsData?.credits || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user data', message: error.message });
  }
});

// ============= PAYMENT ENDPOINTS =============

// Initialize payment (Step 1: User provides sender wallet)
app.post('/api/payment/init', authenticateUser, async (req, res) => {
  try {
    const { senderWallet } = req.body;

    if (!senderWallet) {
      return res.status(400).json({ error: 'Sender wallet address is required' });
    }

    const receiverWallet = process.env.RECEIVER_WALLET_ADDRESS;
    const analysisCost = parseFloat(process.env.ANALYSIS_COST_SOL || '0.01');

    if (!receiverWallet) {
      return res.status(500).json({ error: 'Receiver wallet not configured' });
    }

    // Check sender wallet balance using Helius API
    let senderBalance;
    try {
      senderBalance = await getWalletBalance(senderWallet);
    } catch (error) {
      return res.status(400).json({ error: 'Failed to verify sender wallet balance' });
    }

    if (senderBalance < analysisCost) {
      return res.status(400).json({
        error: 'Insufficient funds',
        message: `Sender wallet has ${senderBalance.toFixed(4)} SOL, but ${analysisCost} SOL is required`,
        required: analysisCost,
        available: senderBalance
      });
    }

    // Create payment record
    const { data: payment, error } = await supabase
      .from('payments')
      .insert({
        user_id: req.user.id,
        sender_wallet: senderWallet,
        receiver_wallet: receiverWallet,
        amount: 0,
        expected_amount: analysisCost,
        status: 'pending',
        credits_added: 1
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating payment:', error);
      return res.status(500).json({ error: 'Failed to initialize payment' });
    }

    res.json({
      paymentId: payment.id,
      receiverWallet,
      amount: analysisCost,
      senderBalance,
      expiresAt: payment.expires_at
    });
  } catch (error) {
    res.status(500).json({ error: 'Payment initialization failed', message: error.message });
  }
});

// Verify payment (Step 2: Check if payment was sent)
app.post('/api/payment/verify', authenticateUser, async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }

    // Get payment record
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError || !payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Check if payment already verified
    if (payment.status === 'verified') {
      return res.json({
        status: 'verified',
        message: 'Payment already verified',
        credits: 1
      });
    }

    // Check if payment expired
    const now = new Date();
    const expiresAt = new Date(payment.expires_at);
    if (now > expiresAt) {
      await supabase
        .from('payments')
        .update({ status: 'cancelled' })
        .eq('id', paymentId);

      return res.status(400).json({
        status: 'cancelled',
        error: 'Payment verification window expired (2 minutes)'
      });
    }

    // Verify transaction using Helius API
    let verification;
    try {
      verification = await verifyTransaction(
        payment.sender_wallet,
        payment.receiver_wallet,
        payment.expected_amount
      );
    } catch (error) {
      return res.status(500).json({ error: 'Failed to verify transaction with Helius API' });
    }

    if (!verification.verified) {
      return res.json({
        status: 'pending',
        message: 'Transaction not yet confirmed. Please wait...',
        expiresAt: payment.expires_at
      });
    }

    // Update payment record
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'verified',
        amount: verification.amount,
        transaction_signature: verification.signature,
        verified_at: new Date(verification.timestamp).toISOString()
      })
      .eq('id', paymentId);

    if (updateError) {
      console.error('Error updating payment:', updateError);
      return res.status(500).json({ error: 'Failed to update payment status' });
    }

    // Add credits to user
    const { error: creditsError } = await supabase.rpc('increment_credits', {
      p_user_id: req.user.id,
      p_amount: payment.credits_added
    });

    // If RPC doesn't exist, do it manually
    if (creditsError) {
      const { data: currentCredits } = await supabase
        .from('user_credits')
        .select('credits')
        .eq('user_id', req.user.id)
        .single();

      await supabase
        .from('user_credits')
        .update({ credits: (currentCredits?.credits || 0) + payment.credits_added })
        .eq('user_id', req.user.id);
    }

    res.json({
      status: 'verified',
      message: 'Payment verified successfully',
      credits: payment.credits_added,
      transactionSignature: verification.signature
    });
  } catch (error) {
    res.status(500).json({ error: 'Payment verification failed', message: error.message });
  }
});

// Analyze chart endpoint (requires authentication and credits)
app.post('/api/analyze', authenticateUser, upload.single('chart'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No chart image provided' });
    if (!req.body.timeframe) return res.status(400).json({ error: 'Timeframe is required' });
    if (!process.env.OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    // Check if user has credits
    const { data: creditsData, error: creditsError } = await supabase
      .from('user_credits')
      .select('credits')
      .eq('user_id', req.user.id)
      .single();

    if (creditsError || !creditsData) {
      return res.status(500).json({ error: 'Failed to fetch user credits' });
    }

    if (creditsData.credits < 1) {
      return res.status(402).json({
        error: 'Insufficient credits',
        message: 'You need to purchase credits to analyze charts',
        credits: creditsData.credits
      });
    }

    const imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Build AI prompt based on timeframe mode
    const isAutoDetect = req.body.timeframe === 'auto';
    const timeframeText = isAutoDetect
      ? 'Determine the timeframe from the chart (look for labels, time intervals, or date ranges visible)'
      : `${req.body.timeframe} timeframe`;

    const prompt = isAutoDetect
      ? `Analyze this crypto chart and detect its timeframe. IMPORTANT: This could be a CANDLESTICK chart (TradingView/exchanges) OR a LINE/AREA chart from Phantom wallet or other crypto wallets.

TIMEFRAME DETECTION STRATEGY:
1. For Phantom wallet charts (smooth line/area): Check top of chart for timeframe buttons/labels (1H, 1D, 1W, 1M, ALL)
2. For all charts: Look at X-axis time labels and calculate spacing between data points
3. Date range method: If you see "Jan 1 - Jan 7" = likely 1H/4H/1D depending on point density
4. Candle spacing: Wide gaps = higher timeframe (1D/1W), tight = lower (1m/5m/15m/1H)

CHART TYPE IDENTIFICATION:
- Candlestick: Red/green bars with wicks (TradingView, Binance, Coinbase Pro)
- Line: Smooth colored line (Phantom wallet, Trust Wallet, MetaMask)
- Area: Filled gradient under line (Phantom wallet default)

ANALYSIS FOR LINE CHARTS (Phantom wallet):
- Identify trend from line direction and slope
- Find support/resistance at previous price levels where line bounced
- Look for breakouts above/below historical levels
- Consider volume (if visible) at key price points

Respond ONLY with valid JSON: {"timeframe":"1m/5m/15m/30m/1h/4h/1d/1w/1M","timeframeConfidence":"high/medium/low","chartType":"candlestick/line/area","recommendation":"LONG/SHORT","certainty":85,"entryPrice":"$X (desc)","stopLoss":"$X (-X%)","takeProfit":"$X (+X%)","riskRewardRatio":"X:1","report":"Detailed analysis with patterns, trend direction, support/resistance levels, and SL/TP justification"}. Min 2:1 R:R required.`
      : `Analyze this ${req.body.timeframe} crypto chart. IMPORTANT: This could be a candlestick chart OR a line/area chart from Phantom wallet.

ANALYSIS APPROACH:
For CANDLESTICK charts: Use traditional technical analysis (patterns, support/resistance, candle formations)
For LINE/AREA charts (Phantom wallet): Focus on trend direction, price levels, breakouts, and historical bounces

KEY POINTS FOR PHANTOM WALLET CHARTS:
- Smooth line = trend is more important than individual candles
- Support/resistance at previous price levels where line bounced or reversed
- Breakouts above resistance or below support are strong signals
- Consider overall trend strength (steep vs gradual slope)

Respond ONLY with valid JSON: {"recommendation":"LONG/SHORT","certainty":85,"entryPrice":"$X (desc)","stopLoss":"$X (-X%)","takeProfit":"$X (+X%)","riskRewardRatio":"X:1","report":"Detailed analysis identifying chart type, trend direction, key support/resistance levels, and trade rationale"}. Min 2:1 R:R required.`;

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

    // Deduct 1 credit from user
    await supabase
      .from('user_credits')
      .update({ credits: creditsData.credits - 1 })
      .eq('user_id', req.user.id);

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
      chartType: analysis.chartType || 'candlestick',
      creditsRemaining: creditsData.credits - 1
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
