'use strict';

const byId = id => document.getElementById(id);
const status = byId('status');
const config = window.giftConfig;
const invitation = new URLSearchParams(location.hash.slice(1)).get('zaproszenie');
const organizer = new URLSearchParams(location.search).has('organizator');
let adminKey = '';
let busy = false;
let adminState;
const links = new Map();

async function request(action, token, payload = {}) {
  if (!config.url || !config.publicKey) {
    throw new Error('Strona czeka na podłączenie bazy Supabase.');
  }
  const response = await fetch(new URL('/rest/v1/rpc/family_gifts', config.url), {
    method: 'POST',
    headers: { apikey: config.publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, payload })
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.code === 'P0001' ? result.message : 'Nie udało się połączyć z bazą.');
  }
  return result;
}

async function run(operation, message = '') {
  if (busy) return;
  busy = true;
  status.classList.remove('error');
  status.textContent = 'Chwileczkę…';
  const enabled = [...document.querySelectorAll('button:not(:disabled)')];
  enabled.forEach(button => { button.disabled = true; });
  try {
    await operation();
    status.textContent = message;
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.message;
  } finally {
    enabled.forEach(button => { button.disabled = false; });
    if (adminState) updateDrawButton();
    busy = false;
  }
}

function renderParticipant(person) {
  byId('participant').hidden = false;
  byId('greeting').textContent = 'Cześć, ' + person.name + '!';
  byId('wishes').value = person.wishes;
  byId('ready').checked = person.ready;
  byId('ready').disabled = person.drawn;
  byId('reveal').hidden = !person.drawn || !!person.recipient;
  byId('draw-state').textContent = person.drawn
    ? (person.recipient ? '' : 'Możesz już odkryć wynik.')
    : 'Gdy organizator uruchomi losowanie, wróć tutaj i odkryj wynik.';
  byId('result').hidden = !person.recipient;
  if (person.recipient) {
    byId('recipient').textContent = 'Prezent dla: ' + person.recipient.name;
    byId('recipient-wishes').textContent = person.recipient.wishes.trim() || 'Lista jest pusta.';
  }
}

function updateDrawButton() {
  byId('draw').disabled = adminState.drawn || adminState.people.length < 2 ||
    adminState.people.some(person => !person.ready);
}

function renderAdmin(data) {
  adminState = data;
  byId('login').hidden = true;
  byId('admin').hidden = false;
  byId('add-form').hidden = data.drawn;
  byId('draw').hidden = data.drawn;
  const ready = data.people.filter(person => person.ready).length;
  byId('progress').textContent = data.drawn
    ? 'Losowanie uruchomione. Odkryte wyniki: ' + data.people.filter(person => person.revealed).length + '/' + data.people.length
    : 'Gotowe listy: ' + ready + '/' + data.people.length;
  const list = byId('people');
  list.replaceChildren();
  for (const person of data.people) {
    const item = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = person.name + (person.ready ? ' · lista gotowa' : ' · lista w przygotowaniu');
    const button = document.createElement('button');
    button.className = 'secondary';
    button.type = 'button';
    button.textContent = person.invited ? 'Zmień link' : 'Utwórz link';
    button.onclick = () => {
      if (person.invited && !confirm('Poprzedni link przestanie działać. Utworzyć nowy?')) return;
      run(async () => {
        const response = await request('invite', adminKey, { id: person.id });
        const url = new URL(location.href);
        url.search = '';
        url.hash = 'zaproszenie=' + response.token;
        links.set(person.id, url.href);
        person.invited = true;
        renderAdmin(data);
      });
    };
    row.append(name, button);
    item.append(row);
    if (links.has(person.id)) {
      const input = document.createElement('input');
      input.readOnly = true;
      input.value = links.get(person.id);
      input.setAttribute('aria-label', 'Prywatny link dla ' + person.name);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'secondary';
      copy.textContent = 'Kopiuj link';
      copy.onclick = () => run(async () => {
        input.select();
        await navigator.clipboard.writeText(input.value);
      }, 'Link skopiowany.');
      item.append(input, copy);
    }
    list.append(item);
  }
  updateDrawButton();
}

byId('login-form').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    const key = byId('admin-key').value.trim();
    const data = await request('admin', key);
    adminKey = key;
    byId('admin-key').value = '';
    renderAdmin(data);
  });
};
byId('add-form').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    const names = byId('names').value.split('\n').map(name => name.trim()).filter(Boolean);
    renderAdmin(await request('add', adminKey, { names }));
    byId('names').value = '';
  });
};
byId('refresh').onclick = () => run(async () => renderAdmin(await request('admin', adminKey)));
byId('draw').onclick = () => {
  if (confirm('Uruchomić losowanie? Przydziały zostaną zapisane na stałe.')) {
    run(async () => renderAdmin(await request('draw', adminKey)), 'Losowanie jest gotowe.');
  }
};
byId('wish-form').onsubmit = event => {
  event.preventDefault();
  run(async () => renderParticipant(await request('save', invitation, {
    wishes: byId('wishes').value,
    ready: byId('ready').checked
  })), 'Lista zapisana.');
};
byId('reveal').onclick = () => run(async () => {
  const person = await request('reveal', invitation);
  // Odkrycie wyniku nie powinno nadpisywać rozpoczętej edycji listy.
  person.wishes = byId('wishes').value;
  renderParticipant(person);
});

if (invitation) {
  run(async () => renderParticipant(await request('me', invitation)));
} else {
  byId(organizer ? 'login' : 'welcome').hidden = false;
}
