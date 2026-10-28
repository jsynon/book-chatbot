/* Local-only appearance controller; no Worker calls or external dependencies. */
(() => {
  const key='antilogicalism-local-workbench-theme';
  const root=document.documentElement;
  const preference=()=>{try{return localStorage.getItem(key)}catch{return null}};
  const systemDark=()=>window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  function apply(mode){const dark=mode==='dark'||(mode!=='light'&&systemDark());root.dataset.localTheme=dark?'dark':'light';const btn=document.getElementById('local-theme-toggle');if(btn){btn.setAttribute('aria-pressed',String(dark));btn.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');const label=btn.querySelector('span');if(label)label.textContent=dark?'Light mode':'Dark mode';}}
  apply(preference());
  document.addEventListener('DOMContentLoaded',()=>{
    const nav=document.querySelector('#masthead .main-navigation');if(!nav)return;
    const button=document.createElement('button');button.id='local-theme-toggle';button.className='local-theme-toggle';button.type='button';button.innerHTML='<span>Dark mode</span>';nav.appendChild(button);
    button.addEventListener('click',()=>{const next=root.dataset.localTheme==='dark'?'light':'dark';try{localStorage.setItem(key,next)}catch{}apply(next)});apply(preference());
  });
  if(window.matchMedia){const m=window.matchMedia('(prefers-color-scheme: dark)');m.addEventListener?.('change',()=>{if(!preference())apply(null)})}
})();
