/* =====================================================================
   script.js - Netlify Deployer
   Dimuat dengan <script defer> dari index.html
   ===================================================================== */

const DOM = {
    token: document.getElementById('n-token'),
    toggleToken: document.getElementById('toggle-token'),
    rememberToken: document.getElementById('remember-token'),
    dropdownTokenHistory: document.getElementById('dropdown-token-history'),
    btnLoadAccount: document.getElementById('btn-load-account'),
    btnDisconnect: document.getElementById('btn-disconnect'),
    alertBox: document.getElementById('alert-box'),

    navTabs: document.querySelectorAll('.nav-tab'),
    tabContents: document.querySelectorAll('.tab-content'),

    owner: document.getElementById('n-owner'),
    repo: document.getElementById('n-repo'),
    dropdownRepo: document.getElementById('dropdown-repo'),
    branch: document.getElementById('n-branch'),
    dropdownBranch: document.getElementById('dropdown-branch'),
    project: document.getElementById('n-project'),
    buildcmd: document.getElementById('n-buildcmd'),
    publishdir: document.getElementById('n-publishdir'),
    env: document.getElementById('n-env'),
    envLines: document.getElementById('env-lines'),
    btnTest: document.getElementById('btn-test'),
    btnDeploy: document.getElementById('btn-deploy'),
    btnCancelDeploy: document.getElementById('btn-cancel-deploy'),
    logContainer: document.getElementById('log-container'),
    logs: document.getElementById('logs'),

    deleteSelect: document.getElementById('n-delete-select'),
    btnTriggerDelete: document.getElementById('btn-trigger-delete'),
    modalDelete: document.getElementById('modal-delete'),
    modalContent: document.getElementById('modal-delete-content'),
    modalTarget: document.getElementById('modal-project-target'),
    btnCancelDel: document.getElementById('btn-cancel-delete'),
    btnConfirmDel: document.getElementById('btn-confirm-delete')
};

let netlifyProjects = [];
let ghPublicReposCache = [];
let ghBranchesCache = [];
let tokenHistoryList = JSON.parse(localStorage.getItem('netlifyDeployerTokens') || '[]');
let deployAbortController = null;

// FIX (XSS): semua teks dari API / input user di-escape sebelum masuk innerHTML
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// FIX: sleep yang langsung berhenti saat user menekan Cancel (sebelumnya menunggu sampai 4 detik)
const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Canceled')); }, { once: true });
});

const obfuscator = {
    encode: (str) => {
        if (!str) return '';
        return btoa(encodeURIComponent(str)).split('').reverse().join('');
    },
    decode: (hash) => {
        if (!hash) return '';
        try {
            return decodeURIComponent(atob(hash.split('').reverse().join('')));
        } catch (e) { return ''; }
    }
};

function renderTokenHistory() {
    if (tokenHistoryList.length === 0) return DOM.dropdownTokenHistory.classList.add('hidden');
    DOM.dropdownTokenHistory.innerHTML = '<div class="px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Saved Tokens</div>';

    tokenHistoryList.forEach(item => {
        const div = document.createElement('div');
        div.className = 'px-3 md:px-4 py-2 text-[10px] md:text-sm font-mono text-slate-300 hover:bg-teal-500/20 hover:text-white cursor-pointer transition-colors flex justify-between items-center';
        div.innerHTML = `<span><i class="fas fa-user-circle mr-1.5 text-teal-400"></i>${escapeHtml(item.username)}</span> <span class="text-[9px] opacity-50">Token</span>`;
        div.addEventListener('mousedown', (e) => { 
            e.preventDefault(); 
            DOM.token.value = obfuscator.decode(item.token);
            DOM.dropdownTokenHistory.classList.add('hidden');
            checkTokenLength();
            loadProjects();
        });
        DOM.dropdownTokenHistory.appendChild(div);
    });
    DOM.dropdownTokenHistory.classList.remove('hidden');
}

