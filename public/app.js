const $ = id => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const preview = $('preview');
const previewImg = $('previewImg');
const removeBtn = $('removeBtn');
const analyzeBtn = $('analyzeBtn');
const timeframe = $('timeframe');
const results = $('results');
const error = $('error');
let selectedFile = null;

dropzone.addEventListener('click', e => { if (!e.target.closest('.remove-btn')) fileInput.click(); });
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
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
        hideError();
    };
    reader.readAsDataURL(file);
}

removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    selectedFile = null;
    fileInput.value = '';
    previewImg.src = '';
    preview.classList.add('hidden');
    document.querySelector('.dropzone-content').classList.remove('hidden');
    analyzeBtn.disabled = true;
    results.classList.add('hidden');
});

analyzeBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    const btnText = analyzeBtn.querySelector('.btn-text');
    const btnLoader = analyzeBtn.querySelector('.btn-loader');
    try {
        analyzeBtn.disabled = true;
        btnText.textContent = 'Analyzing...';
        btnLoader.classList.remove('hidden');
        hideError();
        results.classList.add('hidden');

        const formData = new FormData();
        formData.append('chart', selectedFile);
        formData.append('timeframe', timeframe.value);

        const response = await fetch('/api/analyze', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to analyze chart');
        displayResults(data);
    } catch (err) {
        showError(err.message || 'Failed to analyze chart. Please try again.');
    } finally {
        analyzeBtn.disabled = false;
        btnText.textContent = 'Analyze Chart';
        btnLoader.classList.add('hidden');
    }
});

function displayResults(data) {
    $('recommendation').textContent = data.recommendation;
    $('recommendation').className = `card-value recommendation ${data.recommendation}`;
    $('certainty').textContent = data.certainty;
    $('riskReward').textContent = data.riskRewardRatio || 'N/A';
    $('entryPrice').textContent = data.entryPrice || 'N/A';
    $('stopLoss').textContent = data.stopLoss || 'N/A';
    $('takeProfit').textContent = data.takeProfit || 'N/A';
    $('report').textContent = data.report;
    results.classList.remove('hidden');
    setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function showError(msg) { error.textContent = msg; error.classList.remove('hidden'); }
function hideError() { error.classList.add('hidden'); }

window.addEventListener('load', async () => {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        if (!data.apiConfigured) showError('Warning: OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env');
    } catch (e) { console.error('Health check failed:', e); }
});
