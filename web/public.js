// Optional clipboard convenience; the public site makes no API requests.
document.querySelectorAll('.copy').forEach(button => {
  button.addEventListener('click', async () => {
    const code = button.closest('.codeblock')?.querySelector('code');
    if (!code) return;
    try { await navigator.clipboard.writeText(code.textContent); button.textContent = 'Скопировано'; }
    catch { button.textContent = 'Выделите и скопируйте текст'; }
  });
});
