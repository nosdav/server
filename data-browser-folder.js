// nosdav folder-aware data browser. JSS embeds the resource as JSON-LD
// in #dataisland; this script:
//   1. If the resource is an LDP container, render breadcrumb + table
//      (NAME / TYPE / SIZE / MODIFIED) with folder-first sorting and
//      friendly type labels.
//   2. Otherwise, fall back to a pretty-printed JSON-LD dump with
//      clickable URIs (same shape as data-browser.js).
//
// Single file, no build, no framework. Container-parsing logic mirrors
// solid-apps/chrome's Files pane (the proven version).

document.head.insertAdjacentHTML('beforeend', `<style>
body{font:14px/1.55 system-ui,-apple-system,sans-serif;margin:0;color:#222;background:#f3eee5}
.db{max-width:880px;margin:2em auto;padding:0 1em}
.db-nav{display:flex;gap:1.2em;margin:0 0 .75em;padding:.6em 1em;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.05);font-size:.9em}
.db-card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);padding:1.5em 2em}
.db-bc{display:flex;align-items:center;flex-wrap:wrap;gap:.25em;font-size:.95em;margin-bottom:.5em}
.db-bc a{color:#7a4ed8;font-weight:500}
.db-bc .sep{color:#888}
.db-bc .here{color:#222;font-weight:600}
.db-title{margin:.2em 0 .15em;font-size:1.6em;font-weight:500}
.db-url{color:#888;font-size:.85em;font-family:"SFMono-Regular",Consolas,monospace;margin-bottom:.6em;word-break:break-all}
.db-count{color:#666;font-size:.9em;margin:.6em 0 1em}
.db-table{width:100%;border-collapse:collapse}
.db-table th{text-align:left;padding:9px 8px;font-weight:600;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #7a4ed8}
.db-table td{padding:11px 8px;border-bottom:1px solid #eee;font-size:14px}
.db-table tr:hover td{background:#faf7f0}
.db-name{display:flex;align-items:center;gap:.6em}
.db-name a{color:#7a4ed8;text-decoration:none}
.db-name a:hover{text-decoration:underline}
.db-icon{font-size:18px;width:24px;text-align:center;flex-shrink:0}
.db-meta{color:#666;white-space:nowrap;font-size:13px}
.db-num{text-align:right}
.db-empty{padding:2em;text-align:center;color:#888}
.db-pre{padding:1.5em;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:auto;white-space:pre-wrap;word-break:break-all;margin:0}
.db-pre a{color:#0a66c2;text-decoration:none}
.db-pre a:hover{text-decoration:underline}
.db-pre .pod-os{color:#7a4ed8;text-decoration:none;font-size:1em;font-weight:600;margin:0 .15em 0 .3em;opacity:.65;transition:opacity .15s}
.db-pre .pod-os:hover{opacity:1;text-decoration:none}
</style>`);

