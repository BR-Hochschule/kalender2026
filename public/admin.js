'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { csrf: '', calendar: null, day: 1, dirty: false, imageId: null, imageUrl: '', uploading: false, saving: false, linkCounter: 0 };
  const errorMessage = (error) => error instanceof Error ? error.message : 'Es ist ein Fehler aufgetreten.';

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
    let response;
    try { response = await fetch(path, { credentials: 'same-origin', ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
    catch { throw new Error('Der Server ist gerade nicht erreichbar. Bitte versuche es erneut.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/admin/login') {
        const wasEditing = !$('workspace').hidden;
        if ($('preview-dialog').open) $('preview-dialog').close();
        showLogin(true, wasEditing);
        if (wasEditing) $('login-error').textContent = 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.';
      }
      throw new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `Die Anfrage konnte nicht abgeschlossen werden (${response.status}).`);
    }
    return data;
  }

  function clearError(region) {
    $(region).textContent = '';
    $(region).classList.remove('sr-only');
    $(`${region}-detail`)?.remove();
    document.querySelectorAll(`[data-error-region="${region}"]`).forEach((field) => {
      field.removeAttribute('aria-invalid');
      delete field.dataset.errorRegion;
      const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== region && id !== `${region}-detail`);
      if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
      else field.removeAttribute('aria-describedby');
    });
  }

  function showError(region, message, field) {
    clearError(region);
    let description = region;
    if (field && region === 'editor-error') {
      const detail = document.createElement('p');
      detail.id = description = `${region}-detail`;
      detail.className = 'error field-error';
      detail.textContent = message;
      (field.closest('.image-zone') || field).after(detail);
      $(region).classList.add('sr-only');
    }
    $(region).textContent = message;
    if (!field) return;
    field.dataset.errorRegion = region;
    field.setAttribute('aria-invalid', 'true');
    const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    field.setAttribute('aria-describedby', [...new Set([...descriptions, description])].join(' '));
    field.focus();
  }

  function invalid(message, field) {
    return Object.assign(new Error(message), { field });
  }

  function showLogin(configured = true, moveFocus = false) {
    $('loading').hidden = true;
    $('workspace').hidden = true;
    $('logout').hidden = true;
    $('login-panel').hidden = false;
    $('setup-notice').hidden = configured;
    $('login-form').hidden = !configured;
    $('login-status').textContent = '';
    if (moveFocus) $('login-heading').focus();
  }

  function markDirty() {
    if (state.saving || state.dirty) return;
    state.dirty = true;
    $('editor-status').textContent = '';
    $('save-state').textContent = 'Nicht gespeichert';
    $('save-state').classList.add('unsaved');
  }

  function renderDoorList() {
    const fragment = document.createDocumentFragment();
    let ready = 0;
    state.calendar.doors.forEach((door) => {
      if (door.published) ready += 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'door-item';
      button.textContent = door.day;
      button.dataset.day = door.day;
      button.setAttribute('aria-label', `Türchen ${door.day}, ${door.published ? 'bereit' : 'Entwurf'}`);
      button.setAttribute('aria-controls', 'door-editor');
      button.setAttribute('aria-current', String(door.day === state.day));
      const marker = document.createElement('span');
      marker.className = 'door-symbol';
      marker.textContent = door.published ? '✓' : '–';
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
      button.addEventListener('click', () => chooseDoor(door.day, true));
      fragment.append(button);
    });
    $('door-list').replaceChildren(fragment);
    $('ready-count').textContent = `${ready} von 24 bereit`;
  }

  function renderImage() {
    $('image-placeholder').hidden = !!state.imageUrl;
    $('image-preview').hidden = !state.imageUrl;
    $('remove-image').hidden = !state.imageUrl;
    $('image-alt-field').hidden = !state.imageUrl;
    if (state.imageUrl) $('image-preview').src = state.imageUrl;
    else $('image-preview').removeAttribute('src');
    $('image-preview').alt = $('image-alt').value.trim();
  }

  function addLink(link = {}) {
    if ($('links').children.length >= 3) return;
    const row = document.createElement('div');
    row.className = 'link-row';
    const key = `link-${++state.linkCounter}`;
    [['label', 'Beschriftung', 'Zum Beispiel: Rezept ansehen'], ['url', 'Adresse', 'https://…']].forEach(([field, caption, placeholder]) => {
      const group = document.createElement('div');
      const label = document.createElement('label');
      label.htmlFor = `${key}-${field}`;
      label.textContent = caption;
      const input = document.createElement('input');
      input.id = label.htmlFor;
      input.dataset.field = field;
      input.type = field === 'url' ? 'url' : 'text';
      input.maxLength = field === 'url' ? 2000 : 120;
      input.value = link[field] || '';
      input.placeholder = placeholder;
      if (field === 'url') input.setAttribute('aria-describedby', 'links-help');
      group.append(label, input);
      row.append(group);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      if (state.saving) return;
      const next = row.nextElementSibling || row.previousElementSibling;
      if (row.querySelector('[aria-invalid=true]')) clearError('editor-error');
      row.remove();
      updateLinkButton();
      markDirty();
      (next?.querySelector('input') || $('add-link')).focus();
    });
    row.append(remove);
    $('links').append(row);
    updateLinkButton();
    return row;
  }

  function updateLinkButton() {
    $('add-link').hidden = $('links').children.length >= 3;
    [...$('links').children].forEach((row, i) => {
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `Link ${i + 1}`);
      row.querySelector('button').setAttribute('aria-label', `Link ${i + 1} entfernen`);
    });
  }

  function chooseDoor(day, moveFocus = false) {
    if (state.uploading || state.saving) { $('editor-status').textContent = 'Bitte warte, bis der laufende Vorgang abgeschlossen ist.'; return; }
    if (moveFocus && state.day === day) { $('editor-heading').focus(); return; }
    if (state.dirty && !window.confirm('Dieses Türchen hat ungespeicherte Änderungen. Änderungen verwerfen und wechseln?')) return;
    const door = state.calendar.doors.find((item) => item.day === day);
    if (!door) return;
    state.day = day;
    $('door-date').textContent = `${day}. Dezember ${state.calendar.year}`;
    $('editor-heading').textContent = `Türchen ${day} gestalten`;
    $('door-title').value = door.title || '';
    $('door-text').value = door.text || '';
    $('door-type').value = door.type === 'link' ? 'link' : 'content';
    $('door-published').checked = !!door.published;
    state.imageId = door.imageId || null;
    state.imageUrl = door.imageUrl || '';
    $('image-alt').value = door.imageAlt || '';
    $('image-file').value = '';
    renderImage();
    clearError('editor-error');
    $('links').replaceChildren();
    (door.links || []).forEach(addLink);
    updateLinkButton();
    $('editor-status').textContent = '';
    state.dirty = false;
    $('save-state').textContent = 'Gespeichert';
    $('save-state').classList.remove('unsaved');
    renderDoorList();
    if (moveFocus) $('editor-heading').focus();
  }

  async function loadWorkspace(moveFocus = false) {
    const calendar = await api('/api/admin/calendar');
    calendar.doors = Array.from({ length: 24 }, (_, i) => calendar.doors.find((d) => Number(d.day) === i + 1) || { day: i + 1, title: '', text: '', type: 'content', links: [], published: false });
    const keepDraft = state.calendar && state.dirty;
    state.calendar = calendar;
    $('calendar-year').value = calendar.year;
    $('year-heading').textContent = calendar.year;
    if (keepDraft) {
      $('door-date').textContent = `${state.day}. Dezember ${calendar.year}`;
      clearError('editor-error');
      renderDoorList();
      $('editor-status').textContent = 'Deine ungespeicherten Änderungen sind noch da. Du kannst weiterarbeiten oder sie jetzt speichern.';
    } else {
      chooseDoor(state.day);
    }
    $('loading').hidden = true;
    $('login-panel').hidden = true;
    $('workspace').hidden = false;
    $('logout').hidden = false;
    if (moveFocus) $(keepDraft ? 'editor-heading' : 'workspace-heading').focus();
  }

  function formData(published, requireTitle = true) {
    const title = $('door-title').value.trim();
    if (requireTitle && !title) throw invalid('Bitte gib dem Türchen einen Titel.', $('door-title'));
    const links = [];
    for (const row of $('links').children) {
      const labelField = row.querySelector('[data-field=label]');
      const urlField = row.querySelector('[data-field=url]');
      const link = { label: labelField.value.trim(), url: urlField.value.trim() };
      if (!link.label && !link.url) continue;
      if (!link.label) throw invalid('Bitte gib für diesen Link eine Beschriftung ein.', labelField);
      if (!link.url) throw invalid('Bitte gib für diesen Link eine Adresse ein.', urlField);
      let url;
      try { url = new URL(link.url); } catch { throw invalid('Bitte gib eine vollständige Adresse ein, zum Beispiel https://example.org.', urlField); }
      if (!['http:', 'https:'].includes(url.protocol)) throw invalid('Die Adresse muss mit https:// oder http:// beginnen.', urlField);
      links.push(link);
    }
    if ($('door-type').value === 'link' && !links.length && published) {
      const row = $('links').firstElementChild || addLink();
      throw invalid('Ein Link-Türchen braucht mindestens einen vollständigen Link, bevor es freigegeben werden kann.', row.querySelector('input'));
    }
    return { title, text: $('door-text').value, type: $('door-type').value, links, published, imageId: state.imageId, imageAlt: state.imageId ? $('image-alt').value.trim() : '' };
  }

  function setBusy(busy) {
    state.saving = busy;
    ['save-door', 'save-draft', 'image-file', 'remove-image', 'add-link', 'preview-door'].forEach((id) => { $(id).setAttribute('aria-disabled', String(busy)); });
    ['door-title', 'door-text', 'image-alt'].forEach((id) => { $(id).readOnly = busy; });
    ['door-type', 'door-published'].forEach((id) => { $(id).disabled = busy; });
    $('links').querySelectorAll('input').forEach((el) => { el.readOnly = busy; });
    $('links').querySelectorAll('button').forEach((el) => { el.setAttribute('aria-disabled', String(busy)); });
    if (busy) $('editor-status').textContent = 'Türchen wird gespeichert …';
  }

  async function saveDoor(asDraft = false) {
    if (state.saving) return;
    clearError('editor-error');
    if (state.uploading) { showError('editor-error', 'Bitte warte, bis das Bild hochgeladen wurde.'); return; }
    try {
      const payload = formData(asDraft ? false : $('door-published').checked);
      setBusy(true);
      const saved = await api(`/api/admin/doors/${state.day}`, { method: 'PUT', body: payload });
      const door = saved.door || saved;
      state.calendar.doors = state.calendar.doors.map((item) => item.day === state.day ? { ...item, ...payload, ...door, day: state.day, imageUrl: door.imageUrl || state.imageUrl } : item);
      state.dirty = false;
      setBusy(false);
      const active = document.activeElement;
      const linkRow = active?.closest('.link-row');
      const linkIndex = linkRow ? [...$('links').children].indexOf(linkRow) : -1;
      const linkControl = active?.dataset.field ? `[data-field=${active.dataset.field}]` : 'button';
      const activeDoor = active?.matches('.door-item') ? active.dataset.day : null;
      chooseDoor(state.day);
      if (linkIndex !== -1) ($('links').children[linkIndex]?.querySelector(linkControl) || $(asDraft ? 'save-draft' : 'save-door')).focus();
      if (activeDoor) $('door-list').querySelector(`[data-day="${activeDoor}"]`)?.focus();
      $('editor-status').textContent = asDraft ? `Türchen ${state.day} als Entwurf gespeichert.` : `Türchen ${state.day} gespeichert${payload.published ? ' und für den Advent freigegeben' : ''}.`;
    } catch (error) {
      $('editor-status').textContent = '';
      if (!$('workspace').hidden) showError('editor-error', errorMessage(error), error.field);
    }
    finally { setBusy(false); }
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.setAttribute('aria-disabled', 'true');
    clearError('login-error');
    $('login-status').textContent = 'Anmeldung wird geprüft …';
    try {
      const session = await api('/api/admin/login', { method: 'POST', body: { username: $('username').value.trim(), password: $('password').value } });
      state.csrf = session.csrfToken;
      $('password').value = '';
      await loadWorkspace(true);
    } catch (error) { showError('login-error', errorMessage(error)); }
    finally {
      button.setAttribute('aria-disabled', 'false');
      $('login-status').textContent = '';
    }
  });

  $('logout').addEventListener('click', async () => {
    if ($('logout').getAttribute('aria-disabled') === 'true') return;
    if (state.uploading || state.saving) return;
    if (state.dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und abmelden?')) return;
    clearError('session-error');
    $('logout').setAttribute('aria-disabled', 'true');
    try {
      await api('/api/admin/logout', { method: 'POST', body: {} });
      state.csrf = '';
      state.dirty = false;
      state.calendar = null;
      showLogin(true, true);
      clearError('login-error');
      $('login-status').textContent = 'Du bist abgemeldet.';
    } catch (error) {
      if (!$('workspace').hidden) showError('session-error', errorMessage(error));
    } finally { $('logout').setAttribute('aria-disabled', 'false'); }
  });

  $('door-form').addEventListener('input', (event) => {
    if (event.target.id === 'image-file') return;
    if (event.target.dataset.errorRegion) clearError(event.target.dataset.errorRegion);
    if (event.target.id === 'image-alt') $('image-preview').alt = event.target.value.trim();
    markDirty();
  });
  $('door-form').addEventListener('change', (event) => { if (event.target.id !== 'image-file') markDirty(); });
  $('door-form').addEventListener('submit', (event) => { event.preventDefault(); saveDoor(); });
  $('save-draft').addEventListener('click', () => saveDoor(true));
  $('add-link').addEventListener('click', () => {
    if (state.saving) return;
    const row = addLink();
    if (!row) return;
    markDirty();
    row.querySelector('input').focus();
  });
  $('remove-image').addEventListener('click', () => {
    if (state.saving || state.uploading) return;
    state.imageId = null;
    state.imageUrl = '';
    $('image-file').value = '';
    $('image-alt').value = '';
    clearError('editor-error');
    renderImage();
    markDirty();
    $('image-file').focus();
  });

  $('image-file').addEventListener('click', (event) => { if (state.saving || state.uploading) event.preventDefault(); });
  $('image-file').addEventListener('change', async () => {
    if (state.saving || state.uploading) return;
    const file = $('image-file').files[0];
    if (!file) return;
    clearError('editor-error');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { showError('editor-error', 'Bitte wähle ein JPG-, PNG- oder WebP-Bild.', $('image-file')); $('image-file').value = ''; return; }
    if (file.size > 8 * 1024 * 1024) { showError('editor-error', 'Das Bild ist zu groß. Bitte verwende ein Bild bis 8 MB.', $('image-file')); $('image-file').value = ''; return; }
    state.uploading = true;
    $('image-file').setAttribute('aria-disabled', 'true');
    $('remove-image').setAttribute('aria-disabled', 'true');
    $('image-alt').readOnly = true;
    $('save-state').textContent = 'Bild wird hochgeladen …';
    try {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.')); reader.readAsDataURL(file); });
      const uploaded = await api('/api/admin/upload', { method: 'POST', body: { name: file.name, dataUrl } });
      state.imageId = uploaded.imageId;
      state.imageUrl = uploaded.imageUrl;
      $('image-alt').value = '';
      renderImage();
      markDirty();
      $('editor-status').textContent = 'Bild hochgeladen. Speichere das Türchen, um es zu übernehmen.';
    } catch (error) { if (!$('workspace').hidden) showError('editor-error', errorMessage(error), $('image-file')); }
    finally {
      state.uploading = false;
      $('image-file').setAttribute('aria-disabled', 'false');
      $('remove-image').setAttribute('aria-disabled', 'false');
      $('image-alt').readOnly = false;
      $('image-file').value = '';
      $('save-state').textContent = state.dirty ? 'Nicht gespeichert' : 'Gespeichert';
    }
  });

  $('calendar-year').addEventListener('input', () => {
    clearError('year-error');
    $('year-status').textContent = '';
  });
  $('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    if (button.getAttribute('aria-disabled') === 'true') return;
    clearError('year-error');
    $('year-status').textContent = '';
    const year = Number($('calendar-year').value);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) { showError('year-error', 'Bitte gib ein Kalenderjahr zwischen 2020 und 2100 ein.', $('calendar-year')); return; }
    button.setAttribute('aria-disabled', 'true');
    $('calendar-year').readOnly = true;
    $('year-status').textContent = 'Kalenderjahr wird gespeichert …';
    try {
      const settings = await api('/api/admin/settings', { method: 'PUT', body: { year, timeZone: 'Europe/Berlin' } });
      state.calendar.year = settings.year || year;
      $('year-heading').textContent = state.calendar.year;
      $('door-date').textContent = `${state.day}. Dezember ${state.calendar.year}`;
      $('year-status').textContent = `Kalenderjahr ${state.calendar.year} gespeichert.`;
    } catch (error) { $('year-status').textContent = ''; showError('year-error', errorMessage(error)); }
    finally {
      $('calendar-year').readOnly = false;
      button.setAttribute('aria-disabled', 'false');
    }
  });

  $('preview-door').addEventListener('click', () => {
    if (state.saving) return;
    clearError('editor-error');
    try {
      const data = formData(false, false);
      $('preview-date').textContent = `${state.day}. Dezember ${state.calendar.year}`;
      $('preview-title').textContent = data.title || `Türchen ${state.day}`;
      $('preview-text').textContent = data.text;
      $('preview-text').hidden = !data.text;
      $('preview-modal-image').hidden = !state.imageUrl;
      $('preview-modal-image').alt = data.imageAlt;
      if (state.imageUrl) $('preview-modal-image').src = state.imageUrl;
      else $('preview-modal-image').removeAttribute('src');
      $('preview-links').replaceChildren();
      data.links.forEach((link) => {
        const anchor = document.createElement('a');
        anchor.href = link.url;
        anchor.textContent = link.label;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        const arrow = document.createElement('span');
        arrow.textContent = '↗';
        arrow.setAttribute('aria-hidden', 'true');
        const hint = document.createElement('span');
        hint.className = 'sr-only';
        hint.textContent = ' (öffnet in neuem Tab)';
        anchor.append(arrow, hint);
        $('preview-links').append(anchor);
      });
      $('preview-dialog').showModal();
    } catch (error) { showError('editor-error', errorMessage(error), error.field); }
  });
  $('close-preview').addEventListener('click', () => $('preview-dialog').close());
  $('preview-dialog').addEventListener('close', () => { if (!$('workspace').hidden) $('preview-door').focus(); });
  $('preview-dialog').addEventListener('click', (event) => { if (event.target === $('preview-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
  window.addEventListener('beforeunload', (event) => { if (state.dirty || state.uploading || state.saving) { event.preventDefault(); event.returnValue = ''; } });

  (async () => {
    try {
      const session = await api('/api/admin/session');
      state.csrf = session.csrfToken || '';
      if (session.authenticated) await loadWorkspace();
      else showLogin(session.configured !== false);
    } catch (error) { showLogin(); showError('login-error', errorMessage(error)); }
  })();
})();
