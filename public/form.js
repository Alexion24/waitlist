const form = document.querySelector('#signup');
const button = form.querySelector('button');
const status = document.querySelector('#status');
const visit = document.querySelector('#visit');

function showLaunch(url) {
  document.querySelector('#phase').textContent = 'Сайт открыт';
  document.querySelector('#title').textContent = 'Мы открылись!';
  document.querySelector('#description').textContent = 'Сайт уже доступен по ссылке ниже.';
  form.hidden = true;
  visit.href = url;
  visit.hidden = false;
}

fetch('/api/status')
  .then((response) => response.json())
  .then(({ url }) => {
    if (url) showLaunch(url);
  })
  .catch(() => {});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = '';
  try {
    const response = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value }),
    });
    const { url, error } = await response.json();
    if (!response.ok) {
      status.dataset.tone = 'error';
      status.textContent = error;
    } else if (url) {
      showLaunch(url);
      visit.focus();
    } else {
      status.dataset.tone = 'success';
      status.textContent = 'Вы в списке! Пришлём ссылку, когда сайт откроется.';
      form.reset();
    }
  } catch {
    status.dataset.tone = 'error';
    status.textContent = 'Связь с сайтом прервалась. Попробуйте ещё раз.';
  } finally {
    button.disabled = false;
    form.removeAttribute('aria-busy');
  }
});