(function () {
  const here = window.location.pathname;
  const up = (here === '/' || !here)
    ? null
    : (s => { const i = s.lastIndexOf('/'); return i === 0 ? '/' : s.slice(0, i) + '/'; })(here.replace(/\/$/, ''));
  const navHTML = `<nav class="db-nav">${
    up ? `<a href="${up}" title="One level up">↑ Up</a>` : ''
  }<a href="/">Home</a><a href="/account.html">Account</a><a href="/docs.html">Docs</a></nav>`;

  let doc = null;
  try { doc = JSON.parse(document.getElementById('dataisland').textContent); } catch (e) {}

  const items = doc ? parseContainer(doc, window.location.href) : null;
  const isContainer = Array.isArray(items);

  const target = document.getElementById('mashlib');
  if (isContainer) {
    target.innerHTML = `<div class="db">${navHTML}<div class="db-card">${renderFolder(items, here)}</div></div>`;
  } else {
    target.innerHTML = `<div class="db">${navHTML}${renderJson(doc)}</div>`;
  }

  function renderFolder(items, path) {
    const folders = items.filter(i => i.type === 'container').length;
    const files = items.length - folders;
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'container' ? -1 : 1;
      return nameOf(a.url).localeCompare(nameOf(b.url));
    });

    const segments = path.replace(/\/$/, '').split('/').filter(Boolean);
    const here = segments[segments.length - 1] || window.location.host;
    let acc = '/';
    const crumbs = [`<a href="/">${escape(window.location.host)}</a>`].concat(
      segments.map((s, i) => {
        acc += s + '/';
        return i === segments.length - 1
          ? `<span class="sep">/</span><span class="here">${escape(decodeURIComponent(s))}</span>`
          : `<span class="sep">/</span><a href="${escape(acc)}">${escape(decodeURIComponent(s))}</a>`;
      })
    ).join('');

    const rows = items.length
      ? `<table class="db-table">
          <thead><tr><th>NAME</th><th>TYPE</th><th class="db-num">SIZE</th><th>MODIFIED</th></tr></thead>
          <tbody>${items.map(rowHTML).join('')}</tbody>
        </table>`
      : `<div class="db-empty">Empty container</div>`;

    return `
      <div class="db-bc">${crumbs}</div>
      <div class="db-title">${escape(decodeURIComponent(here))}</div>
      <div class="db-url">${escape(window.location.href)}</div>
      <div class="db-count">${folders} folder${folders === 1 ? '' : 's'}, ${files} file${files === 1 ? '' : 's'}</div>
      ${rows}
    `;
  }

  function rowHTML(it) {
    const name = nameOf(it.url);
    const tl = typeLabel(it);
    const icon = iconFor(it);
    return `<tr>
      <td class="db-name"><span class="db-icon">${icon}</span><a href="${escape(it.url)}">${escape(name)}${it.type === 'container' ? '/' : ''}</a></td>
      <td class="db-meta">${escape(tl)}</td>
      <td class="db-meta db-num">${it.size != null ? fmtBytes(it.size) : '—'}</td>
      <td class="db-meta">${it.modified ? fmtDate(it.modified) : '—'}</td>
    </tr>`;
  }

  function renderJson(d) {
    if (!d) return `<div class="db-pre">No data.</div>`;
    const pretty = JSON.stringify(d, null, 2)
      .replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
      .replace(/https?:\/\/[^"\s]+/g, m =>
        `<a href="${m}">${m}</a><a class="pod-os" href="https://browser.pod-os.org/?uri=${encodeURIComponent(m)}" target="_blank" rel="noopener" title="View in pod-os">↗</a>`);
    return `<pre class="db-pre">${pretty}</pre>`;
  }

  // ---- container parsing (JSON-LD with ldp:contains) ----

  function parseContainer(doc, baseUrl) {
    const nodes = Array.isArray(doc?.['@graph']) ? doc['@graph'] : [doc];
    const container = nodes.find(n =>
      n['@id'] === baseUrl ||
      (typeof n['@id'] === 'string' && resolveUrl(n['@id'], baseUrl) === baseUrl)
    ) || nodes[0];
    if (!container) return null;
    const raw = container['contains']
      ?? container['ldp:contains']
      ?? container['http://www.w3.org/ns/ldp#contains'];
    if (raw == null) return null;
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(c => {
      if (typeof c === 'string') return { url: resolveUrl(c, baseUrl), type: c.endsWith('/') ? 'container' : 'resource' };
      const url = resolveUrl(c['@id'], baseUrl);
      const types = [].concat(c['@type'] || []);
      const isC = types.some(t => /(?:#|\/)(?:BasicContainer|Container)$/.test(t)) || url.endsWith('/');
      return {
        url,
        type: isC ? 'container' : 'resource',
        size: c['stat:size'] ?? c['http://www.w3.org/ns/posix/stat#size'],
        modified: c['dcterms:modified'] ?? c['http://purl.org/dc/terms/modified'] ?? c['dc:modified'],
      };
    }).filter(x => x.url && x.url !== baseUrl);
  }

  // ---- formatting helpers ----

  function nameOf(url) {
    return decodeURIComponent(url.replace(/\/$/, '').split('/').pop() || url);
  }
  function typeLabel(it) {
    if (it.type === 'container') return 'Folder';
    const ext = nameOf(it.url).split('.').pop()?.toLowerCase() || '';
    const map = {
      html: 'HTML', htm: 'HTML',
      md: 'Markdown', markdown: 'Markdown',
      json: 'JSON', jsonld: 'JSON-LD',
      ttl: 'Turtle', n3: 'N3', rdf: 'RDF',
      css: 'CSS', js: 'JavaScript', ts: 'TypeScript',
      png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image', svg: 'SVG', avif: 'Image',
      mp3: 'Audio', ogg: 'Audio', wav: 'Audio', flac: 'Audio',
      mp4: 'Video', webm: 'Video', mov: 'Video',
      pdf: 'PDF',
      txt: 'Text', text: 'Text',
      acl: 'ACL',
    };
    return map[ext] || (ext ? ext.toUpperCase() : '—');
  }
  function iconFor(it) {
    if (it.type === 'container') return '📁';
    const ext = nameOf(it.url).split('.').pop()?.toLowerCase() || '';
    if (/^(html|htm)$/.test(ext)) return '🌐';
    if (/^(json|jsonld|ttl|n3|rdf)$/.test(ext)) return '🔗';
    if (/^(md|markdown|txt|text)$/.test(ext)) return '📝';
    if (/^(png|jpg|jpeg|gif|webp|svg|avif)$/.test(ext)) return '🖼';
    if (/^(mp3|ogg|wav|flac)$/.test(ext)) return '🎵';
    if (/^(mp4|webm|mov)$/.test(ext)) return '🎬';
    if (ext === 'pdf') return '📕';
    if (ext === 'acl') return '🔒';
    return '📄';
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch { return String(iso); }
  }
  function resolveUrl(href, base) { try { return new URL(href, base).href; } catch { return href; } }
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
