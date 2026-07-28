export function renderPage(): string {
  const html = "</script><script>window.__xss_executed = true;</script>";
  const tricky = "line\u2028sep and <img src=x onerror=alert(1)>";
  return html + tricky + helperEvil();
}

export function helperEvil(): string {
  return "<div onclick=alert(2)>x</div>";
}
