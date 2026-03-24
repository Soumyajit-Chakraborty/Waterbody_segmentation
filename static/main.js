'use strict';

(function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let W, H;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const COUNT = 60;
  for (let i = 0; i < COUNT; i++) {
    particles.push(newParticle());
  }

  function newParticle(fromBottom = false) {
    return {
      x: Math.random() * W,
      y: fromBottom ? H + 5 : Math.random() * H,
      r: Math.random() * 2 + 0.5,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(Math.random() * 0.4 + 0.1),
      alpha: Math.random() * 0.4 + 0.05,
      life: Math.random(),
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life += 0.002;

      const alpha = Math.sin(p.life * Math.PI) * p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(74, 222, 128, ${alpha})`;
      ctx.fill();

      if (p.y < -10) particles[i] = newParticle(true);
    });
    requestAnimationFrame(draw);
  }
  draw();
})();



const nav = document.getElementById('main-nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);

  const sections = ['hero', 'upload-section', 'how-it-works', 'results-section'];
  let current = 'hero';
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.top <= 100) current = id;
    }
  });
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href').replace('#', '');
    link.classList.toggle('active', href === current);
  });
}, { passive: true });



const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('fade-in');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.step-card, .glass-card, .section-header').forEach(el => {
  observer.observe(el);
});



const nNestsSlider = document.getElementById('n-nests');
const nIterSlider  = document.getElementById('n-iter');
const paSlider     = document.getElementById('pa-val');
const nestsVal     = document.getElementById('nests-val');
const iterVal      = document.getElementById('iter-val');
const paDisplay    = document.getElementById('pa-display');

nNestsSlider.addEventListener('input', () => nestsVal.textContent = nNestsSlider.value);
nIterSlider.addEventListener('input',  () => iterVal.textContent  = nIterSlider.value);
paSlider.addEventListener('input',    () => paDisplay.textContent = parseFloat(paSlider.value).toFixed(2));



const dropzone      = document.getElementById('dropzone');
const fileInput     = document.getElementById('file-input');
const dzPreview     = document.getElementById('dz-preview');
const previewImg    = document.getElementById('preview-img');
const previewName   = document.getElementById('preview-name');
const removeBtn     = document.getElementById('remove-file');
const analyzeBtn    = document.getElementById('analyze-btn');
const btnLabel      = analyzeBtn.querySelector('.btn-label');
const btnSpinner    = analyzeBtn.querySelector('.btn-spinner');

let selectedFile = null;

['dragenter', 'dragover'].forEach(ev => {
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
});
['dragleave', 'drop'].forEach(ev => {
  dropzone.addEventListener(ev, () => dropzone.classList.remove('drag-over'));
});
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

dropzone.addEventListener('click', e => {
  if (e.target !== removeBtn && !dzPreview.contains(e.target)) {
    fileInput.click();
  }
});

dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

removeBtn.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  dzPreview.hidden = true;
  previewImg.src = '';
  analyzeBtn.disabled = true;
  btnLabel.textContent = 'Select an Image First';
  document.getElementById('results-section').hidden = true;
});

function handleFile(file) {
  const allowed = ['image/png','image/jpeg','image/tiff','image/bmp','image/webp'];
  if (!allowed.includes(file.type) && !file.name.match(/\.(tif|tiff)$/i)) {
    showToast('Unsupported file format. Please use PNG, JPG, TIFF, BMP, or WEBP.', 'error');
    return;
  }
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    previewImg.src = e.target.result;
    previewName.textContent = file.name;
    dzPreview.hidden = false;
    analyzeBtn.disabled = false;
    btnLabel.textContent = 'Run Segmentation';
  };
  reader.readAsDataURL(file);
}



const progressOverlay = document.getElementById('progress-overlay');
const progressBar     = document.getElementById('progress-bar');
const progressMsg     = document.getElementById('progress-msg');

const progressSteps = [
  { pct: 15, msg: 'Computing Water Index…' },
  { pct: 30, msg: 'Building Texture Map…' },
  { pct: 50, msg: 'Initializing Cuckoo Nests…' },
  { pct: 70, msg: 'Running ACS Optimization…' },
  { pct: 85, msg: 'Post-processing Mask…' },
  { pct: 95, msg: 'Generating Visualizations…' },
];

analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  progressOverlay.hidden = false;
  progressBar.style.width = '5%';

  let stepIdx = 0;
  const stepInterval = setInterval(() => {
    if (stepIdx < progressSteps.length) {
      const s = progressSteps[stepIdx++];
      progressBar.style.width = s.pct + '%';
      progressMsg.textContent = s.msg;
    }
  }, 700);

  const fd = new FormData();
  fd.append('image', selectedFile);
  fd.append('n_nests', nNestsSlider.value);
  fd.append('n_iter', nIterSlider.value);
  fd.append('pa', paSlider.value);

  btnLabel.hidden = true;
  btnSpinner.hidden = false;
  analyzeBtn.disabled = true;

  try {
    const res = await fetch('/segment', { method: 'POST', body: fd });
    const data = await res.json();

    clearInterval(stepInterval);

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Server error');
    }

    progressBar.style.width = '100%';
    progressMsg.textContent = 'Analysis complete!';

    await sleep(600);
    progressOverlay.hidden = true;

    renderResults(data);
  } catch (err) {
    clearInterval(stepInterval);
    progressOverlay.hidden = true;
    showToast('Error: ' + err.message, 'error');
  } finally {
    btnLabel.hidden = false;
    btnSpinner.hidden = true;
    analyzeBtn.disabled = false;
    btnLabel.textContent = 'Run Segmentation';
  }
});



function renderResults(data) {
  const section = document.getElementById('results-section');
  section.hidden = false;

  document.getElementById('res-original').src = 'data:image/png;base64,' + data.original;
  document.getElementById('res-wi').src        = 'data:image/png;base64,' + data.water_index;
  document.getElementById('res-mask').src      = 'data:image/png;base64,' + data.water_mask;
  document.getElementById('res-overlay').src   = 'data:image/png;base64,' + data.overlay;

  const s = data.stats;
  const statsStrip = document.getElementById('stats-strip');

  const chips = [
    { val: s.water_coverage + '%',      label: 'Water Coverage' },
    { val: s.num_water_bodies,          label: 'Water Bodies' },
    { val: s.estimated_area_km2 + ' km²', label: 'Est. Area' },
    { val: s.water_pixels.toLocaleString(), label: 'Water Pixels' },
    { val: s.image_dimensions,          label: 'Resolution' },
    { val: `T_wi:${s.optimal_thresholds.water_index} / T_tex:${s.optimal_thresholds.texture}`, label: 'Optimal Thresholds' },
  ];

  statsStrip.innerHTML = chips.map(c => `
    <div class="stat-chip">
      <span class="chip-val">${c.val}</span>
      <span class="chip-label">${c.label}</span>
    </div>
  `).join('');

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}



document.getElementById('download-btn').addEventListener('click', () => {
  const img = document.getElementById('res-overlay');
  if (!img.src) { showToast('Run analysis first', 'error'); return; }
  const a = document.createElement('a');
  a.href = img.src;
  a.download = 'aqualens_overlay.png';
  a.click();
});



document.getElementById('reset-btn').addEventListener('click', () => {
  document.getElementById('remove-file').click();
  document.getElementById('results-section').hidden = true;
  document.getElementById('upload-section').scrollIntoView({ behavior: 'smooth' });
});



function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 2rem; right: 2rem;
    z-index: 9999;
    padding: 0.9rem 1.5rem;
    border-radius: 12px;
    background: rgba(8, 20, 35, 0.9);
    backdrop-filter: blur(16px);
    border: 1px solid ${type === 'error' ? 'rgba(255,90,90,0.3)' : 'rgba(74,222,128,0.25)'};
    color: ${type === 'error' ? '#ff7070' : '#f0f8f0'};
    font-size: 0.88rem;
    font-weight: 500;
    box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    animation: slideInToast 0.4s ease;
    max-width: 360px;
  `;
  toast.textContent = message;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInToast {
      from { transform: translateX(120%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}


function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
