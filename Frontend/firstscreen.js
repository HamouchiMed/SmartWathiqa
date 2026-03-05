// First Screen Page JavaScript

document.getElementById('login-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  // For now, redirect to dashboard; later integrate with API
  window.location.href = 'dashboardemployer.html';
});