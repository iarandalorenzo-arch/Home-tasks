import { getAll } from './db.js';
import {
  nutritionGetAll,
  nutritionPut,
  nutritionPutMany,
  nutritionRemove,
  resetNutritionDatabase,
} from './nutrition-db.js';

const NUTRITION_VERSION = '11-C';
const LS_SELECTED_PERSON = 'hometasks-meals-person';
const LS_SELECTED_DATE = 'hometasks-meals-date';
const LS_SYNC_ENDPOINT = 'hometasks-appsscript-endpoint';
const LS_SYNC_HOUSE_KEY = 'hometasks-appsscript-house-key';
const CHAT_HISTORY_LIMIT = 10;
const CHAT_LIBRARY_LIMIT = 80;
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

async function chatPost(payload, timeoutMs = 95000) {
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
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('ChatGPT está tardando demasiado en responder.');
    throw new Error('No se ha podido enviar la consulta a Apps Script.');
  } finally { clearTimeout(timer); }
}

function setChatStatus(kind, text, model = '') {
  if (!els.nutritionChatStatus) return;
  els.nutritionChatStatus.className = `nutrition-chat-status ${kind}`;
  els.nutritionChatStatus.textContent = text;
  els.nutritionChatModel.textContent = model ? `Modelo: ${model}` : '';
}

function chatMessagesForPerson(personId = state.selectedPersonId) {
  return state.chatMessages
    .filter(item => item.personId === personId && (item.role === 'user' || item.role === 'assistant'))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function buildChatContext() {
  const user = state.users.find(item => item.id === state.selectedPersonId);
  const target = currentTarget();
  const totals = totalsFor(state.selectedPersonId, state.selectedDate);
  const meals = state.mealTypes.map(type => ({
    name: type.name,
    totals: totalsFor(state.selectedPersonId, state.selectedDate, type.id),
    foods: entriesFor(state.selectedPersonId, state.selectedDate, type.id).map(entry => {
      const food = foodForEntry(entry);
      return { name: food?.name || 'Alimento eliminado', grams: safeNumber(entry.quantityGrams), values: nutritionForEntry(entry) };
    }),
  })).filter(meal => meal.foods.length);
  const weekStart = mondayISO(state.selectedDate);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = shiftISO(weekStart, index);
    return { date, totals: totalsFor(state.selectedPersonId, date), plannedFoods: entriesFor(state.selectedPersonId, date).length };
  });
  const library = state.foods.slice(0, CHAT_LIBRARY_LIMIT).map(food => ({
    name: food.name, kcal: safeNumber(food.kcal), protein: safeNumber(food.protein), carbs: safeNumber(food.carbs), fat: safeNumber(food.fat), fiber: safeNumber(food.fiber), source: food.source || 'Manual',
  }));
  return {
    person: { id: state.selectedPersonId, name: user?.name || 'Persona seleccionada' },
    selectedDate: state.selectedDate,
    targets: target ? { kcal: safeNumber(target.kcal), protein: safeNumber(target.protein), carbs: safeNumber(target.carbs), fat: safeNumber(target.fat), fiber: safeNumber(target.fiber) } : null,
    dayTotals: totals,
    meals,
    weekStart,
    week,
    foodLibrary: library,
    foodLibraryTruncated: state.foods.length > CHAT_LIBRARY_LIMIT,
  };
}

function renderChatMessages() {
  if (!els.nutritionChatMessages) return;
  const messages = chatMessagesForPerson();
  if (!messages.length) {
    els.nutritionChatMessages.innerHTML = `<div class="nutrition-chat-welcome"><strong>ChatGPT puede leer el contexto de Comidas.</strong><span>Pregúntale por el menú del ${escapeHTML(formatDateLong(state.selectedDate))}, tus objetivos, la semana o los alimentos guardados. No modificará datos automáticamente.</span></div>`;
  } else {
    els.nutritionChatMessages.innerHTML = messages.map(message => `<div class="nutrition-chat-message ${message.role}"><div>${escapeHTML(message.text).replace(/\n/g, '<br>')}</div><small>${new Date(message.createdAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</small></div>`).join('');
  }
  if (state.chatBusy) els.nutritionChatMessages.insertAdjacentHTML('beforeend', '<div class="nutrition-chat-message assistant pending">ChatGPT está preparando la respuesta…</div>');
  els.nutritionChatMessages.scrollTop = els.nutritionChatMessages.scrollHeight;
  els.clearNutritionChat.disabled = !messages.length || state.chatBusy;
}

function renderChatContextLabel() {
  const user = state.users.find(item => item.id === state.selectedPersonId);
  if (els.nutritionChatContextLabel) els.nutritionChatContextLabel.textContent = `${user?.name || 'Sin persona'} · ${formatDateLong(state.selectedDate)}`;
}

