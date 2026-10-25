(function () {
  var theme = 'light';
  try {
    var saved = localStorage.getItem('cotes.theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
  } catch (e) {
    /* stockage indisponible : thème clair */
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
