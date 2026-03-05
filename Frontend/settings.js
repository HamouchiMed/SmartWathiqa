// Settings Page JavaScript

// Close drawer when clicking outside on mobile
document.addEventListener('click', (e) => {
  const drawer = document.getElementById('drawer');
  if (window.innerWidth < 1024 && drawer && !drawer.contains(e.target)) {
    drawer.classList.add('-translate-x-full');
  }
});

// Logout function
function logout() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    // Clear any stored session data
    localStorage.clear();
    sessionStorage.clear();

    // Show logout message
    alert('Vous avez été déconnecté avec succès.');

    // Redirect to login page
    window.location.href = 'firstscreen.html';
  }
}