function saveTokenToHistory(token, username) {
    const encoded = obfuscator.encode(token);
    tokenHistoryList = tokenHistoryList.filter(t => t.token !== encoded);
    tokenHistoryList.unshift({ token: encoded, username, date: new Date().toISOString() });
    if (tokenHistoryList.length > 5) tokenHistoryList.pop();
    localStorage.setItem('netlifyDeployerTokens', JSON.stringify(tokenHistoryList));
}

function executeDisconnect() {
    // FIX: hapus SEMUA data sensitif (sebelumnya 'netlifyDeployerTokens' tetap tersimpan)
    localStorage.removeItem('netlifyDeployerSettingsUltra');
    localStorage.removeItem('netlifyDeployerTokens');
    Object.keys(sessionStorage).filter(k => k.startsWith('gh_repo_cache_')).forEach(k => sessionStorage.removeItem(k));
    location.reload();
}

async function fetchGitHubPublicRepos(forceRefresh = false) {
    const owner = DOM.owner.value.trim();
    if(!owner) return;

    const cacheKey = `gh_repo_cache_${owner}`;
    if (!forceRefresh) {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
            ghPublicReposCache = JSON.parse(cachedData);
            return;
        }
    }

    try {
        let page = 1;
        let allRepos = [];
        while(true) {
            const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&page=${page}&sort=updated`);
            if(!res.ok) break;
            const data = await res.json();
            if(data.length === 0) break;
            allRepos = allRepos.concat(data.map(r => r.name));
            if(data.length < 100) break;
            page++;
            if(page > 5) break;
        }
        if (allRepos.length > 0) {
            ghPublicReposCache = allRepos;
            sessionStorage.setItem(cacheKey, JSON.stringify(ghPublicReposCache));
        }
    } catch(e) { console.error("Failed loading Github repos", e); }
}

async function fetchGitHubBranches(owner, repo) {
    if(!owner || !repo) return;
    try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`);
        if(res.ok) {
            const data = await res.json();
            ghBranchesCache = data.map(b => b.name);
        }
    } catch(e) { console.error("Failed loading branches", e); }
}

function setupAutocomplete(inputEl, dropdownEl, getItemsFn, onSelectCb) {
    const render = () => {
        const items = typeof getItemsFn === 'function' ? getItemsFn() : getItemsFn;
        if (!items || items.length === 0) return dropdownEl.classList.add('hidden');

        const query = inputEl.value.toLowerCase();
        const filtered = items.filter(item => item.toLowerCase().includes(query));

        dropdownEl.innerHTML = '';
        if (filtered.length === 0) return dropdownEl.classList.add('hidden');

        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'px-3 md:px-4 py-2 text-[10px] md:text-sm font-mono text-slate-300 hover:bg-teal-500/20 hover:text-white cursor-pointer transition-colors';
            div.innerHTML = `<i class="fas fa-book mr-1.5 opacity-50 text-[10px]"></i>${escapeHtml(item)}`;

            div.addEventListener('mousedown', (e) => { 
                e.preventDefault(); e.stopPropagation();
                inputEl.value = item;
                dropdownEl.classList.add('hidden');
                saveSettings();
                if(onSelectCb) onSelectCb(item);
            });
            dropdownEl.appendChild(div);
        });
        dropdownEl.classList.remove('hidden');
    };

    inputEl.addEventListener('focus', render);
    inputEl.addEventListener('input', render);
    inputEl.addEventListener('blur', () => setTimeout(() => dropdownEl.classList.add('hidden'), 250));
}

