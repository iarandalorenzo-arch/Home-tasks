import { getAll } from './db.js';
import {
  nutritionGetAll,
  nutritionPut,
  nutritionPutMany,
  nutritionRemove,
  nutritionClear,
  resetNutritionDatabase,
  NUTRITION_DATA_STORES,
} from './nutrition-db.js';

const NUTRITION_VERSION = '11-D';
const LS_SELECTED_PERSON = 'hometasks-meals-person';
const LS_SELECTED_DATE = 'hometasks-meals-date';
const LS_SYNC_ENDPOINT = 'hometasks-appsscript-endpoint';
const LS_SYNC_HOUSE_KEY = 'hometasks-appsscript-house-key';
const LS_CLOUD_LINKED = 'hometasks-sync-linked';
const LS_AUTO_SYNC = 'hometasks-sync-auto';
const LS_DEVICE_ID = 'hometasks-device-id';
const LS_NUTRITION_SYNC_DIRTY = 'hometasks-nutrition-sync-dirty';
const LS_NUTRITION_SYNC_REVISION = 'hometasks-nutrition-sync-revision';
const LS_NUTRITION_LAST_SYNC = 'hometasks-nutrition-sync-last';
const ASSISTANT_ENGINE = 'local-v1';
const ASSISTANT_MAX_FOODS = 14;
const ASSISTANT_MAX_ITEMS_PER_MEAL = 3;
const DEFAULT_MEAL_TYPES = [
  { id: 'breakfast', name: 'Desayuno', order: 10, createdAt: 1, modifiedAt: 1, syncVersion: 1 },
  { id: 'lunch', name: 'Comida', order: 20, createdAt: 1, modifiedAt: 1, syncVersion: 1 },
  { id: 'snack', name: 'Merienda', order: 30, createdAt: 1, modifiedAt: 1, syncVersion: 1 },
  { id: 'dinner', name: 'Cena', order: 40, createdAt: 1, modifiedAt: 1, syncVersion: 1 },
];

