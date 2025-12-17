// Telegram WebApp initialization
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
tg.enableClosingConfirmation();

const $ = id => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const cameraInput = $('cameraInput');
const cameraBtn = $('cameraBtn');
const galleryBtn = $('galleryBtn');
const preview = $('preview');
const previewImg = $('previewImg');
const removeBtn = $('removeBtn');
const analyzeBtn = $('analyzeBtn');
const timeframe = $('timeframe');
const timeframeConfirm = $('timeframeConfirm');
const detectedTimeframe = $('detectedTimeframe');
const confirmTimeframeBtn = $('confirmTimeframeBtn');
const changeTimeframeBtn = $('changeTimeframeBtn');
const results = $('results');
const error = $('error');
let selectedFile = null;
let detectedTimeframeValue = null;
let analysisData = null;

// Apply Telegram theme
document.body.style.backgroundColor = tg.themeParams.bg_color || '#000000';
document.body.style.color = tg.themeParams.text_color || '#ffffff';

// Dropzone click - don't trigger on mobile buttons or remove button
dropzone.addEventListener('click', e => {
  if (!e.target.closest('.remove-btn') && !e.target.closest('.mobile-btn')) {
    fileInput.click();
  }
});

// File input handlers
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
cameraInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

// Mobile button handlers
cameraBtn.addEventListener('click', e => {
  e.stopPropagation();
  cameraInput.click();
  tg.HapticFeedback.impactOccurred('light');
});

galleryBtn.addEventListener('click', e => {
  e.stopPropagation();
  fileInput.click();
  tg.HapticFeedback.impactOccurred('light');
});
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
    else showError('Please drop an image file');
});

function handleFile(file) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = e => {
        previewImg.src = e.target.result;
        document.querySelector('.dropzone-content').classList.add('hidden');
        preview.classList.remove('hidden');
        analyzeBtn.disabled = false;
        tg.MainButton.show(); // Show Telegram MainButton
        hideError();
    };
    reader.readAsDataURL(file);
}

removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    selectedFile = null;
    fileInput.value = '';
    cameraInput.value = '';
    previewImg.src = '';
    preview.classList.add('hidden');
    document.querySelector('.dropzone-content').classList.remove('hidden');
    analyzeBtn.disabled = true;
    tg.MainButton.hide(); // Hide Telegram MainButton
    results.classList.add('hidden');
    timeframeConfirm.classList.add('hidden');
    analysisData = null;
});

// Telegram MainButton handler
tg.MainButton.setText('Analyze Chart');
tg.MainButton.color = tg.themeParams.button_color || '#00ff88';
tg.MainButton.textColor = tg.themeParams.button_text_color || '#000000';
tg.MainButton.onClick(analyzeChart);

async function analyzeChart() {
    if (!selectedFile) return;
    const btnText = analyzeBtn.querySelector('.btn-text');
    const btnLoader = analyzeBtn.querySelector('.btn-loader');
    try {
        tg.MainButton.showProgress();
        analyzeBtn.disabled = true;
        btnText.textContent = 'Analyzing...';
        btnLoader.classList.remove('hidden');
        hideError();
        results.classList.add('hidden');

        const formData = new FormData();
        formData.append('chart', selectedFile);
        formData.append('timeframe', timeframe.value);
        formData.append('initData', tg.initData); // Send Telegram auth data

        const response = await fetch('/api/analyze', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to analyze chart');
        displayResults(data);
        tg.HapticFeedback.notificationOccurred('success');
    } catch (err) {
        showError(err.message || 'Failed to analyze chart. Please try again.');
        tg.HapticFeedback.notificationOccurred('error');
    } finally {
        tg.MainButton.hideProgress();
        analyzeBtn.disabled = false;
        btnText.textContent = 'Analyze Chart';
        btnLoader.classList.add('hidden');
    }
}

// Also keep regular button for web fallback
analyzeBtn.addEventListener('click', analyzeChart);

function displayResults(data) {
    // Check if timeframe needs confirmation (auto mode with low/medium confidence)
    if (timeframe.value === 'auto' && data.timeframe && data.timeframeConfidence !== 'high') {
        analysisData = data;
        detectedTimeframeValue = data.timeframe;
        const chartTypeText = data.chartType !== 'candlestick' ? ` (${data.chartType} chart)` : '';
        detectedTimeframe.textContent = `${formatTimeframe(data.timeframe)}${chartTypeText}`;
        timeframeConfirm.classList.remove('hidden');
        results.classList.add('hidden');
        return;
    }

    // Display results normally
    $('recommendation').textContent = data.recommendation;
    $('recommendation').className = `card-value recommendation ${data.recommendation}`;
    $('certainty').textContent = data.certainty;
    $('riskReward').textContent = data.riskRewardRatio || 'N/A';
    $('entryPrice').textContent = data.entryPrice || 'N/A';
    $('stopLoss').textContent = data.stopLoss || 'N/A';
    $('takeProfit').textContent = data.takeProfit || 'N/A';
    $('report').textContent = data.report;

    // Show chart type info if detected
    if (data.chartType && data.chartType !== 'candlestick') {
        $('report').textContent = `Chart Type: ${data.chartType}\nTimeframe: ${formatTimeframe(data.timeframe || timeframe.value)}\n\n${data.report}`;
    }

    timeframeConfirm.classList.add('hidden');
    results.classList.remove('hidden');
    setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function formatTimeframe(tf) {
    const map = { '1m': '1 Minute', '5m': '5 Minutes', '15m': '15 Minutes', '30m': '30 Minutes',
                  '1h': '1 Hour', '4h': '4 Hours', '1d': '1 Day', '1w': '1 Week', '1M': '1 Month' };
    return map[tf] || tf;
}

// Timeframe confirmation handlers
confirmTimeframeBtn.addEventListener('click', () => {
    if (analysisData) {
        tg.HapticFeedback.notificationOccurred('success');
        displayResults(analysisData);
    }
});

changeTimeframeBtn.addEventListener('click', () => {
    timeframeConfirm.classList.add('hidden');
    timeframe.value = '1h'; // Reset to default
    timeframe.focus();
    tg.HapticFeedback.impactOccurred('light');
    showError('Please select the correct timeframe and analyze again.');
});

function showError(msg) { error.textContent = msg; error.classList.remove('hidden'); }
function hideError() { error.classList.add('hidden'); }

// Telegram event listeners
tg.onEvent('themeChanged', () => {
    document.body.style.backgroundColor = tg.themeParams.bg_color || '#000000';
    document.body.style.color = tg.themeParams.text_color || '#ffffff';
});

tg.onEvent('viewportChanged', () => {
    if (!tg.isExpanded) tg.expand();
});

// Show user info if available
if (tg.initDataUnsafe.user) {
    console.log('Telegram user:', tg.initDataUnsafe.user.first_name, tg.initDataUnsafe.user.id);
}

window.addEventListener('load', async () => {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        if (!data.apiConfigured) showError('Warning: OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env');
    } catch (e) { console.error('Health check failed:', e); }
});