window.addEventListener('DOMContentLoaded', () => {
    const saved = JSON.parse(localStorage.getItem('netlifyDeployerSettingsUltra') || '{}');
    if (saved.rememberToken && saved.token) {
        DOM.token.value = obfuscator.decode(saved.token);
        DOM.rememberToken.checked = true;
        checkTokenLength();
        DOM.btnDisconnect.classList.remove('hidden');
    }
    if (saved.owner) { DOM.owner.value = saved.owner; DOM.btnDisconnect.classList.remove('hidden'); }
    if (saved.repo) DOM.repo.value = saved.repo;
    if (saved.branch) DOM.branch.value = saved.branch;
    if (saved.buildcmd) DOM.buildcmd.value = saved.buildcmd;
    if (saved.publishdir) DOM.publishdir.value = saved.publishdir;
    if (saved.env) DOM.env.value = saved.env;

    if(saved.cachedProjects) {
        netlifyProjects = saved.cachedProjects;
        renderProjectDropdown();
    }

    setTimeout(updateEnvTextarea, 50); 

    setupAutocomplete(DOM.repo, DOM.dropdownRepo, () => ghPublicReposCache, (repoName) => {
        const owner = DOM.owner.value.trim();
        fetchGitHubBranches(owner, repoName);
    });
    setupAutocomplete(DOM.branch, DOM.dropdownBranch, () => ghBranchesCache);

    if (saved.owner && saved.repo) {
        fetchGitHubPublicRepos();
        fetchGitHubBranches(saved.owner, saved.repo);
    }

    DOM.token.addEventListener('input', checkTokenLength);
    DOM.token.addEventListener('focus', renderTokenHistory);
    DOM.token.addEventListener('blur', () => setTimeout(() => DOM.dropdownTokenHistory.classList.add('hidden'), 200));
    DOM.btnLoadAccount.addEventListener('click', loadProjects);
    DOM.btnDisconnect.addEventListener('click', executeDisconnect);

    DOM.toggleToken.addEventListener('click', () => {
        const isPass = DOM.token.type === 'password';
        DOM.token.type = isPass ? 'text' : 'password';
        DOM.toggleToken.innerHTML = isPass ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        DOM.toggleToken.classList.toggle('text-teal-400', isPass);
    });

    DOM.owner.addEventListener('change', () => {
        saveSettings();
        fetchGitHubPublicRepos(true);
    });

    const toggleAdvancedBtn = document.getElementById('toggle-advanced');
    if (toggleAdvancedBtn) {
        toggleAdvancedBtn.addEventListener('click', () => {
            const isExpanded = toggleAdvancedBtn.getAttribute('aria-expanded') === 'true';
            toggleAdvancedBtn.setAttribute('aria-expanded', !isExpanded);
            document.getElementById('advanced-settings').classList.toggle('hidden');
            document.getElementById('advanced-icon').classList.toggle('rotate-180');
                updateEnvTextarea();
        });
    }

    DOM.env.addEventListener('input', updateEnvTextarea);
    window.addEventListener('resize', updateEnvTextarea);

    // FIX: tab aksesibel - tombol asli, tabindex dinamis, navigasi panah kiri/kanan, Home/End
const tabsArr = Array.from(DOM.navTabs);
const activateTab = (tab, setFocus = false) => {
    tabsArr.forEach(t => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
    });
    DOM.tabContents.forEach(c => c.classList.toggle('active', c.id === tab.dataset.target));
    if (setFocus) tab.focus();
    hideAlert();
};
tabsArr.forEach((tab, i) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (e) => {
        const last = tabsArr.length - 1;
        const map = { ArrowRight: (i + 1) % tabsArr.length, ArrowLeft: (i - 1 + tabsArr.length) % tabsArr.length, Home: 0, End: last };
        if (e.key in map) { e.preventDefault(); activateTab(tabsArr[map[e.key]], true); }
    });
});

