(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const loginScreen = $('#loginScreen');
  const dashboard = $('#dashboard');
  const loginForm = $('#loginForm');
  const state = { status: null, selectedImages: [], toastTimer: null };
  const numberFormat = new Intl.NumberFormat('ar-EG');

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.error || 'حدث خطأ أثناء الاتصال.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function checkSession() {
    try {
      const status = await api('/api/admin/status');
      showDashboard();
      applyStatus(status);
    } catch (error) {
      showLogin();
    }
  }

  function showDashboard() {
    loginScreen.hidden = true;
    dashboard.hidden = false;
  }

  function showLogin() {
    dashboard.hidden = true;
    loginScreen.hidden = false;
    setTimeout(() => $('#passwordInput').focus(), 80);
  }

  function applyStatus(status) {
    state.status = status;
    $('#productCount').textContent = numberFormat.format(status.productCount || 0);
    $('#categoryCount').textContent = numberFormat.format(status.categoryCount || 0);
    $('#imageCount').textContent = numberFormat.format(status.imageCount || 0);
    const date = new Date(status.workbookUpdatedAt);
    $('#updatedAt').textContent = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
    renderImageLibrary(status.images || []);
  }

  async function refreshStatus(showMessage = false) {
    const button = $('#refreshButton');
    button.classList.add('is-loading');
    try {
      const status = await api('/api/admin/status');
      applyStatus(status);
      if (showMessage) toast('تم تحديث البيانات');
    } catch (error) {
      if (error.status === 401) return showLogin();
      toast(error.message, false);
    } finally {
      button.classList.remove('is-loading');
    }
  }

  function renderImageLibrary(images) {
    const query = ($('#imageSearch').value || '').trim().toLowerCase();
    const filtered = images.filter(name => name.toLowerCase().includes(query));
    const target = $('#imageLibrary');
    if (!filtered.length) {
      target.innerHTML = `<div class="library-empty">${query ? 'لا توجد صور مطابقة للبحث.' : 'مكتبة الصور فارغة. ارفع أول صورك من القسم السابق.'}</div>`;
      return;
    }
    target.innerHTML = filtered.map(name => `
      <article class="image-tile">
        <div class="image-tile__preview">
          <img src="/uploads/${encodeURIComponent(name)}" alt="${escapeHTML(name)}" loading="lazy">
          <button type="button" data-delete-image="${escapeHTML(name)}" aria-label="حذف الصورة"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>
        </div>
        <div class="image-tile__name"><span title="${escapeHTML(name)}">${escapeHTML(name)}</span><button type="button" data-copy-name="${escapeHTML(name)}" aria-label="نسخ اسم الصورة"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></svg></button></div>
      </article>`).join('');
  }

  function setButtonLoading(button, loading, loadingText) {
    if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
    button.disabled = loading;
    button.innerHTML = loading ? `<span>${escapeHTML(loadingText)}</span><svg viewBox="0 0 24 24" style="animation:spin .8s linear infinite"><path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 5M4 13l2 5a7 7 0 0 0 11.9-3"/></svg>` : button.dataset.originalText;
  }

  function toast(message, success = true) {
    clearTimeout(state.toastTimer);
    $('#adminToastText').textContent = message;
    $('#adminToastIcon').textContent = success ? '✓' : '!';
    $('#adminToastIcon').style.background = success ? 'var(--gold)' : '#d2695f';
    $('#adminToast').classList.add('is-visible');
    state.toastTimer = setTimeout(() => $('#adminToast').classList.remove('is-visible'), 3400);
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('button[type="submit"]', loginForm);
    $('#loginError').textContent = '';
    setButtonLoading(button, true, 'جاري الدخول...');
    try {
      await api('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('#passwordInput').value })
      });
      showDashboard();
      await refreshStatus();
      toast('أهلًا بك في لوحة إدارة أثر');
    } catch (error) {
      $('#loginError').textContent = error.message;
    } finally {
      setButtonLoading(button, false);
    }
  });

  $('#togglePassword').addEventListener('click', () => {
    const input = $('#passwordInput');
    input.type = input.type === 'password' ? 'text' : 'password';
    input.focus();
  });

  $('#logoutButton').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    $('#passwordInput').value = '';
    showLogin();
  });

  $('#refreshButton').addEventListener('click', () => refreshStatus(true));

  const excelInput = $('#excelFile');
  const excelButton = $('#uploadExcelButton');
  excelInput.addEventListener('change', () => {
    const file = excelInput.files[0];
    $('#excelFilename').textContent = file ? file.name : 'لم يتم اختيار ملف';
    excelButton.disabled = !file;
  });

  $('#excelUploadForm').addEventListener('submit', async event => {
    event.preventDefault();
    const file = excelInput.files[0];
    if (!file) return;
    const data = new FormData();
    data.append('excel', file);
    setButtonLoading(excelButton, true, 'جاري تحديث المتجر...');
    try {
      const result = await api('/api/admin/upload-excel', { method: 'POST', body: data });
      excelInput.value = '';
      $('#excelFilename').textContent = 'لم يتم اختيار ملف';
      toast(`${result.message} (${numberFormat.format(result.productCount)} منتج)`);
      await refreshStatus();
    } catch (error) {
      toast(error.message, false);
    } finally {
      setButtonLoading(excelButton, false);
      excelButton.disabled = !excelInput.files.length;
    }
  });

  const imagesInput = $('#imageFiles');
  const imagesButton = $('#uploadImagesButton');
  imagesInput.addEventListener('change', () => selectImages([...imagesInput.files]));

  function selectImages(files) {
    state.selectedImages = files.filter(file => file.type.startsWith('image/'));
    $('#imagesFilename').textContent = state.selectedImages.length ? `تم اختيار ${numberFormat.format(state.selectedImages.length)} صورة` : 'لم يتم اختيار صور';
    imagesButton.disabled = !state.selectedImages.length;
    const preview = $('#selectedImages');
    preview.innerHTML = '';
    state.selectedImages.slice(0, 10).forEach(file => {
      const url = URL.createObjectURL(file);
      const tile = document.createElement('div');
      tile.className = 'selected-image';
      tile.innerHTML = `<img alt=""><span>${escapeHTML(file.name)}</span>`;
      tile.querySelector('img').src = url;
      tile.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      preview.append(tile);
    });
  }

  $('#imagesUploadForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.selectedImages.length) return;
    const data = new FormData();
    state.selectedImages.forEach(file => data.append('images', file));
    setButtonLoading(imagesButton, true, 'جاري رفع الصور...');
    try {
      const result = await api('/api/admin/upload-images', { method: 'POST', body: data });
      toast(result.message);
      state.selectedImages = [];
      imagesInput.value = '';
      $('#imagesFilename').textContent = 'لم يتم اختيار صور';
      $('#selectedImages').innerHTML = '';
      await refreshStatus();
    } catch (error) {
      toast(error.message, false);
    } finally {
      setButtonLoading(imagesButton, false);
      imagesButton.disabled = !state.selectedImages.length;
    }
  });

  function wireDropzone(zoneSelector, input, onFiles) {
    const zone = $(zoneSelector);
    ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
    }));
    zone.addEventListener('drop', event => {
      const files = [...event.dataTransfer.files];
      if (!files.length) return;
      if (onFiles) return onFiles(files);
      const transfer = new DataTransfer();
      transfer.items.add(files[0]);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    });
  }

  wireDropzone('#excelDropzone', excelInput);
  wireDropzone('#imagesDropzone', imagesInput, selectImages);

  $('#imageSearch').addEventListener('input', () => renderImageLibrary(state.status?.images || []));

  document.addEventListener('click', async event => {
    const copy = event.target.closest('[data-copy-name]');
    if (copy) {
      const name = copy.dataset.copyName;
      try {
        await navigator.clipboard.writeText(name);
      } catch {
        const input = document.createElement('input');
        input.value = name; document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
      }
      toast(`تم نسخ اسم الصورة: ${name}`);
      return;
    }
    const remove = event.target.closest('[data-delete-image]');
    if (remove) {
      const name = remove.dataset.deleteImage;
      if (!confirm(`حذف الصورة «${name}»؟\nتأكد أنها غير مستخدمة في ملف Excel.`)) return;
      remove.disabled = true;
      try {
        await api(`/api/admin/images/${encodeURIComponent(name)}`, { method: 'DELETE' });
        toast('تم حذف الصورة');
        await refreshStatus();
      } catch (error) {
        toast(error.message, false);
        remove.disabled = false;
      }
    }
  });

  const sidebar = $('#sidebar');
  const mobileOverlay = $('#mobileOverlay');
  $('#sidebarButton').addEventListener('click', () => {
    sidebar.classList.add('is-open');
    mobileOverlay.classList.add('is-active');
    document.body.classList.add('is-locked');
  });
  mobileOverlay.addEventListener('click', closeSidebar);
  function closeSidebar() {
    sidebar.classList.remove('is-open');
    mobileOverlay.classList.remove('is-active');
    document.body.classList.remove('is-locked');
  }
  $$('.sidebar nav a').forEach(link => link.addEventListener('click', () => {
    $$('.sidebar nav a').forEach(item => item.classList.remove('is-active'));
    link.classList.add('is-active');
    closeSidebar();
  }));

  checkSession();
})();