async function refreshChatBackendStatus() {
  const config = chatBackendConfig();
  if (!navigator.onLine) {
    state.chatBackendReady = false;
    setChatStatus('error', 'Sin conexión');
    els.nutritionChatSetup.hidden = false;
    els.nutritionChatSetupText.textContent = 'El historial local está disponible, pero ChatGPT necesita conexión a Internet.';
    return false;
  }
  if (!config.endpoint || !config.houseKey) {
    state.chatBackendReady = false;
    setChatStatus('error', 'Apps Script sin configurar');
    els.nutritionChatSetup.hidden = false;
    els.nutritionChatSetupText.textContent = 'Configura la URL /exec y la clave de la casa en Ajustes. V11-C usa ese mismo backend como proxy seguro.';
    return false;
  }
  setChatStatus('checking', 'Comprobando ChatGPT…');
  try {
    const result = await chatJsonpRequest('nutrition_ai_status', {}, 18000);
    state.chatBackendReady = Boolean(result.ok && result.configured);
    state.chatBackendModel = result.model || '';
    if (state.chatBackendReady) {
      setChatStatus('ready', 'ChatGPT conectado', state.chatBackendModel);
      els.nutritionChatSetup.hidden = true;
      return true;
    }
    const message = result.error === 'unauthorized'
      ? 'La clave de la casa no coincide con el Apps Script desplegado.'
      : 'Añade OPENAI_API_KEY en Propiedades de secuencia de comandos del proyecto Apps Script y vuelve a desplegar V11-C.';
    setChatStatus('error', 'ChatGPT sin configurar');
    els.nutritionChatSetup.hidden = false;
    els.nutritionChatSetupText.textContent = message;
    return false;
  } catch (error) {
    state.chatBackendReady = false;
    setChatStatus('error', 'Backend no disponible');
    els.nutritionChatSetup.hidden = false;
    els.nutritionChatSetupText.textContent = error?.message || 'No se ha podido comprobar el backend.';
    return false;
  }
}

async function openNutritionChat() {
  if (!state.selectedPersonId) return showToast('Añade o selecciona una persona antes de abrir el chat');
  renderChatContextLabel();
  renderChatMessages();
  els.nutritionChatInput.value = '';
  els.nutritionChatDialog.showModal();
  setTimeout(() => els.nutritionChatInput.focus(), 40);
  await refreshChatBackendStatus();
}

async function pollChatResult(requestId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await chatJsonpRequest('nutrition_chat_result', { requestId }, 22000);
    if (result?.status === 'pending') {
      await new Promise(resolve => setTimeout(resolve, 900 + attempt * 120));
      continue;
    }
    if (!result?.ok) throw new Error(result?.message || 'ChatGPT no ha podido responder.');
    if (!result?.text) throw new Error('ChatGPT ha devuelto una respuesta vacía.');
    return result;
  }
  throw new Error('No se ha recibido la respuesta de ChatGPT dentro del tiempo esperado.');
}

async function sendNutritionChat(event) {
  event.preventDefault();
  if (state.chatBusy || !state.selectedPersonId) return;
  const text = String(els.nutritionChatInput.value || '').trim();
  if (!text) return;
  if (!navigator.onLine) return showToast('ChatGPT necesita conexión a Internet');
  if (!state.chatBackendReady && !(await refreshChatBackendStatus())) return;

  const previous = chatMessagesForPerson().slice(-CHAT_HISTORY_LIMIT).map(item => ({ role: item.role, text: item.text }));
  const now = Date.now();
  const userMessage = { id: makeId(), personId: state.selectedPersonId, role: 'user', text, date: state.selectedDate, createdAt: now, modifiedAt: now };
  await nutritionPut('chatMessages', userMessage);
  state.chatMessages.push(userMessage);
  els.nutritionChatInput.value = '';
  state.chatBusy = true;
  els.nutritionChatSend.disabled = true;
  renderChatMessages();

  try {
    const requestId = makeId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 72);
    await chatPost({ action: 'nutrition_chat', requestId, message: text, history: previous, context: buildChatContext() });
    const result = await pollChatResult(requestId);
    const responseTime = Date.now();
    const assistantMessage = { id: makeId(), personId: state.selectedPersonId, role: 'assistant', text: result.text, date: state.selectedDate, model: result.model || state.chatBackendModel || '', createdAt: responseTime, modifiedAt: responseTime };
    await nutritionPut('chatMessages', assistantMessage);
    state.chatMessages.push(assistantMessage);
    state.chatBackendModel = result.model || state.chatBackendModel;
    setChatStatus('ready', 'ChatGPT conectado', state.chatBackendModel);
  } catch (error) {
    console.error('Chat nutricional:', error);
    showToast(error?.message || 'No se pudo obtener respuesta de ChatGPT');
    setChatStatus('error', 'Error en la última consulta', state.chatBackendModel);
  } finally {
    state.chatBusy = false;
    els.nutritionChatSend.disabled = false;
    renderChatMessages();
    setTimeout(() => els.nutritionChatInput.focus(), 20);
  }
}

async function clearNutritionChatHistory() {
  const messages = chatMessagesForPerson();
  if (!messages.length || state.chatBusy) return;
  const user = state.users.find(item => item.id === state.selectedPersonId);
  if (!confirm(`¿Empezar un chat nuevo para ${user?.name || 'esta persona'}? Se eliminará únicamente el historial local del chat.`)) return;
  for (const message of messages) await nutritionRemove('chatMessages', message.id);
  state.chatMessages = state.chatMessages.filter(item => item.personId !== state.selectedPersonId);
  renderChatMessages();
  showToast('Chat local reiniciado');
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
  els.nutritionChatSettingsButton.addEventListener('click', () => {
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
}

initNutrition().catch(error => {
  console.error('No se pudo iniciar el módulo Comidas:', error);
  const panel = document.getElementById('mealsDayPanel');
  if (panel) panel.innerHTML = '<article class="card meal-library-empty">No se pudo abrir el almacenamiento local del módulo Comidas.</article>';
});
