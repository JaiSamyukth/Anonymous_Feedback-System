// Applies a saved theme before first paint to avoid a flash.
try { var t = localStorage.getItem('afs-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