const inputs = [DOM.token, DOM.rememberToken, DOM.owner, DOM.repo, DOM.branch, DOM.buildcmd, DOM.publishdir, DOM.env];
    inputs.forEach(el => el.addEventListener('change', saveSettings));

    DOM.btnTest.addEventListener('click', testConnection);
    DOM.btnDeploy.addEventListener('click', startDeployment);
    DOM.btnCancelDeploy.addEventListener('click', () => {
        if(deployAbortController) deployAbortController.abort();
    });

    DOM.deleteSelect.addEventListener('change', () => {
        DOM.btnTriggerDelete.disabled = !DOM.deleteSelect.value;
    });
    DOM.btnTriggerDelete.addEventListener('click', () => {
    const selectedId = DOM.deleteSelect.value;
    const selectedProj = netlifyProjects.find(p => String(p.id) === String(selectedId));
    if (!selectedProj) { showAlert("Silakan pilih Project yang valid terlebih dahulu.", "error"); return; }
    DOM.modalTarget.textContent = selectedProj.name;
    openDeleteModal();
});
DOM.btnCancelDel.addEventListener('click', closeDeleteModal);
// FIX: modal bisa ditutup dengan klik area gelap & tombol Escape; Tab tidak keluar dari modal
DOM.modalDelete.addEventListener('mousedown', (e) => { if (e.target === DOM.modalDelete && !DOM.btnCancelDel.disabled) closeDeleteModal(); });
document.addEventListener('keydown', (e) => {
    if (!DOM.modalDelete.classList.contains('active')) return;
    if (e.key === 'Escape' && !DOM.btnCancelDel.disabled) closeDeleteModal();
    if (e.key === 'Tab') {
        const f = [DOM.btnCancelDel, DOM.btnConfirmDel].filter(b => !b.disabled);
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
});
DOM.btnConfirmDel.addEventListener('click', deleteProject);
});

let lastFocusedBeforeModal = null;
function openDeleteModal() {
    lastFocusedBeforeModal = document.activeElement;
    DOM.modalDelete.classList.add('active');
    DOM.modalContent.classList.replace('scale-95', 'scale-100');
    DOM.btnCancelDel.focus(); // aksi aman jadi fokus awal
}
function closeDeleteModal() {
    DOM.modalContent.classList.replace('scale-100', 'scale-95');
    setTimeout(() => DOM.modalDelete.classList.remove('active'), 200);
    if (lastFocusedBeforeModal) lastFocusedBeforeModal.focus();
}

function checkTokenLength() {
    DOM.btnLoadAccount.classList.toggle('hidden', DOM.token.value.trim().length <= 15);
}

function updateEnvTextarea() {
    DOM.env.style.height = 'auto';
    DOM.env.style.height = DOM.env.scrollHeight + 'px';
    const linesCount = DOM.env.value.split('\n').length;
    const minLines = Math.max(3, linesCount);
    let linesHtml = '';
    for(let i = 1; i <= minLines; i++) linesHtml += `<span>${i}</span>`;
    DOM.envLines.innerHTML = linesHtml;
}

function saveSettings() {
    const settings = {
        rememberToken: DOM.rememberToken.checked,
        token: DOM.rememberToken.checked ? obfuscator.encode(DOM.token.value.trim()) : '',
        owner: DOM.owner.value.trim(),
        repo: DOM.repo.value.trim(),
        branch: DOM.branch.value.trim(),
        buildcmd: DOM.buildcmd.value.trim(),
        publishdir: DOM.publishdir.value.trim(),
        env: DOM.env.value,
        cachedProjects: netlifyProjects
    };
    localStorage.setItem('netlifyDeployerSettingsUltra', JSON.stringify(settings));
}

function showAlert(message, type = 'error') {
    const bg = type === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-teal-500/10 border-teal-500/30 text-teal-400';
    const icon = type === 'error' ? 'fa-times-circle' : 'fa-check-circle';
    DOM.alertBox.className = `mt-1 mb-4 p-2.5 md:p-3 rounded-lg md:rounded-xl text-[10px] md:text-xs font-medium border flex items-start gap-2 shadow-inner relative z-10 ${bg}`;
    DOM.alertBox.innerHTML = `<i class="fas ${icon} mt-0.5 text-sm"></i> <div class="flex-1">${message}</div>`;
    DOM.alertBox.classList.remove('hidden');
    if (type === 'success') setTimeout(hideAlert, 6000);
}
function hideAlert() { DOM.alertBox.classList.add('hidden'); }

