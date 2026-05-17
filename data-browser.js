// nosdav minimal data browser — the page is the data. JSS embeds the
// resource as JSON-LD in #dataisland; this single module:
//   1. Injects its own <style> (no separate .css fetch needed)
//   2. Renders a small nav (Up / Home / Account / Docs) above the data
//   3. Parses the JSON-LD and pretty-prints with 2-space indent
//   4. Renders into #mashlib with every URI as a clickable <a>
document.head.insertAdjacentHTML('beforeend','<style>body{font:14px/1.6 system-ui,-apple-system,sans-serif;margin:2em;color:#222;background:#f3eee5}#mashlib pre{padding:1.5em;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:auto;white-space:pre-wrap;word-break:break-all;margin:0}a{color:#0a66c2;text-decoration:none}a:hover{text-decoration:underline}.nosdav-nav{display:flex;gap:1.2em;margin:0 0 .75em;padding:.6em 1em;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.05);font-size:.9em}.nosdav-nav a{font-family:inherit}.pod-os{color:#7a4ed8;text-decoration:none;font-size:1em;font-weight:600;margin:0 .15em 0 .3em;opacity:.65;transition:opacity .15s}.pod-os:hover{opacity:1;text-decoration:none}</style>')
const p=window.location.pathname
const up=(p==='/'||!p)?null:(s=>{const i=s.lastIndexOf('/');return i===0?'/':s.slice(0,i)+'/'})(p.replace(/\/$/,''))
const nav='<nav class="nosdav-nav">'+(up?`<a href="${up}" title="One level up">↑ Up</a>`:'')+'<a href="/">Home</a><a href="/account.html">Account</a><a href="/docs.html">Docs</a></nav>'
const d=JSON.parse(document.getElementById('dataisland').textContent)
document.getElementById('mashlib').innerHTML=nav+'<pre>'+JSON.stringify(d,null,2).replace(/https?:\/\/[^"\s]+/g,m=>`<a href="${m}">${m}</a><a class="pod-os" href="https://browser.pod-os.org/?uri=${encodeURIComponent(m)}" target="_blank" rel="noopener" title="View in pod-os">↗</a>`)+'</pre>'
