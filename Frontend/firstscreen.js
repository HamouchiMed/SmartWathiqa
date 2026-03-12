// First Screen Page JavaScript

document.getElementById('login-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const payload = JSON.stringify({ email: username, password });
    let response = null;
    let lastError = null;
    const apiUrls = [
      'http://localhost:3001/api/auth/login',
      'http://127.0.0.1:3001/api/auth/login'
    ];

    for (const apiUrl of apiUrls) {
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
        if (response) break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!response) {
      throw lastError || new Error('API unreachable');
    }

    const result = await response.json();

    if (!response.ok || !result.success) {
      alert('Email ou mot de passe incorrect.');
      return;
    }

    localStorage.setItem('currentUser', JSON.stringify(result.data));

    if (result.data.role === 'employer') {
      window.location.href = 'dashboardemployer.html';
      return;
    }

    if (result.data.role === 'admin') {
      window.location.href = 'dashboardadmin.html';
      return;
    }

    if (result.data.role === 'directeur') {
      window.location.href = 'dashboarddirecteur.html';
      return;
    }

    alert('Accès refusé pour ce rôle.');
  } catch (err) {
    alert('Impossible de se connecter au serveur (http://localhost:3001). Vérifiez que le backend est démarré.');
  }
});
