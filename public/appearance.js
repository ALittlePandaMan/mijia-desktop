/* Blocking bootstrap: always follow the OS before stylesheet paint.
   Legacy manual preferences are intentionally ignored, without touching data. */
(function () {
  var theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.appearance = 'system';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.backgroundColor = theme === 'dark' ? '#141719' : '#f6f8f7';
})();