function log(message, type = 'info') {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    const time = `<span class="text-slate-600 select-none" aria-hidden="true">[${timeStr}]</span>`;
    let prefix = `<span class="text-teal-400 select-none" aria-hidden="true">❯</span>`;
    let colorClass = 'text-slate-300';

    if (type === 'success') { prefix = `<span class="text-emerald-400 select-none" aria-hidden="true">✔</span>`; colorClass = 'text-emerald-300 font-medium'; } 
    else if (type === 'error') { prefix = `<span class="text-rose-500 select-none" aria-hidden="true">✖</span>`; colorClass = 'text-rose-400 font-medium'; } 
    else if (type === 'warn') { prefix = `<span class="text-amber-400 select-none" aria-hidden="true">⚠</span>`; colorClass = 'text-amber-300'; }

    if (type === 'raw') {
        const div = document.createElement('div'); div.className = 'w-full mt-1 mb-1'; div.innerHTML = message; DOM.logs.appendChild(div);
    } else {
        const div = document.createElement('div'); div.className = `${colorClass} flex gap-1.5 md:gap-2 items-start`;
        div.innerHTML = `${time} ${prefix} <div class="flex-1 break-words">${message}</div>`; DOM.logs.appendChild(div);
    }
    DOM.logContainer.scrollTo({ top: DOM.logContainer.scrollHeight, behavior: 'smooth' });
}

function renderProjectDropdown() {
    if(netlifyProjects.length === 0) {
        DOM.deleteSelect.innerHTML = '<option value="">No projects found</option>';
        return;
    }
    DOM.deleteSelect.innerHTML = '<option value="">-- Select Project to Delete --</option>';
    netlifyProjects.sort((a,b) => a.name.localeCompare(b.name)).forEach(p => {
        const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name;
        DOM.deleteSelect.appendChild(opt);
    });
}