const makeId = () => (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
  ? globalThis.crypto.randomUUID()
  : `nutrition-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const localISO = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseISO = value => new Date(`${value}T12:00:00`);
const shiftISO = (value, days) => {
  const date = parseISO(value);
  date.setDate(date.getDate() + days);
  return localISO(date);
};
const mondayISO = value => {
  const date = parseISO(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return localISO(date);
};
const safeNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatNumber = (value, digits = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(Number(value) || 0);
const formatKcal = value => `${formatNumber(value, 0)} kcal`;
const formatMacro = value => `${formatNumber(value, 1)} g`;
const formatDateLong = value => parseISO(value).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const formatDateShort = value => parseISO(value).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

const state = {
  users: [],
  foods: [],
  targets: [],
  mealTypes: [],
  entries: [],
  mode: 'day',
  selectedPersonId: localStorage.getItem(LS_SELECTED_PERSON) || '',
  selectedDate: /^\d{4}-\d{2}-\d{2}$/.test(localStorage.getItem(LS_SELECTED_DATE) || '') ? localStorage.getItem(LS_SELECTED_DATE) : localISO(),
  editingFoodId: null,
  editingEntryId: null,
  editingMealTypeId: null,
  copySourceDate: '',
  copyWeekSourceStart: '',
  copyWeekDestinationStart: '',
  chatMessages: [],
  chatBusy: false,
  chatBackendReady: false,
  chatBackendModel: '',
  nutritionSyncBusy: false,
  nutritionSyncQueued: false,
};

const els = {};
let toastTimer = null;

function cacheElements() {
  [
    'mealPersonSelect','mealsEmptyUsers','mealsDayPanel','mealsWeekPanel','mealsFoodsPanel','mealDateLabel','mealDateInput',
    'mealPrevDay','mealToday','mealNextDay','mealCopyDayButton','mealMacroGrid','mealDayList','mealEditTargetsButton','manageMealTypesButton',
    'mealWeekLabel','mealWeekGrid','copyPreviousWeekButton','mealFoodSearch','mealFoodList','newFoodButton','nutritionChatButton',
    'nutritionTargetsDialog','nutritionTargetsForm','nutritionTargetsTitle','targetKcal','targetProtein','targetCarbs','targetFat','targetFiber','closeNutritionTargets','cancelNutritionTargets',
    'foodDialog','foodForm','foodDialogTitle','foodName','foodKcal','foodProtein','foodCarbs','foodFat','foodFiber','foodSource','deleteFoodButton','closeFoodDialog','cancelFoodDialog',
    'mealEntryDialog','mealEntryForm','mealEntryDialogTitle','mealEntryFood','mealEntryQuantity','mealEntryType','mealEntryPreview','deleteMealEntryButton','closeMealEntryDialog','cancelMealEntryDialog',
    'copyDayDialog','copyDayForm','copyDaySourceLabel','copyDayDestination','closeCopyDayDialog','cancelCopyDayDialog',
    'mealTypesDialog','mealTypeManagerList','newMealTypeButton','closeMealTypesDialog','closeMealTypesDialogFooter',
    'mealTypeNameDialog','mealTypeNameForm','mealTypeNameDialogTitle','mealTypeNameInput','closeMealTypeNameDialog','cancelMealTypeNameDialog',
    'copyWeekDialog','copyWeekForm','copyWeekSourceLabel','copyWeekDestinationLabel','copyWeekWarning','closeCopyWeekDialog','cancelCopyWeekDialog',
    'nutritionChatDialog','nutritionChatContextLabel','nutritionChatStatus','nutritionChatModel','nutritionChatSetup','nutritionChatSetupText','nutritionChatMessages',
    'nutritionChatForm','nutritionChatInput','nutritionChatSend','closeNutritionChat','clearNutritionChat','nutritionChatSettingsButton'
  ].forEach(id => { els[id] = document.getElementById(id); });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}


let nutritionSyncTimer = null;

function nutritionSyncRevision() {
  return Number(localStorage.getItem(LS_NUTRITION_SYNC_REVISION) || 0);
}

function bumpNutritionSyncRevision() {
  const current = nutritionSyncRevision();
  const next = Math.max(Date.now(), current + 1);
  localStorage.setItem(LS_NUTRITION_SYNC_REVISION, String(next));
  return next;
}

function markNutritionDirty() {
  localStorage.setItem(LS_NUTRITION_SYNC_DIRTY, '1');
  bumpNutritionSyncRevision();
}

function nutritionSyncAvailable() {
  const { endpoint, houseKey } = chatBackendConfig();
  return Boolean(endpoint && houseKey && localStorage.getItem(LS_CLOUD_LINKED) === '1');
}

function scheduleNutritionSync(delay = 1800) {
  if (nutritionSyncTimer) clearTimeout(nutritionSyncTimer);
  if (!navigator.onLine || !nutritionSyncAvailable() || localStorage.getItem(LS_AUTO_SYNC) !== '1') return;
  nutritionSyncTimer = setTimeout(() => {
    nutritionSyncTimer = null;
    nutritionSyncNow({ silent: true }).catch(error => console.warn('Sincronización Comidas:', error));
  }, delay);
}

function nutritionItemTimestamp(item) {
  if (!item) return 0;
  return Number(item.modifiedAt || item.updatedAt || item.createdAt || 0);
}

function nutritionEntityId(store, item) {
  if (!item) return '';
  return store === 'targets' ? String(item.personId || '') : String(item.id || '');
}

function validateNutritionSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== 'hometasks-nutrition-sync' || !snapshot.data) throw new Error('Snapshot nutricional no válido.');
  for (const store of NUTRITION_DATA_STORES) if (!Array.isArray(snapshot.data[store])) snapshot.data[store] = [];
  if (!Array.isArray(snapshot.tombstones)) snapshot.tombstones = [];
  return snapshot;
}

async function buildNutritionSnapshot() {
  const rows = await Promise.all(NUTRITION_DATA_STORES.map(store => nutritionGetAll(store)));
  const [syncEntries, settings] = await Promise.all([nutritionGetAll('sync'), getAll('settings')]);
  const data = {};
  NUTRITION_DATA_STORES.forEach((store, index) => { data[store] = rows[index]; });
  const homeId = settings.find(item => item.id === 'homeId')?.value || null;
  return {
    format: 'hometasks-nutrition-sync',
    schemaVersion: 1,
    appVersion: NUTRITION_VERSION,
    homeId,
    updatedAt: Date.now(),
    sourceDeviceId: localStorage.getItem(LS_DEVICE_ID) || 'nutrition-device',
    data,
    tombstones: syncEntries.filter(item => item?.kind === 'tombstone'),
  };
}

function mergeNutritionEntities(store, localItems = [], remoteItems = []) {
  const map = new Map();
  for (const item of [...localItems, ...remoteItems]) {
    const id = nutritionEntityId(store, item);
    if (!id) continue;
    const previous = map.get(id);
    if (!previous || nutritionItemTimestamp(item) > nutritionItemTimestamp(previous)) map.set(id, item);
  }
  return [...map.values()];
}

function mergeNutritionTombstones(localItems = [], remoteItems = []) {
  const map = new Map();
  for (const item of [...localItems, ...remoteItems]) {
    if (!item?.store || !item?.entityId) continue;
    const key = `${item.store}:${item.entityId}`;
    const previous = map.get(key);
    if (!previous || Number(item.deletedAt || 0) > Number(previous.deletedAt || 0)) map.set(key, item);
  }
  return [...map.values()];
}

function mergeNutritionSnapshots(localSnapshot, remoteSnapshot) {
  const local = validateNutritionSnapshot(structuredClone(localSnapshot));
  const remote = validateNutritionSnapshot(structuredClone(remoteSnapshot));
  const tombstones = mergeNutritionTombstones(local.tombstones, remote.tombstones).map(tomb => {
    let newest = 0;
    for (const snapshot of [local, remote]) {
      const entity = snapshot.data[tomb.store]?.find(item => nutritionEntityId(tomb.store, item) === String(tomb.entityId));
      if (entity) newest = Math.max(newest, nutritionItemTimestamp(entity));
    }
    return { ...tomb, deletedAt: Math.max(Number(tomb.deletedAt || 0), newest + 1) };
  });
  const deleted = new Map(tombstones.map(item => [`${item.store}:${item.entityId}`, Number(item.deletedAt || 0)]));
  const data = {};
  for (const store of NUTRITION_DATA_STORES) {
    data[store] = mergeNutritionEntities(store, local.data[store], remote.data[store]).filter(item => {
      const id = nutritionEntityId(store, item);
      const deletedAt = deleted.get(`${store}:${id}`) || 0;
      return !deletedAt || nutritionItemTimestamp(item) > deletedAt;
    });
  }
  const survivingTombstones = tombstones.filter(tomb => {
    const item = data[tomb.store]?.find(entry => nutritionEntityId(tomb.store, entry) === String(tomb.entityId));
    return !item || Number(tomb.deletedAt || 0) >= nutritionItemTimestamp(item);
  });
  return {
    format: 'hometasks-nutrition-sync',
    schemaVersion: 1,
    appVersion: NUTRITION_VERSION,
    homeId: remote.homeId || local.homeId || null,
    updatedAt: Date.now(),
    sourceDeviceId: localStorage.getItem(LS_DEVICE_ID) || local.sourceDeviceId || remote.sourceDeviceId || 'nutrition-device',
    data,
    tombstones: survivingTombstones,
  };
}

async function applyNutritionSnapshot(snapshot) {
  const snap = validateNutritionSnapshot(structuredClone(snapshot));
  const deleted = new Map(snap.tombstones.map(item => [`${item.store}:${item.entityId}`, Number(item.deletedAt || 0)]));
  for (const store of NUTRITION_DATA_STORES) {
    const current = await nutritionGetAll(store);
    const merged = mergeNutritionEntities(store, current, snap.data[store]).filter(item => {
      const id = nutritionEntityId(store, item);
      const deletedAt = deleted.get(`${store}:${id}`) || 0;
      return !deletedAt || nutritionItemTimestamp(item) > deletedAt;
    });
    if (merged.length) await nutritionPutMany(store, merged, { silent: true });
  }
  for (const tomb of snap.tombstones) {
    if (NUTRITION_DATA_STORES.includes(tomb.store)) {
      const current = await nutritionGetAll(tomb.store);
      const entity = current.find(item => nutritionEntityId(tomb.store, item) === String(tomb.entityId));
      if (!entity || nutritionItemTimestamp(entity) <= Number(tomb.deletedAt || 0)) {
        await nutritionRemove(tomb.store, tomb.entityId, { tombstone: false, silent: true });
      }
    }
  }
  await nutritionClear('sync', { silent: true });
  if (snap.tombstones.length) await nutritionPutMany('sync', snap.tombstones, { silent: true });
}

async function nutritionBackendPost(payload, timeoutMs = 65000) {
  const { endpoint, houseKey } = chatBackendConfig();
  if (!endpoint || !houseKey) throw new Error('Configura primero Apps Script en Ajustes.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(endpoint, {
      method: 'POST', mode: 'no-cors', cache: 'no-store', redirect: 'follow', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...payload, key: houseKey, clientVersion: NUTRITION_VERSION }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function nutritionSyncNow({ silent = true } = {}) {
  if (!navigator.onLine || !nutritionSyncAvailable()) return false;
  if (state.nutritionSyncBusy) {
    state.nutritionSyncQueued = true;
    return false;
  }
  state.nutritionSyncBusy = true;
  const revisionAtStart = nutritionSyncRevision();
  const dirtyAtStart = localStorage.getItem(LS_NUTRITION_SYNC_DIRTY) === '1' || !localStorage.getItem(LS_NUTRITION_LAST_SYNC);
  try {
    const local = await buildNutritionSnapshot();
    const pulled = await chatJsonpRequest('nutrition_sync_pull', {}, 32000);
    if (!pulled?.ok) throw new Error(pulled?.message || pulled?.error || 'No se pudo descargar Comidas.');
    const remote = pulled.snapshot ? validateNutritionSnapshot(pulled.snapshot) : null;
    let merged = remote ? mergeNutritionSnapshots(local, remote) : local;
    await applyNutritionSnapshot(merged);

    const changedDuringPull = nutritionSyncRevision() !== revisionAtStart;
    if (dirtyAtStart || !remote || changedDuringPull) {
      const latestLocal = changedDuringPull ? await buildNutritionSnapshot() : local;
      if (changedDuringPull) merged = remote ? mergeNutritionSnapshots(latestLocal, merged) : mergeNutritionSnapshots(latestLocal, merged);
      await nutritionBackendPost({ action: 'nutrition_sync_push', snapshot: merged });
      await new Promise(resolve => setTimeout(resolve, 900));
      const confirmedPayload = await chatJsonpRequest('nutrition_sync_pull', {}, 32000);
      if (!confirmedPayload?.ok) throw new Error(confirmedPayload?.message || confirmedPayload?.error || 'Apps Script no confirmó Comidas.');
      if (confirmedPayload.snapshot) {
        merged = mergeNutritionSnapshots(merged, validateNutritionSnapshot(confirmedPayload.snapshot));
        await applyNutritionSnapshot(merged);
      }
    }

    const stable = nutritionSyncRevision() === revisionAtStart || (!dirtyAtStart && nutritionSyncRevision() === revisionAtStart);
    if (stable) localStorage.setItem(LS_NUTRITION_SYNC_DIRTY, '0');
    else localStorage.setItem(LS_NUTRITION_SYNC_DIRTY, '1');
    localStorage.setItem(LS_NUTRITION_LAST_SYNC, String(Date.now()));
    await loadNutritionState({ refreshUsers: false });
    renderAllNutrition();
    if (!silent) showToast('Comidas sincronizadas');
    if (!stable) scheduleNutritionSync(900);
    return true;
  } catch (error) {
    localStorage.setItem(LS_NUTRITION_SYNC_DIRTY, '1');
    console.warn('No se pudo sincronizar Comidas:', error);
    if (!silent) showToast('No se pudo sincronizar Comidas');
    return false;
  } finally {
    state.nutritionSyncBusy = false;
    if (state.nutritionSyncQueued) {
      state.nutritionSyncQueued = false;
      scheduleNutritionSync(500);
    }
  }
}

async function ensureMealTypes() {
  const existing = await nutritionGetAll('mealTypes');
  if (!existing.length) await nutritionPutMany('mealTypes', DEFAULT_MEAL_TYPES);
}

async function loadNutritionState({ refreshUsers = true } = {}) {
  const jobs = [
    nutritionGetAll('foods'),
    nutritionGetAll('targets'),
    nutritionGetAll('mealTypes'),
    nutritionGetAll('entries'),
    nutritionGetAll('chatMessages'),
  ];
  if (refreshUsers) jobs.unshift(getAll('users'));
  const values = await Promise.all(jobs);
  let offset = 0;
  if (refreshUsers) state.users = values[offset++];
  state.foods = values[offset++];
  state.targets = values[offset++];
  state.mealTypes = values[offset++];
  state.entries = values[offset++];
  state.chatMessages = values[offset++];
  state.users.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  state.foods.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  state.mealTypes.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  if (!state.users.some(user => user.id === state.selectedPersonId)) state.selectedPersonId = state.users[0]?.id || '';
  if (state.selectedPersonId) localStorage.setItem(LS_SELECTED_PERSON, state.selectedPersonId);
}

function currentTarget() {
  return state.targets.find(target => target.personId === state.selectedPersonId) || null;
}

function foodForEntry(entry) {
  return state.foods.find(food => food.id === entry.foodId) || entry.foodSnapshot || null;
}

function nutritionForEntry(entry) {
  const food = foodForEntry(entry);
  const factor = safeNumber(entry.quantityGrams) / 100;
  if (!food) return { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  return {
    kcal: safeNumber(food.kcal) * factor,
    protein: safeNumber(food.protein) * factor,
    carbs: safeNumber(food.carbs) * factor,
    fat: safeNumber(food.fat) * factor,
    fiber: safeNumber(food.fiber) * factor,
  };
}

function addTotals(total, values) {
  total.kcal += values.kcal;
  total.protein += values.protein;
  total.carbs += values.carbs;
  total.fat += values.fat;
  total.fiber += values.fiber;
  return total;
}

function emptyTotals() {
  return { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
}

function entriesFor(personId, date, mealTypeId = null) {
  return state.entries.filter(entry => entry.personId === personId && entry.date === date && (!mealTypeId || entry.mealTypeId === mealTypeId));
}

function totalsFor(personId, date, mealTypeId = null) {
  return entriesFor(personId, date, mealTypeId).reduce((total, entry) => addTotals(total, nutritionForEntry(entry)), emptyTotals());
}

function entriesForWeek(personId, weekStart) {
  const weekEnd = shiftISO(weekStart, 6);
  return state.entries.filter(entry => entry.personId === personId && entry.date >= weekStart && entry.date <= weekEnd);
}

function macroCard(label, key, unit, total, target) {
  const consumed = total[key];
  const goal = safeNumber(target?.[key]);
  const percentage = goal > 0 ? consumed / goal * 100 : null;
  const remaining = goal > 0 ? Math.max(0, goal - consumed) : null;
  const displayConsumed = key === 'kcal' ? formatNumber(consumed, 0) : formatNumber(consumed, 1);
  const displayGoal = goal > 0 ? (key === 'kcal' ? formatNumber(goal, 0) : formatNumber(goal, 1)) : '—';
  const remainingText = remaining === null ? 'Objetivo sin configurar' : `Restante: ${key === 'kcal' ? formatNumber(remaining, 0) : formatNumber(remaining, 1)} ${unit}`;
  return `<article class="card meal-macro-card">
    <div class="meal-macro-head"><span>${escapeHTML(label)}</span><strong>${percentage === null ? '—' : `${formatNumber(percentage, 0)} %`}</strong></div>
    <div class="meal-macro-value"><strong>${displayConsumed}</strong><span>/ ${displayGoal} ${escapeHTML(unit)}</span></div>
    <div class="meal-progress" aria-hidden="true"><span style="width:${percentage === null ? 0 : Math.min(100, Math.max(0, percentage))}%"></span></div>
    <small>${escapeHTML(remainingText)}</small>
  </article>`;
}

function renderPersonSelect() {
  if (!els.mealPersonSelect) return;
  els.mealPersonSelect.innerHTML = state.users.length
    ? state.users.map(user => `<option value="${escapeHTML(user.id)}">${escapeHTML(user.name)}</option>`).join('')
    : '<option value="">Sin personas</option>';
  els.mealPersonSelect.value = state.selectedPersonId;
  els.mealPersonSelect.disabled = !state.users.length;
  els.mealsEmptyUsers.hidden = state.users.length > 0;
}

function renderDateControls() {
  els.mealDateInput.value = state.selectedDate;
  els.mealDateLabel.textContent = formatDateLong(state.selectedDate);
}

function renderMacros() {
  const totals = totalsFor(state.selectedPersonId, state.selectedDate);
  const target = currentTarget();
  els.mealMacroGrid.innerHTML = [
    macroCard('Calorías', 'kcal', 'kcal', totals, target),
    macroCard('Proteínas', 'protein', 'g', totals, target),
    macroCard('Carbohidratos', 'carbs', 'g', totals, target),
    macroCard('Grasas', 'fat', 'g', totals, target),
  ].join('');
}

function entryRow(entry) {
  const food = foodForEntry(entry);
  const values = nutritionForEntry(entry);
  const name = food?.name || 'Alimento eliminado';
  return `<button class="meal-food-row" type="button" data-entry-id="${escapeHTML(entry.id)}">
    <span class="meal-food-main"><strong>${escapeHTML(name)}</strong><small>${formatNumber(entry.quantityGrams, 1)} g</small></span>
    <span class="meal-food-energy">${formatKcal(values.kcal)}</span>
    <span class="meal-food-macros">P ${formatNumber(values.protein,1)} · C ${formatNumber(values.carbs,1)} · G ${formatNumber(values.fat,1)}</span>
    <span class="meal-food-edit" aria-hidden="true">Editar</span>
  </button>`;
}

function renderDayMeals() {
  if (!state.selectedPersonId) {
    els.mealDayList.innerHTML = '';
    return;
  }
  els.mealDayList.innerHTML = state.mealTypes.map(type => {
    const entries = entriesFor(state.selectedPersonId, state.selectedDate, type.id);
    const subtotal = totalsFor(state.selectedPersonId, state.selectedDate, type.id);
    return `<article class="card meal-card" data-meal-type-id="${escapeHTML(type.id)}">
      <div class="meal-card-head">
        <div><p class="eyebrow">Comida</p><h3>${escapeHTML(type.name)}</h3></div>
        <div class="meal-subtotal"><strong>${formatKcal(subtotal.kcal)}</strong><small>P ${formatNumber(subtotal.protein,1)} · C ${formatNumber(subtotal.carbs,1)} · G ${formatNumber(subtotal.fat,1)}</small></div>
      </div>
      <div class="meal-food-rows">${entries.length ? entries.map(entryRow).join('') : '<div class="meal-empty">Todavía no hay alimentos en esta comida.</div>'}</div>
      <button class="secondary-button meal-add-food" type="button" data-meal-type-id="${escapeHTML(type.id)}">+ Añadir alimento</button>
    </article>`;
  }).join('');
  els.mealDayList.querySelectorAll('.meal-add-food').forEach(button => button.addEventListener('click', () => openEntryDialog(null, button.dataset.mealTypeId)));
  els.mealDayList.querySelectorAll('.meal-food-row').forEach(button => button.addEventListener('click', () => openEntryDialog(button.dataset.entryId)));
}

function renderDay() {
  renderDateControls();
  renderMacros();
  renderDayMeals();
  els.mealEditTargetsButton.disabled = !state.selectedPersonId;
  els.mealCopyDayButton.disabled = !state.selectedPersonId || !entriesFor(state.selectedPersonId, state.selectedDate).length;
}

function renderWeek() {
  if (!state.selectedPersonId) {
    els.mealWeekGrid.innerHTML = '';
    els.mealWeekLabel.textContent = 'Semana';
    els.copyPreviousWeekButton.disabled = true;
    return;
  }
  const start = mondayISO(state.selectedDate);
  const end = shiftISO(start, 6);
  const previousStart = shiftISO(start, -7);
  const previousEntries = entriesForWeek(state.selectedPersonId, previousStart);
  els.mealWeekLabel.textContent = `${parseISO(start).toLocaleDateString('es-ES',{day:'numeric',month:'short'})} – ${parseISO(end).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}`;
  els.copyPreviousWeekButton.disabled = !previousEntries.length;
  els.copyPreviousWeekButton.title = previousEntries.length ? `Copiar ${previousEntries.length} alimento${previousEntries.length === 1 ? '' : 's'} de la semana anterior` : 'La semana anterior no tiene alimentos planificados';
  const days = Array.from({ length: 7 }, (_, index) => shiftISO(start, index));
  els.mealWeekGrid.innerHTML = days.map(date => {
    const dayEntries = entriesFor(state.selectedPersonId, date);
    const totals = totalsFor(state.selectedPersonId, date);
    const meals = new Set(dayEntries.map(entry => entry.mealTypeId)).size;
    return `<article class="card meal-week-day ${date === localISO() ? 'is-today' : ''}" data-date="${date}">
      <button class="meal-week-open" type="button" data-date="${date}">
        <span>${escapeHTML(formatDateShort(date))}</span>
        <strong>${meals} comida${meals === 1 ? '' : 's'}</strong>
        <b>${formatKcal(totals.kcal)}</b>
        <small>P ${formatNumber(totals.protein,1)} g · C ${formatNumber(totals.carbs,1)} g · G ${formatNumber(totals.fat,1)} g</small>
      </button>
      <button class="secondary-button compact-button meal-week-copy" type="button" data-date="${date}" ${dayEntries.length ? '' : 'disabled'}>Copiar día</button>
    </article>`;
  }).join('');
  els.mealWeekGrid.querySelectorAll('.meal-week-open').forEach(button => button.addEventListener('click', () => {
    setSelectedDate(button.dataset.date);
    setMode('day');
  }));
  els.mealWeekGrid.querySelectorAll('.meal-week-copy').forEach(button => button.addEventListener('click', () => openCopyDayDialog(button.dataset.date)));
}

function renderFoods() {
  const query = String(els.mealFoodSearch.value || '').trim().toLocaleLowerCase('es');
  const foods = state.foods.filter(food => !query || String(food.name || '').toLocaleLowerCase('es').includes(query));
  if (!foods.length) {
    els.mealFoodList.innerHTML = `<div class="card meal-library-empty">${state.foods.length ? 'No hay alimentos que coincidan con la búsqueda.' : 'La biblioteca está vacía. Crea tu primer alimento con los valores de su etiqueta o una fuente de confianza.'}</div>`;
    return;
  }
  els.mealFoodList.innerHTML = foods.map(food => `<article class="card meal-library-row" data-food-id="${escapeHTML(food.id)}">
    <div class="meal-library-name"><strong>${escapeHTML(food.name)}</strong><small>${escapeHTML(food.source || 'Manual')} · valores por 100 g</small></div>
    <div class="meal-library-kcal">${formatKcal(food.kcal)}</div>
    <div class="meal-library-macros">P ${formatNumber(food.protein,1)} · C ${formatNumber(food.carbs,1)} · G ${formatNumber(food.fat,1)}${safeNumber(food.fiber) ? ` · Fibra ${formatNumber(food.fiber,1)}` : ''}</div>
    <div class="meal-library-actions">
      <button class="secondary-button compact-button food-quick-add" type="button" ${state.selectedPersonId ? '' : 'disabled'}>Añadir</button>
      <button class="secondary-button compact-button food-edit" type="button">Editar</button>
    </div>
  </article>`).join('');
  els.mealFoodList.querySelectorAll('.meal-library-row').forEach(row => {
    row.querySelector('.food-edit').addEventListener('click', () => openFoodDialog(row.dataset.foodId));
    row.querySelector('.food-quick-add').addEventListener('click', () => openEntryDialog(null, state.mealTypes[0]?.id, row.dataset.foodId));
  });
}

function setMode(mode) {
  state.mode = ['day','week','foods'].includes(mode) ? mode : 'day';
  document.querySelectorAll('[data-meals-mode]').forEach(button => {
    const active = button.dataset.mealsMode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  els.mealsDayPanel.hidden = state.mode !== 'day';
  els.mealsWeekPanel.hidden = state.mode !== 'week';
  els.mealsFoodsPanel.hidden = state.mode !== 'foods';
  if (state.mode === 'day') renderDay();
  else if (state.mode === 'week') renderWeek();
  else renderFoods();
}

function renderAllNutrition() {
  renderPersonSelect();
  setMode(state.mode);
}

function setSelectedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return;
  state.selectedDate = value;
  localStorage.setItem(LS_SELECTED_DATE, value);
  if (state.mode === 'week') renderWeek();
  else renderDay();
  if (els.nutritionChatDialog?.open) { renderChatContextLabel(); renderChatMessages(); }
}

function openTargetsDialog() {
  if (!state.selectedPersonId) return;
  const user = state.users.find(item => item.id === state.selectedPersonId);
  const target = currentTarget();
  els.nutritionTargetsTitle.textContent = `Objetivos · ${user?.name || 'Persona'}`;
  els.targetKcal.value = target?.kcal ?? '';
  els.targetProtein.value = target?.protein ?? '';
  els.targetCarbs.value = target?.carbs ?? '';
  els.targetFat.value = target?.fat ?? '';
  els.targetFiber.value = target?.fiber ?? '';
  els.nutritionTargetsDialog.showModal();
}

async function saveTargets(event) {
  event.preventDefault();
  if (!state.selectedPersonId) return;
  const now = Date.now();
  const previous = currentTarget();
  const target = {
    personId: state.selectedPersonId,
    kcal: safeNumber(els.targetKcal.value),
    protein: safeNumber(els.targetProtein.value),
    carbs: safeNumber(els.targetCarbs.value),
    fat: safeNumber(els.targetFat.value),
    fiber: safeNumber(els.targetFiber.value),
    createdAt: previous?.createdAt || now,
    modifiedAt: now,
    syncVersion: 1,
  };
  await nutritionPut('targets', target);
  els.nutritionTargetsDialog.close();
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  showToast('Objetivos nutricionales guardados');
}

function openFoodDialog(foodId = null) {
  state.editingFoodId = foodId;
  const food = foodId ? state.foods.find(item => item.id === foodId) : null;
  els.foodDialogTitle.textContent = food ? 'Editar alimento' : 'Nuevo alimento';
  els.foodName.value = food?.name || '';
  els.foodKcal.value = food?.kcal ?? '';
  els.foodProtein.value = food?.protein ?? '';
  els.foodCarbs.value = food?.carbs ?? '';
  els.foodFat.value = food?.fat ?? '';
  els.foodFiber.value = food?.fiber ?? '';
  els.foodSource.value = food?.source || 'Manual';
  els.deleteFoodButton.hidden = !food;
  els.foodDialog.showModal();
  setTimeout(() => els.foodName.focus(), 20);
}

async function saveFood(event) {
  event.preventDefault();
  const name = els.foodName.value.trim();
  if (!name) return;
  const now = Date.now();
  const previous = state.editingFoodId ? state.foods.find(item => item.id === state.editingFoodId) : null;
  const food = {
    id: previous?.id || makeId(),
    name,
    kcal: safeNumber(els.foodKcal.value),
    protein: safeNumber(els.foodProtein.value),
    carbs: safeNumber(els.foodCarbs.value),
    fat: safeNumber(els.foodFat.value),
    fiber: safeNumber(els.foodFiber.value),
    source: els.foodSource.value || 'Manual',
    createdAt: previous?.createdAt || now,
    modifiedAt: now,
    syncVersion: 1,
  };
  await nutritionPut('foods', food);
  state.editingFoodId = null;
  els.foodDialog.close();
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  showToast(previous ? 'Alimento actualizado' : 'Alimento creado');
}

async function deleteFood() {
  const food = state.foods.find(item => item.id === state.editingFoodId);
  if (!food) return;
  if (!confirm(`¿Eliminar “${food.name}” de la biblioteca? Los menús ya planificados conservarán una copia de sus valores.`)) return;
  await nutritionRemove('foods', food.id);
  state.editingFoodId = null;
  els.foodDialog.close();
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  showToast('Alimento eliminado');
}

function populateEntrySelectors(selectedFoodId = '', selectedMealTypeId = '') {
  els.mealEntryFood.innerHTML = state.foods.map(food => `<option value="${escapeHTML(food.id)}">${escapeHTML(food.name)}</option>`).join('');
  els.mealEntryType.innerHTML = state.mealTypes.map(type => `<option value="${escapeHTML(type.id)}">${escapeHTML(type.name)}</option>`).join('');
  if (selectedFoodId && state.foods.some(food => food.id === selectedFoodId)) els.mealEntryFood.value = selectedFoodId;
  if (selectedMealTypeId && state.mealTypes.some(type => type.id === selectedMealTypeId)) els.mealEntryType.value = selectedMealTypeId;
}

function updateEntryPreview() {
  const food = state.foods.find(item => item.id === els.mealEntryFood.value);
  const quantity = safeNumber(els.mealEntryQuantity.value);
  if (!food || !quantity) {
    els.mealEntryPreview.innerHTML = '<span>Introduce una cantidad para calcular los valores.</span>';
    return;
  }
  const factor = quantity / 100;
  els.mealEntryPreview.innerHTML = `<strong>${formatKcal(food.kcal * factor)}</strong><span>P ${formatNumber(food.protein * factor,1)} g · C ${formatNumber(food.carbs * factor,1)} g · G ${formatNumber(food.fat * factor,1)} g</span>`;
}

function openEntryDialog(entryId = null, presetMealTypeId = '', presetFoodId = '') {
  if (!state.selectedPersonId) {
    showToast('Añade primero una persona en Ajustes');
    return;
  }
  if (!state.foods.length) {
    setMode('foods');
    openFoodDialog();
    showToast('Crea primero un alimento');
    return;
  }
  state.editingEntryId = entryId;
  const entry = entryId ? state.entries.find(item => item.id === entryId) : null;
  els.mealEntryDialogTitle.textContent = entry ? 'Editar alimento de la comida' : 'Añadir alimento';
  const activeFoodId = entry?.foodId || presetFoodId || state.foods[0]?.id || '';
  const activeMealTypeId = entry?.mealTypeId || presetMealTypeId || state.mealTypes[0]?.id || '';
  populateEntrySelectors(activeFoodId, activeMealTypeId);
  els.mealEntryQuantity.value = entry?.quantityGrams ?? 100;
  els.deleteMealEntryButton.hidden = !entry;
  updateEntryPreview();
  els.mealEntryDialog.showModal();
}

async function saveEntry(event) {
  event.preventDefault();
  const food = state.foods.find(item => item.id === els.mealEntryFood.value);
  const quantity = safeNumber(els.mealEntryQuantity.value);
  if (!food || quantity <= 0 || !state.selectedPersonId) {
    showToast('Selecciona alimento y una cantidad mayor que cero');
    return;
  }
  const now = Date.now();
  const previous = state.editingEntryId ? state.entries.find(item => item.id === state.editingEntryId) : null;
  const entry = {
    id: previous?.id || makeId(),
    personId: state.selectedPersonId,
    date: state.selectedDate,
    mealTypeId: els.mealEntryType.value,
    foodId: food.id,
    foodSnapshot: {
      id: food.id,
      name: food.name,
      kcal: safeNumber(food.kcal),
      protein: safeNumber(food.protein),
      carbs: safeNumber(food.carbs),
      fat: safeNumber(food.fat),
      fiber: safeNumber(food.fiber),
      source: food.source || 'Manual',
    },
    quantityGrams: quantity,
    createdAt: previous?.createdAt || now,
    modifiedAt: now,
    syncVersion: 1,
  };
  await nutritionPut('entries', entry);
  state.editingEntryId = null;
  els.mealEntryDialog.close();
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  showToast(previous ? 'Cantidad actualizada' : 'Alimento añadido');
}

async function deleteEntry() {
  if (!state.editingEntryId) return;
  await nutritionRemove('entries', state.editingEntryId);
  state.editingEntryId = null;
  els.mealEntryDialog.close();
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  showToast('Alimento retirado de la comida');
}

function openCopyDayDialog(sourceDate = state.selectedDate) {
  if (!state.selectedPersonId || !entriesFor(state.selectedPersonId, sourceDate).length) return;
  state.copySourceDate = sourceDate;
  els.copyDaySourceLabel.textContent = formatDateLong(sourceDate);
  els.copyDayDestination.value = shiftISO(sourceDate, 1);
  els.copyDayDialog.showModal();
}

async function copyDay(event) {
  event.preventDefault();
  const destination = els.copyDayDestination.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(destination) || destination === state.copySourceDate) {
    showToast('Elige una fecha de destino diferente');
    return;
  }
  const sourceEntries = entriesFor(state.selectedPersonId, state.copySourceDate);
  if (!sourceEntries.length) return;
  const existing = entriesFor(state.selectedPersonId, destination);
  if (existing.length && !confirm('El día de destino ya tiene alimentos. Se sustituirá su menú completo. ¿Continuar?')) return;
  for (const entry of existing) await nutritionRemove('entries', entry.id);
  const now = Date.now();
  const copies = sourceEntries.map(entry => ({ ...entry, id: makeId(), date: destination, createdAt: now, modifiedAt: now, syncVersion: 1 }));
  await nutritionPutMany('entries', copies);
  els.copyDayDialog.close();
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  showToast('Día copiado');
}

function renderMealTypeManager() {
  if (!els.mealTypeManagerList) return;
  if (!state.mealTypes.length) {
    els.mealTypeManagerList.innerHTML = '<div class="meal-library-empty">No hay tipos de comida configurados.</div>';
    return;
  }
  els.mealTypeManagerList.innerHTML = state.mealTypes.map((type, index) => {
    const usage = state.entries.filter(entry => entry.mealTypeId === type.id).length;
    return `<article class="meal-type-row" data-meal-type-id="${escapeHTML(type.id)}">
      <div class="meal-type-info"><strong>${escapeHTML(type.name)}</strong><small>${usage} registro${usage === 1 ? '' : 's'} planificado${usage === 1 ? '' : 's'}</small></div>
      <div class="meal-type-actions">
        <button class="secondary-button compact-button meal-type-up" type="button" aria-label="Subir ${escapeHTML(type.name)}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="secondary-button compact-button meal-type-down" type="button" aria-label="Bajar ${escapeHTML(type.name)}" ${index === state.mealTypes.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="secondary-button compact-button meal-type-rename" type="button">Renombrar</button>
        <button class="secondary-button compact-button danger-button meal-type-delete" type="button" ${state.mealTypes.length <= 1 ? 'disabled' : ''}>Eliminar</button>
      </div>
    </article>`;
  }).join('');
  els.mealTypeManagerList.querySelectorAll('.meal-type-row').forEach(row => {
    const id = row.dataset.mealTypeId;
    row.querySelector('.meal-type-up').addEventListener('click', () => moveMealType(id, -1));
    row.querySelector('.meal-type-down').addEventListener('click', () => moveMealType(id, 1));
    row.querySelector('.meal-type-rename').addEventListener('click', () => openMealTypeNameDialog(id));
    row.querySelector('.meal-type-delete').addEventListener('click', () => deleteMealType(id));
  });
}

function openMealTypesDialog() {
  renderMealTypeManager();
  els.mealTypesDialog.showModal();
}

function openMealTypeNameDialog(mealTypeId = null) {
  state.editingMealTypeId = mealTypeId;
  if (els.mealTypesDialog.open) els.mealTypesDialog.close();
  const type = mealTypeId ? state.mealTypes.find(item => item.id === mealTypeId) : null;
  els.mealTypeNameDialogTitle.textContent = type ? 'Renombrar comida' : 'Nueva comida';
  els.mealTypeNameInput.value = type?.name || '';
  els.mealTypeNameDialog.showModal();
  setTimeout(() => els.mealTypeNameInput.focus(), 20);
}

async function saveMealType(event) {
  event.preventDefault();
  const name = els.mealTypeNameInput.value.trim();
  if (!name) return;
  const duplicate = state.mealTypes.find(type => type.id !== state.editingMealTypeId && String(type.name || '').trim().toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
  if (duplicate) {
    showToast('Ya existe una comida con ese nombre');
    return;
  }
  const now = Date.now();
  const previous = state.editingMealTypeId ? state.mealTypes.find(type => type.id === state.editingMealTypeId) : null;
  const maxOrder = state.mealTypes.reduce((max, type) => Math.max(max, Number(type.order) || 0), 0);
  const type = {
    id: previous?.id || makeId(),
    name,
    order: previous?.order ?? (maxOrder + 10),
    createdAt: previous?.createdAt || now,
    modifiedAt: now,
    syncVersion: (previous?.syncVersion || 0) + 1,
  };
  await nutritionPut('mealTypes', type);
  state.editingMealTypeId = null;
  els.mealTypeNameDialog.close();
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  renderMealTypeManager();
  els.mealTypesDialog.showModal();
  showToast(previous ? 'Comida renombrada' : 'Comida creada');
}

async function moveMealType(mealTypeId, direction) {
  const ordered = [...state.mealTypes];
  const index = ordered.findIndex(type => type.id === mealTypeId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
  [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
  const now = Date.now();
  const updated = ordered.map((type, orderIndex) => ({
    ...type,
    order: (orderIndex + 1) * 10,
    modifiedAt: now,
    syncVersion: (type.syncVersion || 0) + 1,
  }));
  await nutritionPutMany('mealTypes', updated);
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  renderMealTypeManager();
}

async function deleteMealType(mealTypeId) {
  const type = state.mealTypes.find(item => item.id === mealTypeId);
  if (!type) return;
  if (state.mealTypes.length <= 1) {
    showToast('Debe existir al menos un tipo de comida');
    return;
  }
  const typeIndex = state.mealTypes.findIndex(item => item.id === mealTypeId);
  const replacement = state.mealTypes[typeIndex + 1] || state.mealTypes[typeIndex - 1];
  const usedEntries = state.entries.filter(entry => entry.mealTypeId === mealTypeId);
  const message = usedEntries.length
    ? `“${type.name}” se usa en ${usedEntries.length} alimento${usedEntries.length === 1 ? '' : 's'} planificado${usedEntries.length === 1 ? '' : 's'}. Para no perder datos se moverán a “${replacement.name}”. ¿Eliminar esta comida?`
    : `¿Eliminar el tipo de comida “${type.name}”?`;
  if (!confirm(message)) return;
  if (usedEntries.length) {
    const now = Date.now();
    await nutritionPutMany('entries', usedEntries.map(entry => ({
      ...entry,
      mealTypeId: replacement.id,
      modifiedAt: now,
      syncVersion: (entry.syncVersion || 0) + 1,
    })));
  }
  await nutritionRemove('mealTypes', mealTypeId);
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  renderMealTypeManager();
  showToast(usedEntries.length ? `Comida eliminada · datos movidos a ${replacement.name}` : 'Comida eliminada');
}

function openCopyPreviousWeekDialog() {
  if (!state.selectedPersonId) return;
  const destinationStart = mondayISO(state.selectedDate);
  const sourceStart = shiftISO(destinationStart, -7);
  const sourceEntries = entriesForWeek(state.selectedPersonId, sourceStart);
  if (!sourceEntries.length) {
    showToast('La semana anterior no tiene alimentos planificados');
    return;
  }
  const destinationEntries = entriesForWeek(state.selectedPersonId, destinationStart);
  state.copyWeekSourceStart = sourceStart;
  state.copyWeekDestinationStart = destinationStart;
  els.copyWeekSourceLabel.textContent = `${formatDateShort(sourceStart)} – ${formatDateShort(shiftISO(sourceStart, 6))}`;
  els.copyWeekDestinationLabel.textContent = `${formatDateShort(destinationStart)} – ${formatDateShort(shiftISO(destinationStart, 6))}`;
  els.copyWeekWarning.hidden = !destinationEntries.length;
  els.copyWeekWarning.textContent = destinationEntries.length
    ? `La semana de destino ya contiene ${destinationEntries.length} alimento${destinationEntries.length === 1 ? '' : 's'}. Al copiar se sustituirá su planificación completa.`
    : 'La semana de destino está vacía.';
  els.copyWeekDialog.showModal();
}

async function copyPreviousWeek(event) {
  event.preventDefault();
  const sourceStart = state.copyWeekSourceStart;
  const destinationStart = state.copyWeekDestinationStart;
  if (!sourceStart || !destinationStart || !state.selectedPersonId) return;
  const sourceEntries = entriesForWeek(state.selectedPersonId, sourceStart);
  if (!sourceEntries.length) {
    els.copyWeekDialog.close();
    showToast('La semana anterior ya no contiene alimentos');
    return;
  }
  const destinationEntries = entriesForWeek(state.selectedPersonId, destinationStart);
  for (const entry of destinationEntries) await nutritionRemove('entries', entry.id);
  const now = Date.now();
  const copies = sourceEntries.map(entry => ({
    ...entry,
    id: makeId(),
    date: shiftISO(entry.date, 7),
    createdAt: now,
    modifiedAt: now,
    syncVersion: 1,
  }));
  await nutritionPutMany('entries', copies);
  els.copyWeekDialog.close();
  state.copyWeekSourceStart = '';
  state.copyWeekDestinationStart = '';
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  showToast('Semana anterior copiada');
}


function chatBackendConfig() {
  const endpoint = String(localStorage.getItem(LS_SYNC_ENDPOINT) || '').trim().replace(/\/$/, '');
  const houseKey = String(localStorage.getItem(LS_SYNC_HOUSE_KEY) || '');
  if (!endpoint || !houseKey) return { endpoint: '', houseKey: '' };
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || !/script\.google\.com$/i.test(url.hostname) || !/\/exec\/?$/i.test(url.pathname)) return { endpoint: '', houseKey: '' };
  } catch (_) { return { endpoint: '', houseKey: '' }; }
  return { endpoint, houseKey };
}

function chatJsonpRequest(action, params = {}, timeoutMs = 25000) {
  const { endpoint, houseKey } = chatBackendConfig();
  if (!endpoint || !houseKey) return Promise.reject(new Error('Configura primero Apps Script en Ajustes.'));
  return new Promise((resolve, reject) => {
    const callback = `__ht_ai_${Date.now()}_${Math.random().toString(16).slice(2)}`.replace(/[^A-Za-z0-9_$]/g, '_');
    const url = new URL(endpoint);
    url.searchParams.set('action', action);
    url.searchParams.set('key', houseKey);
    url.searchParams.set('callback', callback);
    url.searchParams.set('clientVersion', NUTRITION_VERSION);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    url.searchParams.set('_', String(Date.now()));
    const script = document.createElement('script');
    script.referrerPolicy = 'no-referrer';
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      try { delete globalThis[callback]; } catch (_) { globalThis[callback] = undefined; }
    };
    globalThis[callback] = payload => { cleanup(); resolve(payload || {}); };
    script.onerror = () => { cleanup(); reject(new Error('No se ha podido contactar con Apps Script.')); };
    timer = setTimeout(() => { cleanup(); reject(new Error('Apps Script está tardando más de lo esperado.')); }, timeoutMs);
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function setChatStatus(kind, text, detail = '') {
  if (!els.nutritionChatStatus) return;
  els.nutritionChatStatus.className = `nutrition-chat-status ${kind}`;
  els.nutritionChatStatus.textContent = text;
  els.nutritionChatModel.textContent = detail || '';
}

function chatMessagesForPerson(personId = state.selectedPersonId) {
  return state.chatMessages
    .filter(item => item.personId === personId && (item.role === 'user' || item.role === 'assistant'))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function normalizeAssistantText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function configuredNutritionTarget() {
  const target = currentTarget();
  if (!target) return null;
  const normalized = {
    kcal: safeNumber(target.kcal),
    protein: safeNumber(target.protein),
    carbs: safeNumber(target.carbs),
    fat: safeNumber(target.fat),
    fiber: safeNumber(target.fiber),
  };
  return (normalized.kcal || normalized.protein || normalized.carbs || normalized.fat) ? normalized : null;
}

function remainingGoals(target, totals) {
  return {
    kcal: Math.max(0, safeNumber(target?.kcal) - safeNumber(totals?.kcal)),
    protein: Math.max(0, safeNumber(target?.protein) - safeNumber(totals?.protein)),
    carbs: Math.max(0, safeNumber(target?.carbs) - safeNumber(totals?.carbs)),
    fat: Math.max(0, safeNumber(target?.fat) - safeNumber(totals?.fat)),
    fiber: Math.max(0, safeNumber(target?.fiber) - safeNumber(totals?.fiber)),
  };
}

function scaleGoals(goals, factor) {
  return {
    kcal: safeNumber(goals?.kcal) * factor,
    protein: safeNumber(goals?.protein) * factor,
    carbs: safeNumber(goals?.carbs) * factor,
    fat: safeNumber(goals?.fat) * factor,
    fiber: safeNumber(goals?.fiber) * factor,
  };
}

function subtractGoals(goals, used) {
  return {
    kcal: Math.max(0, safeNumber(goals?.kcal) - safeNumber(used?.kcal)),
    protein: Math.max(0, safeNumber(goals?.protein) - safeNumber(used?.protein)),
    carbs: Math.max(0, safeNumber(goals?.carbs) - safeNumber(used?.carbs)),
    fat: Math.max(0, safeNumber(goals?.fat) - safeNumber(used?.fat)),
    fiber: Math.max(0, safeNumber(goals?.fiber) - safeNumber(used?.fiber)),
  };
}

function addTotalsCopy(a, b) {
  return {
    kcal: safeNumber(a?.kcal) + safeNumber(b?.kcal),
    protein: safeNumber(a?.protein) + safeNumber(b?.protein),
    carbs: safeNumber(a?.carbs) + safeNumber(b?.carbs),
    fat: safeNumber(a?.fat) + safeNumber(b?.fat),
    fiber: safeNumber(a?.fiber) + safeNumber(b?.fiber),
  };
}

function hasMeaningfulRemaining(goals) {
  return safeNumber(goals?.kcal) > 15 || safeNumber(goals?.protein) > 1 || safeNumber(goals?.carbs) > 2 || safeNumber(goals?.fat) > 1;
}

function foodContribution(food, grams) {
  const factor = safeNumber(grams) / 100;
  return {
    kcal: safeNumber(food?.kcal) * factor,
    protein: safeNumber(food?.protein) * factor,
    carbs: safeNumber(food?.carbs) * factor,
    fat: safeNumber(food?.fat) * factor,
    fiber: safeNumber(food?.fiber) * factor,
  };
}

function assistantFoodLimits(food) {
  const kcal = safeNumber(food?.kcal);
  const fat = safeNumber(food?.fat);
  if (kcal >= 500 || fat >= 45) return { min: 5, max: 60, step: 5 };
  if (kcal >= 350 || fat >= 25) return { min: 10, max: 100, step: 5 };
  if (kcal >= 220) return { min: 20, max: 160, step: 5 };
  if (kcal >= 120) return { min: 25, max: 220, step: 5 };
  return { min: 30, max: 300, step: 5 };
}

function assistantPlanScore(totals, target, foodCount = 0) {
  const specs = [
    ['kcal', 250, 1.0],
    ['protein', 25, 1.45],
    ['carbs', 30, 1.0],
    ['fat', 12, 1.15],
  ];
  let score = 0;
  for (const [key, floor, weight] of specs) {
    const goal = safeNumber(target?.[key]);
    const value = safeNumber(totals?.[key]);
    const denominator = Math.max(goal, floor);
    const difference = value - goal;
    const normalized = Math.abs(difference) / denominator;
    const overshootPenalty = difference > 0 ? 1.55 : 1;
    score += weight * normalized * normalized * overshootPenalty;
  }
  return score + Math.max(0, foodCount - 1) * 0.018;
}

function totalsForAssistantSelection(selection) {
  let totals = emptyTotals();
  for (const item of selection) totals = addTotalsCopy(totals, foodContribution(item.food, item.grams));
  return totals;
}

function bestSingleFoodOption(food, target) {
  const limits = assistantFoodLimits(food);
  let best = null;
  for (let grams = limits.min; grams <= limits.max; grams += limits.step) {
    const totals = foodContribution(food, grams);
    const score = assistantPlanScore(totals, target, 1);
    if (!best || score < best.score) best = { food, grams, score, limits };
  }
  return best;
}

function optimizeFoodCombination(target) {
  const validFoods = state.foods.filter(food =>
    safeNumber(food.kcal) + safeNumber(food.protein) + safeNumber(food.carbs) + safeNumber(food.fat) > 0
  );
  if (!validFoods.length || !hasMeaningfulRemaining(target)) return { items: [], totals: emptyTotals(), score: Infinity };

  const candidates = validFoods
    .map(food => bestSingleFoodOption(food, target))
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, ASSISTANT_MAX_FOODS);

  const selected = new Map();
  let totals = emptyTotals();
  let currentScore = assistantPlanScore(totals, target, 0);

  for (let iteration = 0; iteration < 180; iteration++) {
    let bestMove = null;
    for (const candidate of candidates) {
      const currentGrams = selected.get(candidate.food.id) || 0;
      const isNew = currentGrams === 0;
      if (isNew && selected.size >= ASSISTANT_MAX_ITEMS_PER_MEAL) continue;
      const addGrams = isNew ? candidate.limits.min : candidate.limits.step;
      if (currentGrams + addGrams > candidate.limits.max) continue;
      const testTotals = addTotalsCopy(totals, foodContribution(candidate.food, addGrams));
      const testCount = selected.size + (isNew ? 1 : 0);
      const score = assistantPlanScore(testTotals, target, testCount);
      if (!bestMove || score < bestMove.score) bestMove = { candidate, addGrams, score, totals: testTotals };
    }
    if (!bestMove || bestMove.score >= currentScore - 0.00015) break;
    const id = bestMove.candidate.food.id;
    selected.set(id, (selected.get(id) || 0) + bestMove.addGrams);
    totals = bestMove.totals;
    currentScore = bestMove.score;
    if (currentScore < 0.004) break;
  }

  if (!selected.size && candidates[0]) selected.set(candidates[0].food.id, candidates[0].grams);

  let selection = [...selected.entries()].map(([foodId, grams]) => ({
    food: validFoods.find(food => food.id === foodId),
    grams,
  })).filter(item => item.food && item.grams > 0);

  // Pequeño refinado local de cantidades. Mantiene el coste bajo en tablets antiguas.
  for (let pass = 0; pass < 5 && selection.length; pass++) {
    let improved = false;
    let bestSelection = selection;
    let bestTotals = totalsForAssistantSelection(selection);
    let bestScore = assistantPlanScore(bestTotals, target, selection.length);
    for (let i = 0; i < selection.length; i++) {
      const item = selection[i];
      const limits = assistantFoodLimits(item.food);
      for (const direction of [-1, 1]) {
        const nextGrams = item.grams + limits.step * direction;
        if (nextGrams < limits.min || nextGrams > limits.max) continue;
        const test = selection.map((entry, index) => index === i ? { ...entry, grams: nextGrams } : entry);
        const testTotals = totalsForAssistantSelection(test);
        const score = assistantPlanScore(testTotals, target, test.length);
        if (score < bestScore - 0.0001) {
          bestSelection = test;
          bestTotals = testTotals;
          bestScore = score;
          improved = true;
        }
      }
    }
    selection = bestSelection;
    totals = bestTotals;
    currentScore = bestScore;
    if (!improved) break;
  }

  return {
    items: selection.map(item => ({
      foodId: item.food.id,
      foodName: item.food.name,
      grams: Math.round(item.grams / 5) * 5,
      foodSnapshot: {
        id: item.food.id,
        name: item.food.name,
        kcal: safeNumber(item.food.kcal),
        protein: safeNumber(item.food.protein),
        carbs: safeNumber(item.food.carbs),
        fat: safeNumber(item.food.fat),
        fiber: safeNumber(item.food.fiber),
        source: item.food.source || 'Manual',
      },
    })),
    totals,
    score: currentScore,
  };
}

function macroStatusLine(label, key, totals, target, unit = 'g') {
  const value = safeNumber(totals?.[key]);
  const goal = safeNumber(target?.[key]);
  const digits = key === 'kcal' ? 0 : 1;
  const suffix = key === 'kcal' ? 'kcal' : unit;
  if (goal <= 0) return `${label}: ${formatNumber(value, digits)} ${suffix} · sin objetivo configurado`;
  const delta = goal - value;
  if (Math.abs(delta) < (key === 'kcal' ? 5 : 0.5)) return `${label}: ${formatNumber(value, digits)} / ${formatNumber(goal, digits)} ${suffix} · objetivo prácticamente alcanzado`;
  if (delta > 0) return `${label}: ${formatNumber(value, digits)} / ${formatNumber(goal, digits)} ${suffix} · faltan ${formatNumber(delta, digits)} ${suffix}`;
  return `${label}: ${formatNumber(value, digits)} / ${formatNumber(goal, digits)} ${suffix} · ${formatNumber(Math.abs(delta), digits)} ${suffix} por encima`;
}

function dayAnalysisText() {
  const target = configuredNutritionTarget();
  if (!target) return 'Configura primero tus objetivos de calorías, proteínas, carbohidratos y grasas. El asistente local usa exactamente esos valores y no calcula objetivos por su cuenta.';
  const totals = totalsFor(state.selectedPersonId, state.selectedDate);
  const lines = [
    macroStatusLine('Calorías', 'kcal', totals, target),
    macroStatusLine('Proteínas', 'protein', totals, target),
    macroStatusLine('Carbohidratos', 'carbs', totals, target),
    macroStatusLine('Grasas', 'fat', totals, target),
  ];
  const tracked = [
    { label: 'calorías', key: 'kcal' }, { label: 'proteína', key: 'protein' },
    { label: 'carbohidratos', key: 'carbs' }, { label: 'grasas', key: 'fat' },
  ].filter(item => safeNumber(target[item.key]) > 0)
    .map(item => ({ ...item, deviation: Math.abs(safeNumber(totals[item.key]) - safeNumber(target[item.key])) / safeNumber(target[item.key]) }))
    .sort((a, b) => b.deviation - a.deviation);
  const count = entriesFor(state.selectedPersonId, state.selectedDate).length;
  const note = count ? `Hay ${count} alimento${count === 1 ? '' : 's'} registrado${count === 1 ? '' : 's'} en el día.` : 'Todavía no hay alimentos registrados en este día.';
  const focus = tracked[0] ? `La mayor desviación proporcional ahora mismo está en ${tracked[0].label}.` : '';
  return `Resumen de ${formatDateLong(state.selectedDate)}\n\n${lines.join('\n')}\n\n${note}${focus ? ` ${focus}` : ''}`;
}

function missingGoalsText() {
  const target = configuredNutritionTarget();
  if (!target) return 'No puedo calcular lo que falta hasta que configures tus objetivos diarios.';
  const totals = totalsFor(state.selectedPersonId, state.selectedDate);
  const remaining = remainingGoals(target, totals);
  const over = {
    kcal: Math.max(0, totals.kcal - target.kcal), protein: Math.max(0, totals.protein - target.protein),
    carbs: Math.max(0, totals.carbs - target.carbs), fat: Math.max(0, totals.fat - target.fat),
  };
  const lines = [
    `Calorías: ${remaining.kcal > 5 ? `faltan ${formatNumber(remaining.kcal,0)} kcal` : over.kcal > 5 ? `${formatNumber(over.kcal,0)} kcal por encima` : 'objetivo alcanzado'}`,
    `Proteínas: ${remaining.protein > .5 ? `faltan ${formatNumber(remaining.protein,1)} g` : over.protein > .5 ? `${formatNumber(over.protein,1)} g por encima` : 'objetivo alcanzado'}`,
    `Carbohidratos: ${remaining.carbs > 1 ? `faltan ${formatNumber(remaining.carbs,1)} g` : over.carbs > 1 ? `${formatNumber(over.carbs,1)} g por encima` : 'objetivo alcanzado'}`,
    `Grasas: ${remaining.fat > .5 ? `faltan ${formatNumber(remaining.fat,1)} g` : over.fat > .5 ? `${formatNumber(over.fat,1)} g por encima` : 'objetivo alcanzado'}`,
  ];
  return `Para llegar a tus objetivos de ${formatDateLong(state.selectedDate)}:\n\n${lines.join('\n')}`;
}

function requestedMealType(text) {
  const normalized = normalizeAssistantText(text);
  if (/(proxima comida|siguiente comida|que puedo comer)/.test(normalized)) return null;
  return state.mealTypes.find(type => {
    const name = normalizeAssistantText(type.name);
    return name.length >= 4 && new RegExp(`(^|\\b)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`).test(normalized);
  }) || null;
}

function planTotalsFromItems(items) {
  return items.reduce((totals, item) => addTotalsCopy(totals, foodContribution(item.foodSnapshot, item.grams)), emptyTotals());
}

function planText(title, items, baseTotals, target, intro = '') {
  if (!items.length) return `${intro ? `${intro}\n\n` : ''}No he encontrado una combinación útil con los alimentos actuales de tu biblioteca. Añade algunos alimentos con sus macros o amplía la biblioteca.`;
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.mealTypeId)) grouped.set(item.mealTypeId, []);
    grouped.get(item.mealTypeId).push(item);
  }
  const sections = [];
  for (const [mealTypeId, group] of grouped.entries()) {
    const type = state.mealTypes.find(item => item.id === mealTypeId);
    const subtotal = planTotalsFromItems(group);
    sections.push(`${type?.name || 'Comida'}\n${group.map(item => `- ${item.foodName}: ${formatNumber(item.grams,0)} g`).join('\n')}\n≈ ${formatNumber(subtotal.kcal,0)} kcal · P ${formatNumber(subtotal.protein,1)} · C ${formatNumber(subtotal.carbs,1)} · G ${formatNumber(subtotal.fat,1)}`);
  }
  const proposed = planTotalsFromItems(items);
  const after = addTotalsCopy(baseTotals, proposed);
  const afterLines = [
    `Calorías ${formatNumber(after.kcal,0)} / ${formatNumber(target.kcal,0)} kcal`,
    `P ${formatNumber(after.protein,1)} / ${formatNumber(target.protein,1)} g`,
    `C ${formatNumber(after.carbs,1)} / ${formatNumber(target.carbs,1)} g`,
    `G ${formatNumber(after.fat,1)} / ${formatNumber(target.fat,1)} g`,
  ];
  return `${intro ? `${intro}\n\n` : ''}${title}\n\n${sections.join('\n\n')}\n\nSi añades la propuesta, el día quedaría aproximadamente en:\n${afterLines.join(' · ')}\n\nLas cantidades están redondeadas a 5 g y se calculan únicamente con los valores de tu biblioteca.`;
}

function buildRestOfDayPlan({ fullDay = false } = {}) {
  const target = configuredNutritionTarget();
  if (!target) return { text: 'Configura primero los objetivos diarios para que pueda construir un plan.' };
  if (!state.foods.length) return { text: 'La biblioteca de alimentos está vacía. Añade alimentos con sus valores nutricionales antes de generar un plan.' };
  const baseTotals = totalsFor(state.selectedPersonId, state.selectedDate);
  let remaining = remainingGoals(target, baseTotals);
  if (!hasMeaningfulRemaining(remaining)) return { text: 'Tus objetivos principales ya están prácticamente cubiertos para este día. No hace falta añadir una planificación automática.' };

  const dayEntries = entriesFor(state.selectedPersonId, state.selectedDate);
  let slots;
  let intro = '';
  if (fullDay && !dayEntries.length) {
    slots = [...state.mealTypes];
    intro = 'He repartido el objetivo del día entre tus comidas configuradas.';
  } else {
    slots = state.mealTypes.filter(type => !entriesFor(state.selectedPersonId, state.selectedDate, type.id).length);
    if (!slots.length) slots = state.mealTypes.length ? [state.mealTypes[state.mealTypes.length - 1]] : [];
    intro = dayEntries.length
      ? 'Mantengo todo lo que ya has registrado y planifico únicamente lo que falta.'
      : 'Como el día está vacío, uso tus comidas configuradas para repartir el objetivo.';
  }
  if (!slots.length) return { text: 'No hay tipos de comida configurados. Crea al menos uno para generar un plan.' };

  const planItems = [];
  for (let index = 0; index < slots.length && hasMeaningfulRemaining(remaining); index++) {
    const type = slots[index];
    const divisor = Math.max(1, slots.length - index);
    const desired = scaleGoals(remaining, 1 / divisor);
    const proposal = optimizeFoodCombination(desired);
    for (const item of proposal.items) planItems.push({ ...item, mealTypeId: type.id });
    remaining = subtractGoals(remaining, proposal.totals);
  }
  return {
    text: planText(fullDay ? 'Plan propuesto para el día' : 'Plan propuesto para completar el día', planItems, baseTotals, target, intro),
    plan: planItems.length ? { date: state.selectedDate, title: fullDay ? 'Plan del día' : 'Completar el día', items: planItems, totals: planTotalsFromItems(planItems) } : null,
  };
}

function buildNextMealPlan(text) {
  const target = configuredNutritionTarget();
  if (!target) return { text: 'Configura primero tus objetivos diarios para que pueda proponerte una comida.' };
  if (!state.foods.length) return { text: 'Necesito alimentos en tu biblioteca para proponer una comida.' };
  const baseTotals = totalsFor(state.selectedPersonId, state.selectedDate);
  const remaining = remainingGoals(target, baseTotals);
  if (!hasMeaningfulRemaining(remaining)) return { text: 'Tus objetivos principales ya están prácticamente cubiertos. No veo necesario añadir otra comida para alcanzarlos.' };

  const explicit = requestedMealType(text);
  const emptyTypes = state.mealTypes.filter(type => !entriesFor(state.selectedPersonId, state.selectedDate, type.id).length);
  const chosen = explicit || emptyTypes[0] || state.mealTypes[state.mealTypes.length - 1];
  if (!chosen) return { text: 'No hay tipos de comida configurados.' };
  const chosenOrder = Number(chosen.order ?? 999);
  const laterEmpty = emptyTypes.filter(type => Number(type.order ?? 999) >= chosenOrder);
  const divisor = Math.max(1, explicit ? laterEmpty.length || 1 : emptyTypes.length || 1);
  const desired = scaleGoals(remaining, 1 / divisor);
  const proposal = optimizeFoodCombination(desired);
  const items = proposal.items.map(item => ({ ...item, mealTypeId: chosen.id }));
  return {
    text: planText(`Propuesta para ${chosen.name}`, items, baseTotals, target, divisor > 1 ? `He reservado parte de lo que falta para las ${divisor - 1} comida${divisor - 1 === 1 ? '' : 's'} posterior${divisor - 1 === 1 ? '' : 'es'}.` : 'Esta propuesta intenta cubrir la mayor parte de lo que queda hoy.'),
    plan: items.length ? { date: state.selectedDate, title: chosen.name, items, totals: planTotalsFromItems(items) } : null,
  };
}

function weeklyReviewText() {
  const target = configuredNutritionTarget();
  const start = mondayISO(state.selectedDate);
  const days = Array.from({ length: 7 }, (_, index) => shiftISO(start, index));
  const withData = days.filter(date => entriesFor(state.selectedPersonId, date).length);
  if (!withData.length) return `No hay alimentos registrados en la semana del ${formatDateShort(start)} al ${formatDateShort(shiftISO(start,6))}.`;
  const aggregate = withData.reduce((sum, date) => addTotalsCopy(sum, totalsFor(state.selectedPersonId, date)), emptyTotals());
  const average = scaleGoals(aggregate, 1 / withData.length);
  const lines = [
    `Días con datos: ${withData.length} de 7`,
    `Media: ${formatNumber(average.kcal,0)} kcal · P ${formatNumber(average.protein,1)} g · C ${formatNumber(average.carbs,1)} g · G ${formatNumber(average.fat,1)} g`,
  ];
  if (target) {
    const overKcal = withData.filter(date => totalsFor(state.selectedPersonId, date).kcal > target.kcal).length;
    const underProtein = withData.filter(date => totalsFor(state.selectedPersonId, date).protein + .5 < target.protein).length;
    lines.push(`Calorías por encima del objetivo: ${overKcal} día${overKcal === 1 ? '' : 's'}.`);
    lines.push(`Proteína por debajo del objetivo: ${underProtein} día${underProtein === 1 ? '' : 's'}.`);
  } else {
    lines.push('No hay objetivos configurados, así que muestro medias sin compararlas con una meta.');
  }
  return `Resumen semanal\n\n${lines.join('\n')}`;
}

function findFoodByAssistantName(query) {
  const normalized = normalizeAssistantText(query).replace(/[?.!,;:]+$/g, '').trim();
  if (!normalized) return null;
  let best = null;
  let bestScore = 0;
  for (const food of state.foods) {
    const name = normalizeAssistantText(food.name);
    if (name === normalized) return food;
    let score = 0;
    if (name.includes(normalized) || normalized.includes(name)) score += 10;
    const tokens = normalized.split(' ').filter(token => token.length > 2);
    for (const token of tokens) if (name.includes(token)) score += 1;
    if (score > bestScore) { best = food; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

function simulationText(text) {
  const normalized = normalizeAssistantText(text);
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramos?)\s+(?:de\s+)?(.+)$/i);
  if (!match) return null;
  const grams = safeNumber(match[1].replace(',', '.'));
  const food = findFoodByAssistantName(match[2]);
  if (!grams || !food) return food ? null : `No encuentro “${match[2].trim()}” en tu biblioteca de alimentos.`;
  const values = foodContribution(food, grams);
  const before = totalsFor(state.selectedPersonId, state.selectedDate);
  const after = addTotalsCopy(before, values);
  const target = configuredNutritionTarget();
  let answer = `${formatNumber(grams,0)} g de ${food.name} añadirían aproximadamente ${formatNumber(values.kcal,0)} kcal · P ${formatNumber(values.protein,1)} g · C ${formatNumber(values.carbs,1)} g · G ${formatNumber(values.fat,1)} g.\n\nEl total del día pasaría a ${formatNumber(after.kcal,0)} kcal · P ${formatNumber(after.protein,1)} · C ${formatNumber(after.carbs,1)} · G ${formatNumber(after.fat,1)}.`;
  if (target) answer += `\n\n${macroStatusLine('Calorías', 'kcal', after, target)}\n${macroStatusLine('Proteínas', 'protein', after, target)}\n${macroStatusLine('Carbohidratos', 'carbs', after, target)}\n${macroStatusLine('Grasas', 'fat', after, target)}`;
  return answer;
}

function localAssistantAnswer(text) {
  const normalized = normalizeAssistantText(text);
  const simulation = /(que pasa si|simula|si anado|si añado|si agrego)/.test(normalized) ? simulationText(text) : null;
  if (simulation) return { text: simulation };
  if (/(planifica.*resto|resto.*dia|completa.*dia|ajusta.*resto)/.test(normalized)) return buildRestOfDayPlan({ fullDay: false });
  if (/(plan completo|plan.*dia|hazme.*plan|planifica.*dia)/.test(normalized)) return buildRestOfDayPlan({ fullDay: true });
  if (/(semana|semanal)/.test(normalized)) return { text: weeklyReviewText() };
  if (/(sugiere|sugerir|propon|proxima comida|próxima comida|que puedo comer|qué puedo comer|cena|desayuno|merienda)/.test(normalized)) return buildNextMealPlan(text);
  if (/(que me falta|qué me falta|cuanto me falta|cuánto me falta|restante|restantes)/.test(normalized)) return { text: missingGoalsText() };
  if (/(como voy|cómo voy|analiza|analisis|análisis|balance|resumen.*dia|estado.*dia)/.test(normalized)) return { text: dayAnalysisText() };
  if (/^(ayuda|help|que puedes hacer|qué puedes hacer)/.test(normalized)) return { text: assistantHelpText() };
  return { text: `No necesito Internet, pero tampoco interpreto preguntas abiertas como una IA. Puedo ayudarte con comandos concretos:\n\n- “Cómo voy hoy”\n- “Qué me falta”\n- “Hazme un plan del día”\n- “Planifica el resto del día”\n- “Sugiere una cena”\n- “Revisa mi semana”\n- “Qué pasa si añado 150 g de [alimento]”\n\nTambién puedes usar los botones rápidos de abajo.` };
}

function assistantHelpText() {
  return 'El asistente local usa únicamente tus objetivos, tu menú y los alimentos guardados. Puede analizar el día, calcular lo que falta, proponer una comida, planificar el resto del día, construir un plan completo cuando el día está vacío, revisar la semana y simular cantidades. No calcula cuáles deberían ser tus objetivos ni usa servicios externos.';
}

function renderChatMessages() {
  if (!els.nutritionChatMessages) return;
  const messages = chatMessagesForPerson();
  if (!messages.length) {
    els.nutritionChatMessages.innerHTML = `<div class="nutrition-chat-welcome"><strong>Asistente nutricional local</strong><span>Funciona sin Internet y utiliza solo tus objetivos, tu menú y la biblioteca de alimentos. Prueba “Hazme un plan del día” o usa los botones rápidos.</span></div>`;
  } else {
    els.nutritionChatMessages.innerHTML = messages.map(message => {
      const planAction = message.role === 'assistant' && message.plan?.items?.length
        ? `<div class="assistant-plan-actions">${message.planAppliedAt
          ? '<span class="assistant-plan-applied">✓ Propuesta añadida al menú</span>'
          : `<button class="primary-button compact-button assistant-plan-apply" type="button" data-assistant-plan-id="${escapeHTML(message.id)}">Añadir propuesta al menú</button>`}</div>`
        : '';
      return `<div class="nutrition-chat-message ${message.role}"><div>${escapeHTML(message.text).replace(/\n/g, '<br>')}</div>${planAction}<small>${new Date(message.createdAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</small></div>`;
    }).join('');
  }
  if (state.chatBusy) els.nutritionChatMessages.insertAdjacentHTML('beforeend', '<div class="nutrition-chat-message assistant pending">Calculando con tus datos…</div>');
  els.nutritionChatMessages.querySelectorAll('[data-assistant-plan-id]').forEach(button => button.addEventListener('click', () => applyAssistantPlan(button.dataset.assistantPlanId).catch(console.error)));
  els.nutritionChatMessages.scrollTop = els.nutritionChatMessages.scrollHeight;
  els.clearNutritionChat.disabled = !messages.length || state.chatBusy;
}

function renderChatContextLabel() {
  const user = state.users.find(item => item.id === state.selectedPersonId);
  if (els.nutritionChatContextLabel) els.nutritionChatContextLabel.textContent = `${user?.name || 'Sin persona'} · ${formatDateLong(state.selectedDate)}`;
}

async function refreshChatBackendStatus() {
  state.chatBackendReady = true;
  state.chatBackendModel = ASSISTANT_ENGINE;
  setChatStatus('ready', 'Asistente local disponible', 'Sin API · funciona offline');
  if (els.nutritionChatSetup) els.nutritionChatSetup.hidden = true;
  return true;
}

async function openNutritionChat() {
  if (!state.selectedPersonId) return showToast('Añade o selecciona una persona antes de abrir el asistente');
  renderChatContextLabel();
  renderChatMessages();
  els.nutritionChatInput.value = '';
  els.nutritionChatDialog.showModal();
  setTimeout(() => els.nutritionChatInput.focus(), 40);
  await refreshChatBackendStatus();
}

async function sendNutritionChat(event) {
  event.preventDefault();
  if (state.chatBusy || !state.selectedPersonId) return;
  const text = String(els.nutritionChatInput.value || '').trim();
  if (!text) return;

  const now = Date.now();
  const userMessage = { id: makeId(), personId: state.selectedPersonId, role: 'user', text, date: state.selectedDate, createdAt: now, modifiedAt: now };
  await nutritionPut('chatMessages', userMessage);
  state.chatMessages.push(userMessage);
  els.nutritionChatInput.value = '';
  state.chatBusy = true;
  els.nutritionChatSend.disabled = true;
  renderChatMessages();

  try {
    // Cedemos un frame para que la UI pinte el estado pendiente antes del cálculo.
    await new Promise(resolve => setTimeout(resolve, 25));
    const result = localAssistantAnswer(text);
    const responseTime = Date.now();
    const assistantMessage = {
      id: makeId(), personId: state.selectedPersonId, role: 'assistant', text: result.text,
      date: state.selectedDate, model: ASSISTANT_ENGINE, createdAt: responseTime, modifiedAt: responseTime,
      ...(result.plan ? { plan: result.plan } : {}),
    };
    await nutritionPut('chatMessages', assistantMessage);
    state.chatMessages.push(assistantMessage);
    setChatStatus('ready', 'Asistente local disponible', 'Sin API · funciona offline');
  } catch (error) {
    console.error('Asistente nutricional:', error);
    showToast(error?.message || 'No se pudo calcular la respuesta');
    setChatStatus('error', 'Error en el cálculo local', ASSISTANT_ENGINE);
  } finally {
    state.chatBusy = false;
    els.nutritionChatSend.disabled = false;
    renderChatMessages();
    setTimeout(() => els.nutritionChatInput.focus(), 20);
  }
}

async function applyAssistantPlan(messageId) {
  const message = state.chatMessages.find(item => item.id === messageId && item.role === 'assistant');
  if (!message?.plan?.items?.length || message.planAppliedAt) return;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(message.plan.date || '') ? message.plan.date : state.selectedDate;
  const now = Date.now();
  const additions = message.plan.items.map(item => {
    const mealTypeId = state.mealTypes.some(type => type.id === item.mealTypeId) ? item.mealTypeId : state.mealTypes[0]?.id;
    return {
      id: makeId(), personId: message.personId || state.selectedPersonId, date, mealTypeId,
      foodId: item.foodId,
      foodSnapshot: { ...item.foodSnapshot },
      quantityGrams: safeNumber(item.grams),
      createdAt: now, modifiedAt: now, syncVersion: 1,
    };
  }).filter(item => item.mealTypeId && item.quantityGrams > 0);
  if (!additions.length) return showToast('La propuesta ya no se puede aplicar');
  await nutritionPutMany('entries', additions);
  message.planAppliedAt = now;
  message.modifiedAt = now;
  await nutritionPut('chatMessages', message);
  await loadNutritionState({ refreshUsers: false });
  renderAllNutrition();
  renderChatMessages();
  showToast('Propuesta añadida al menú');
}

async function clearNutritionChatHistory() {
  const messages = chatMessagesForPerson();
  if (!messages.length || state.chatBusy) return;
  const user = state.users.find(item => item.id === state.selectedPersonId);
  if (!confirm(`¿Empezar una conversación nueva para ${user?.name || 'esta persona'}? Se eliminará el historial del asistente y el borrado se sincronizará con tus dispositivos.`)) return;
  for (const message of messages) await nutritionRemove('chatMessages', message.id);
  state.chatMessages = state.chatMessages.filter(item => item.personId !== state.selectedPersonId);
  renderChatMessages();
  showToast('Asistente reiniciado');
}

async function refreshForMealsView() {
  await loadNutritionState({ refreshUsers: true });
  renderAllNutrition();
}

function setupEvents() {
  document.querySelectorAll('[data-meals-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mealsMode)));
  document.querySelector('[data-view="meals"]')?.addEventListener('click', () => refreshForMealsView().catch(console.error));
  els.mealPersonSelect.addEventListener('change', () => {
    state.selectedPersonId = els.mealPersonSelect.value;
    localStorage.setItem(LS_SELECTED_PERSON, state.selectedPersonId);
    renderAllNutrition();
    if (els.nutritionChatDialog?.open) { renderChatContextLabel(); renderChatMessages(); }
  });
  els.mealPrevDay.addEventListener('click', () => setSelectedDate(shiftISO(state.selectedDate, -1)));
  els.mealToday.addEventListener('click', () => setSelectedDate(localISO()));
  els.mealNextDay.addEventListener('click', () => setSelectedDate(shiftISO(state.selectedDate, 1)));
  els.mealDateInput.addEventListener('change', () => setSelectedDate(els.mealDateInput.value));
  els.mealEditTargetsButton.addEventListener('click', openTargetsDialog);
  els.manageMealTypesButton.addEventListener('click', openMealTypesDialog);
  els.mealCopyDayButton.addEventListener('click', () => openCopyDayDialog(state.selectedDate));
  els.copyPreviousWeekButton.addEventListener('click', openCopyPreviousWeekDialog);
  els.newFoodButton.addEventListener('click', () => openFoodDialog());
  els.mealFoodSearch.addEventListener('input', renderFoods);
  els.nutritionChatButton.addEventListener('click', () => openNutritionChat().catch(console.error));

  els.nutritionChatForm.addEventListener('submit', sendNutritionChat);
  els.closeNutritionChat.addEventListener('click', () => els.nutritionChatDialog.close());
  els.clearNutritionChat.addEventListener('click', () => clearNutritionChatHistory().catch(console.error));
  els.nutritionChatSettingsButton?.addEventListener('click', () => {
    els.nutritionChatDialog.close();
    document.querySelector('[data-view="settings"]')?.click();
  });
  document.querySelectorAll('[data-chat-prompt]').forEach(button => button.addEventListener('click', () => {
    els.nutritionChatInput.value = button.dataset.chatPrompt || '';
    els.nutritionChatInput.focus();
  }));
  els.nutritionChatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.nutritionChatForm.requestSubmit();
    }
  });

  els.nutritionTargetsForm.addEventListener('submit', saveTargets);
  els.closeNutritionTargets.addEventListener('click', () => els.nutritionTargetsDialog.close());
  els.cancelNutritionTargets.addEventListener('click', () => els.nutritionTargetsDialog.close());

  els.foodForm.addEventListener('submit', saveFood);
  els.deleteFoodButton.addEventListener('click', deleteFood);
  els.closeFoodDialog.addEventListener('click', () => { state.editingFoodId = null; els.foodDialog.close(); });
  els.cancelFoodDialog.addEventListener('click', () => { state.editingFoodId = null; els.foodDialog.close(); });

  els.mealEntryForm.addEventListener('submit', saveEntry);
  els.mealEntryFood.addEventListener('change', updateEntryPreview);
  els.mealEntryQuantity.addEventListener('input', updateEntryPreview);
  els.deleteMealEntryButton.addEventListener('click', deleteEntry);
  els.closeMealEntryDialog.addEventListener('click', () => { state.editingEntryId = null; els.mealEntryDialog.close(); });
  els.cancelMealEntryDialog.addEventListener('click', () => { state.editingEntryId = null; els.mealEntryDialog.close(); });

  els.copyDayForm.addEventListener('submit', copyDay);
  els.closeCopyDayDialog.addEventListener('click', () => els.copyDayDialog.close());
  els.cancelCopyDayDialog.addEventListener('click', () => els.copyDayDialog.close());

  els.newMealTypeButton.addEventListener('click', () => openMealTypeNameDialog());
  els.closeMealTypesDialog.addEventListener('click', () => els.mealTypesDialog.close());
  els.closeMealTypesDialogFooter.addEventListener('click', () => els.mealTypesDialog.close());
  els.mealTypeNameForm.addEventListener('submit', saveMealType);
  const closeMealTypeNameDialog = () => {
    state.editingMealTypeId = null;
    els.mealTypeNameDialog.close();
    renderMealTypeManager();
    els.mealTypesDialog.showModal();
  };
  els.closeMealTypeNameDialog.addEventListener('click', closeMealTypeNameDialog);
  els.cancelMealTypeNameDialog.addEventListener('click', closeMealTypeNameDialog);

  els.copyWeekForm.addEventListener('submit', copyPreviousWeek);
  els.closeCopyWeekDialog.addEventListener('click', () => els.copyWeekDialog.close());
  els.cancelCopyWeekDialog.addEventListener('click', () => els.copyWeekDialog.close());

  window.addEventListener('hometasks:nutrition-changed', () => {
    markNutritionDirty();
    scheduleNutritionSync(1400);
  });
  window.addEventListener('hometasks:sync-complete', event => {
    nutritionSyncNow({ silent: event?.detail?.silent !== false }).catch(error => console.warn('Sincronización Comidas:', error));
  });
  window.addEventListener('online', () => scheduleNutritionSync(700));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleNutritionSync(500);
  });

  window.addEventListener('hometasks:core-reset', async () => {
    await resetNutritionDatabase();
    await ensureMealTypes();
    await loadNutritionState({ refreshUsers: true });
    renderAllNutrition();
  });
}

async function initNutrition() {
  cacheElements();
  await ensureMealTypes();
  await loadNutritionState({ refreshUsers: true });
  setupEvents();
  renderAllNutrition();
  document.documentElement.dataset.nutritionVersion = NUTRITION_VERSION;
  if (!localStorage.getItem(LS_NUTRITION_LAST_SYNC)) localStorage.setItem(LS_NUTRITION_SYNC_DIRTY, '1');
  if (localStorage.getItem(LS_AUTO_SYNC) === '1') scheduleNutritionSync(2600);
}

initNutrition().catch(error => {
  console.error('No se pudo iniciar el módulo Comidas:', error);
  const panel = document.getElementById('mealsDayPanel');
  if (panel) panel.innerHTML = '<article class="card meal-library-empty">No se pudo abrir el almacenamiento local del módulo Comidas.</article>';
});