async function loadProjects() {
    const token = DOM.token.value.trim();
    if (!token) return showAlert("Please enter Netlify Token.", "error");

    hideAlert();
    const ogHtml = DOM.btnLoadAccount.innerHTML;
    DOM.btnLoadAccount.innerHTML = `<div class="spinner" aria-hidden="true"></div><span class="sr-only">Loading...</span>`;
    DOM.btnLoadAccount.disabled = true;

    let netlifyUsername = "Netlify User";
    let githubNamespace = null;

    try {
        try {
            const userRes = await fetch("https://api.netlify.com/api/v1/user", { headers: { "Authorization": `Bearer ${token}` } });
            if (userRes.ok) {
                const userData = await userRes.json();
                if (userData) {
                    netlifyUsername = userData.full_name || userData.slug || netlifyUsername;
                    if (userData.avatar_url) {
                        const avatarImg = document.getElementById('user-avatar');
                        avatarImg.src = userData.avatar_url;
                        avatarImg.style.display = 'block';
                        avatarImg.nextElementSibling.style.display = 'none';

                        if (userData.avatar_url.includes('avatars.githubusercontent.com/u/')) {
                            const match = userData.avatar_url.match(/\/u\/(\d+)/);
                            if (match && match[1]) {
                                try {
                                    const ghRes = await fetch(`https://api.github.com/user/${match[1]}`);
                                    if (ghRes.ok) {
                                        const ghData = await ghRes.json();
                                        if (ghData.login) githubNamespace = ghData.login;
                                    }
                                } catch (e) {}
                            }
                        }
                    }

                    if (!githubNamespace && userData.connected_accounts) {
                        const ghKeys = Object.keys(userData.connected_accounts).filter(k => k.toLowerCase().includes('github'));
                        if (ghKeys.length > 0) {
                            const ghData = userData.connected_accounts[ghKeys[0]];
                            if (typeof ghData === 'string') githubNamespace = ghData;
                            else if (ghData && ghData.name) githubNamespace = ghData.name;
                        }
                    }
                }
            }
        } catch(e) { }

        let allSites = [];
        let page = 1;
        while(true) {
            const res = await fetch(`https://api.netlify.com/api/v1/sites?per_page=100&page=${page}`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (!res.ok) {
                if(res.status === 401) throw new Error("Netlify Token Kadaluarsa atau Tidak Valid (401).");
                throw new Error("Failed to load projects. Check token.");
            }
            const data = await res.json();
            if (!data || data.length === 0) break;
            allSites.push(...data);
            if (data.length < 100) break;
            page++;
            if (page > 5) break;
        }

        netlifyProjects = allSites.map(p => ({ id: p.id, name: p.name }));

        if (!githubNamespace) {
            for (const site of allSites) {
                if (site.build_settings && site.build_settings.provider === 'github' && site.build_settings.repo_path) {
                    githubNamespace = site.build_settings.repo_path.split('/')[0];
                    break;
                }
            }
        }

        if (githubNamespace && !DOM.owner.value.trim()) {
            DOM.owner.value = githubNamespace;
            fetchGitHubPublicRepos(true);
        }

        DOM.btnDisconnect.classList.remove('hidden');
        if (DOM.rememberToken.checked) saveTokenToHistory(token, netlifyUsername); // FIX: hormati pilihan 'Remember'
        renderProjectDropdown();
        DOM.btnTriggerDelete.disabled = true;
        saveSettings();

        showAlert(`Successfully loaded ${netlifyProjects.length} sites.`, "success");
    } catch (err) { showAlert(escapeHtml(err.message), "error"); } 
    finally { DOM.btnLoadAccount.innerHTML = ogHtml; DOM.btnLoadAccount.disabled = false; }
}

async function deleteProject() {
    const token = DOM.token.value.trim();
    const selectedId = DOM.deleteSelect.value;
    const selectedProj = netlifyProjects.find(p => String(p.id) === String(selectedId));

    if (!token || !selectedProj) return;

    const ogHtml = DOM.btnConfirmDel.innerHTML;
    DOM.btnConfirmDel.innerHTML = `<div class="spinner" aria-hidden="true"></div><span class="sr-only">Deleting...</span>`;
    DOM.btnConfirmDel.disabled = true;
    DOM.btnCancelDel.disabled = true;

    try {
        const res = await fetch(`https://api.netlify.com/api/v1/sites/${selectedId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!res.ok && res.status !== 204) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || "Failed to delete project on Netlify.");
        }

        netlifyProjects = netlifyProjects.filter(p => String(p.id) !== String(selectedId));
        renderProjectDropdown();
        DOM.btnTriggerDelete.disabled = true;
        saveSettings();

        closeDeleteModal();
        showAlert(`Project <strong class="text-white">${escapeHtml(selectedProj.name)}</strong> deleted successfully.`, "success");

    } catch (err) {
        closeDeleteModal();
        showAlert(escapeHtml(err.message), "error");
    } finally {
        DOM.btnConfirmDel.innerHTML = 'Yes, Delete!';
        DOM.btnConfirmDel.disabled = false;
        DOM.btnCancelDel.disabled = false;
    }
}

async function testConnection() {
    const token = DOM.token.value.trim();
    const owner = DOM.owner.value.trim();
    const repo = DOM.repo.value.trim();

    if (!token || !owner || !repo) return log("Token, Owner, and Repo are required!", "error");
    saveSettings();

    log(`<div class="border-t border-slate-800/80 w-full my-1"></div>`, 'raw');
    log("Starting Access Test...", "info");

    const ogHtml = DOM.btnTest.innerHTML;
    DOM.btnTest.innerHTML = `<div class="spinner" aria-hidden="true"></div><span class="sr-only">Testing...</span>`;
    DOM.btnTest.disabled = true;

    try {
        const vRes = await fetch("https://api.netlify.com/api/v1/user", { headers: { "Authorization": `Bearer ${token}` } });
        if (!vRes.ok) throw new Error("Invalid Netlify Token.");
        log("Netlify token valid.", "success");

        const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (!ghRes.ok) {
            if (ghRes.status === 404) log("GitHub Repo returned 404 (Likely Private).", "warn");
            else log(`GitHub API returned: ${escapeHtml(ghRes.status + " " + ghRes.statusText)}`, "warn");
        } else {
            const ghData = await ghRes.json();
            log(`GitHub Repo accessible. [ID: ${ghData.id}]`, "success");
        }
    } catch (err) { log(escapeHtml(err.message), "error"); } 
    finally { DOM.btnTest.innerHTML = ogHtml; DOM.btnTest.disabled = false; }
}

async function startDeployment() {
    const token = DOM.token.value.trim();
    const owner = DOM.owner.value.trim();
    const repo = DOM.repo.value.trim();
    const branch = DOM.branch.value.trim() || 'main';

    if (!token || !owner || !repo) return log("Token, Owner, and Repo are required!", "error");

    let projectName = DOM.project.value.trim();
    if (!projectName) {
        projectName = repo.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        DOM.project.value = projectName;
    }

    saveSettings();

    log(`<div class="border-t border-slate-800/80 w-full my-2"></div>`, 'raw');
    log(`[START] Deploying: <span class="text-white font-bold">${escapeHtml(projectName)}</span>`, "info");

    const ogHtml = DOM.btnDeploy.innerHTML;
    DOM.btnDeploy.innerHTML = `<div class="spinner" aria-hidden="true"></div> <span class="ml-2 font-bold tracking-widest uppercase text-[10px] md:text-xs">Building...</span>`;
    DOM.btnDeploy.disabled = true;
    DOM.btnCancelDeploy.classList.remove('hidden');

    deployAbortController = new AbortController();

    try {
        const envStr = DOM.env.value.trim();
        const envObj = {};
        if (envStr) {
            const lines = envStr.split(/\r?\n/);
            lines.forEach(line => {
                const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
                if (match) {
                    let key = match[1];
                    let val = match[2] || '';
                    val = val.trim();
                    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
                        val = val.substring(1, val.length - 1);
                    }
                    envObj[key] = val;
                }
            });
        }

        if (deployAbortController.signal.aborted) throw new Error("Canceled");
        let repoId = null;
        log("Fetching GitHub Repo ID...", "info");
        try {
            const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
            if (ghRes.ok) {
                const ghData = await ghRes.json();
                repoId = parseInt(ghData.id);
            }
        } catch(e) { }

        if (deployAbortController.signal.aborted) throw new Error("Canceled");
        log("Configuring Site on Netlify...", "info");

        const sitePayload = { name: projectName };
        if (repoId) {
            sitePayload.repo = {
                provider: "github",
                id: repoId,
                repo: `${owner}/${repo}`,
                private: false,
                branch: branch
            };
            if (DOM.buildcmd.value.trim()) sitePayload.repo.cmd = DOM.buildcmd.value.trim();
            if (DOM.publishdir.value.trim()) sitePayload.repo.dir = DOM.publishdir.value.trim();
        }

        if (Object.keys(envObj).length > 0) {
            sitePayload.build_settings = { env: envObj };
        }

        const createRes = await fetch("https://api.netlify.com/api/v1/sites", {
                    signal: deployAbortController.signal,
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(sitePayload)
        });

        if (!createRes.ok) {
            const errData = await createRes.json();
            throw new Error(`Netlify Error: ${errData.message || 'Failed to create site'}`);
        }

        const siteData = await createRes.json();
        const siteId = siteData.id;

        log(`Site configured. ID: <span class="text-teal-400">${escapeHtml(siteId)}</span>`, "success");

        if (!netlifyProjects.some(p => p.id === siteId)) {
            netlifyProjects.push({ id: siteId, name: siteData.name });
            renderProjectDropdown();
            saveSettings();
        }

        if (!repoId) {
            log("Warning: Could not link Repo via API. Connect manually in Netlify Dashboard.", "warn");
        }

        log("Waiting for build to start...", "info");

        let status = "enqueued";
        let attempts = 0;
        let activeDeploy = null;
        let networkErrors = 0; 

        while (status !== "ready" && status !== "error" && status !== "canceled" && attempts < 150) {
            if (deployAbortController.signal.aborted) throw new Error("Canceled");

            attempts++;
            await sleep(4000, deployAbortController.signal);
            if (deployAbortController.signal.aborted) throw new Error("Canceled");

            try {
                const depRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
                            signal: deployAbortController.signal,
                    headers: { "Authorization": `Bearer ${token}` }
                });

                if (!depRes.ok) {
                    networkErrors++;
                    if (networkErrors > 5) { const fatal = new Error("Gagal terhubung ke Netlify API."); fatal.fatal = true; throw fatal; }
                    continue; 
                }
                networkErrors = 0; 

                const deploysData = await depRes.json();
                if (deploysData && deploysData.length > 0) {
                    activeDeploy = deploysData[0];
                    if (activeDeploy.state !== status) {
                        status = activeDeploy.state;
                        if (status === 'building') log(`Status: <span class="text-amber-400 font-bold animate-pulse">⚙ BUILDING...</span>`);
                        else log(`Status: <span class="text-slate-300 uppercase">${escapeHtml(status)}</span>`);
                    }
                }
            } catch (pollErr) {
                if (pollErr.fatal || pollErr.name === 'AbortError' || pollErr.message === 'Canceled') throw pollErr;
                networkErrors++;
                if (networkErrors > 5) throw new Error("Koneksi terputus.");
            }
        }

        if (status === "ready") {
            const url = escapeHtml(siteData.ssl_url || siteData.url);
            log("DEPLOYMENT SUCCESSFUL", "success");
            log(`
                <div class="mt-2 mb-1 p-3 border border-teal-500/30 bg-teal-950/20 rounded-lg shadow-inner">
                    <div class="mb-2 border-b border-teal-900/50 pb-2 text-teal-400 font-bold flex items-center gap-1.5 text-[11px] md:text-sm">
                        <i class="fas fa-check-circle"></i> App is Live
                    </div>
                    <div class="space-y-2 font-sans">
                        <a href="${url}" target="_blank" rel="noopener noreferrer" class="text-white hover:text-teal-300 font-medium break-all flex items-center gap-1.5 group w-max transition-colors text-[11px] md:text-sm">
                            <i class="fas fa-globe text-teal-500"></i> <span class="border-b border-transparent group-hover:border-teal-300 pb-0.5">${url}</span> 
                        </a>
                    </div>
                </div>
            `, "raw");
        } 
        else if (status === "error") {
            let errorMsg = `Deployment failed (Status: ERROR).`;
            if (activeDeploy && activeDeploy.error_message) {
                log(`<span class="text-rose-400 font-mono text-[10px] break-all">Reason: ${escapeHtml(activeDeploy.error_message)}</span>`, "raw");
            }
            if (activeDeploy && activeDeploy.id) {
                 log(`
                    <div class="mt-1 mb-1 p-2 border border-rose-500/30 bg-rose-950/20 rounded-lg">
                        <a href="https://app.netlify.com/sites/${encodeURIComponent(siteData.name)}/deploys/${encodeURIComponent(activeDeploy.id)}" target="_blank" rel="noopener noreferrer" class="text-rose-300 underline hover:text-rose-200 text-[10px] md:text-xs">
                            <i class="fas fa-external-link-alt mr-1"></i> View Full Logs in Netlify
                        </a>
                    </div>
                `, "raw");
            }
            throw new Error(errorMsg);
        } 
        else if (attempts >= 150) throw new Error("Timeout: Build exceeded limit.");
        else if (status !== "canceled") throw new Error(`Deployment failed (Status: ${status})`);

    } catch (err) {
        if (err.message === "Canceled" || err.name === "AbortError") log("Deployment wait canceled by user.", "warn");
        else log(escapeHtml(err.message), "error");
    } finally {
        DOM.btnDeploy.innerHTML = `<i class="fas fa-rocket"></i> <span>Deploy to Netlify</span>`;
        DOM.btnDeploy.disabled = false;
        DOM.btnCancelDeploy.classList.add('hidden');
        deployAbortController = null;
    }
}
