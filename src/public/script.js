const colorHues = [
    210, // Blue
    30, // Orange
    270, // Purple
    150, // Teal
    330, // Magenta
    60, // Yellow
    180, // Cyan
    0, // Red
    240, // Indigo
];

let colorIndex = 0;

function getNextColorShades() {
    const h = colorHues[colorIndex];
    colorIndex = (colorIndex + 1) % colorHues.length;
    const s = 90;
    const l_main = 30;
    const l_sub = 20;

    const mainColor = `hsl(${h}, ${s}%, ${l_main}%)`;
    const subColor = `hsl(${h}, ${s}%, ${l_sub}%)`;

    return { main: mainColor, sub: subColor };
}

const columnsContainer = document.getElementById('columnsContainer');
const settingsContainer = document.getElementById('settingsContainer');
const helpContainer = document.getElementById('helpContainer');
const passthroughTitle = document.getElementById('passthroughTitle');
const controlTool = document.getElementById('control-tool');
const controlPassthrough = document.getElementById('control-passthrough');
// const sortButton = document.getElementById('sortButton');
// const sortDropdown = document.getElementById('sortDropdown');
// const sortText = document.getElementById('sortText');
// const sortOptions = document.querySelectorAll('.sort-option');
const sortSelect = document.getElementById('sortSelect');
const filterSelect = document.getElementById('filterSelect');
const pauseButton = document.getElementById('pauseButton');
// const clearButton = document.getElementById('clearButton');
// const helpButton = document.getElementById('helpButton');
// const settingsButton = document.getElementById('settingsButton');
// const closeButton = document.getElementById('closeButton');
// const allButtons = [sortSelect, clearButton, pauseButton, helpButton, settingsButton, closeButton];
const serverStatus = document.getElementById('serverStatus');
const opacitySlider = document.getElementById('opacitySlider');
// const classFilterButton = document.getElementById('classFilterButton');
// const classFilterDropdown = document.getElementById('classFilterDropdown');
// const classFilterText = document.getElementById('classFilterText');
// const classFilterCheckboxes = document.querySelectorAll('[data-class-filter]');

let allUsers = {};
let userColors = {};
let isPaused = false;
let socket = null;
let rafPending = false;
let hasDataChanged = false;
let isWebSocketConnected = false;
let lastWebSocketMessage = Date.now();
const WEBSOCKET_RECONNECT_INTERVAL = 5000;
const SERVER_URL = 'localhost:8990';

let currentMode = 'damage';
let selectedClasses = new Set([
    'Frost Mage',
    'Heavy Guardian',
    'Marksman',
    'Shield Knight',
    'Soul Musician',
    'Stormblade',
    'Verdant Oracle',
    'Wind Knight',
]);

function formatNumber(num) {
    if (isNaN(num)) return 'NaN';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return Math.round(num).toString();
}

function sortUsers(users, mode) {
    switch (mode) {
        case 'damage':
            return users.sort(
                (a, b) => b.total_damage.total - a.total_damage.total || b.total_healing.total - a.total_healing.total
            );
        case 'healing':
            return users.sort(
                (a, b) => b.total_healing.total - a.total_healing.total || b.total_damage.total - a.total_damage.total
            );
        case 'taken':
            return users.sort((a, b) => b.taken_damage - a.taken_damage || b.total_damage.total - a.total_damage.total);
        case 'dps':
            return users.sort((a, b) => b.total_dps - a.total_dps || b.total_hps - a.total_hps);
        case 'hps':
            return users.sort((a, b) => b.total_hps - a.total_hps || b.total_dps - a.total_dps);
    }
}

function renderDataList(users) {
    columnsContainer.replaceChildren();

    let filteredUsers = users;
    if (!selectedClasses.has('all') && selectedClasses.size > 0) {
        filteredUsers = users.filter((user) => {
            if (!user.profession) return false;
            const professionValue = user.profession.split('(')[0].trim();
            return selectedClasses.has(professionValue);
        });
    }

    const totalDamageOverall = filteredUsers.reduce((sum, user) => sum + user.total_damage.total, 0);
    const totalHealingOverall = filteredUsers.reduce((sum, user) => sum + user.total_healing.total, 0);
    const totalDamageTakenOverall = filteredUsers.reduce((sum, user) => sum + (user.taken_damage || 0), 0);
    sortUsers(filteredUsers, currentMode);

    const fragment = document.createDocumentFragment();

    filteredUsers.forEach((user, index) => {
        if (!userColors[user.id]) {
            userColors[user.id] = getNextColorShades();
        }
        const colors = userColors[user.id];
        const item = document.createElement('li');

        item.className = 'data-item';
        const damagePercent = totalDamageOverall > 0 ? (user.total_damage.total / totalDamageOverall) * 100 : 0;
        const healingPercent = totalHealingOverall > 0 ? (user.total_healing.total / totalHealingOverall) * 100 : 0;
        const damageTakenPercent =
            totalDamageTakenOverall > 0 ? ((user.taken_damage || 0) / totalDamageTakenOverall) * 100 : 0;

        const displayName = user.fightPoint ? `${user.name} (${user.fightPoint})` : user.name;

        let classIconHtml = '';
        const professionString = user.profession ? user.profession.trim() : '';
        if (professionString) {
            const mainProfession = professionString.split('(')[0].trim();

            if (mainProfession !== '...' && mainProfession.length > 1 && !/^\.+$/.test(mainProfession)) {
                const iconFileName = mainProfession.toLowerCase().replace(/ /g, '_') + '.png';
                classIconHtml = `<img src="assets/${iconFileName}" class="class-icon" alt="${mainProfession}" onerror="this.style.display='none'">`;
            }
        }

        let mainBarContent, mainBarPercent, mainBarColor;

        const hasHealing = user.total_healing.total > 0 || user.total_hps > 0;
        const hasDamageTaken = (user.taken_damage || 0) > 0;
        const hasDamage = user.total_damage.total > 0 || user.total_dps > 0;

        if (currentMode === 'healing' || currentMode === 'hps') {
            mainBarContent = `${formatNumber(user.total_healing.total)} (${formatNumber(user.total_hps)} HPS, ${healingPercent.toFixed(1)}%)`;
            mainBarPercent = healingPercent;
            mainBarColor = colors.main;
        } else if (currentMode === 'taken') {
            mainBarContent = `${formatNumber(user.taken_damage)} (${damageTakenPercent.toFixed(1)}%)`;
            mainBarPercent = damageTakenPercent;
            mainBarColor = colors.main;
        } else {
            mainBarContent = `${formatNumber(user.total_damage.total)} (${formatNumber(user.total_dps)} DPS, ${damagePercent.toFixed(1)}%)`;
            mainBarPercent = damagePercent;
            mainBarColor = colors.main;
        }

        let subBarHtml = '';

        if (currentMode === 'healing' || currentMode === 'hps') {
            if (hasDamage) {
                subBarHtml += `
                <div class="sub-bar">
                    <div class="stats-bar-fill" style="width: ${damagePercent}%; background-color: ${colors.sub};"></div>
                    <div class="sub-bar-text">
                        <strong>DMG: ${formatNumber(user.total_damage.total)} (${formatNumber(user.total_dps)} DPS, ${damagePercent.toFixed(1)}%)</strong>
                    </div>
                </div>
                `;
            }

            if (hasDamageTaken) {
                subBarHtml += `
                <div class="sub-bar">
                    <div class="stats-bar-fill" style="width: ${damageTakenPercent}%; background-color: ${colors.sub};"></div>
                    <div class="sub-bar-text">
                        <strong>DMG Taken: ${formatNumber(user.taken_damage)} (${damageTakenPercent.toFixed(1)}%)</strong>
                    </div>
                </div>
                `;
            }
        } else if (currentMode === 'taken') {
            if (hasDamage) {
                subBarHtml += `
                <div class="sub-bar">
                    <div class="stats-bar-fill" style="width: ${damagePercent}%; background-color: ${colors.sub};"></div>
                    <div class="sub-bar-text">
                        <strong>DMG: ${formatNumber(user.total_damage.total)} (${formatNumber(user.total_dps)} DPS, ${damagePercent.toFixed(1)}%)</strong>
                    </div>
                </div>
                `;
            }

            if (hasHealing) {
                subBarHtml += `
                <div class="sub-bar">
                    <div class="stats-bar-fill" style="width: ${healingPercent}%; background-color: ${colors.sub};"></div>
                    <div class="sub-bar-text">
                        <strong>Heal: ${formatNumber(user.total_healing.total)} (${formatNumber(user.total_hps)} HPS, ${healingPercent.toFixed(1)}%)</strong>
                    </div>
                </div>
                `;
            }
        } else {
            if (hasDamageTaken) {
                subBarHtml += `
                <div class="sub-bar">
                    <div class="stats-bar-fill" style="width: ${damageTakenPercent}%; background-color: ${colors.sub};"></div>
                    <div class="sub-bar-text">
                        <strong>DMG Taken: ${formatNumber(user.taken_damage)} (${damageTakenPercent.toFixed(1)}%)</strong>
                    </div>
                </div>
                `;
            }

            if (hasHealing) {
                subBarHtml += `
                <div class="sub-bar">
                    <div class="stats-bar-fill" style="width: ${healingPercent}%; background-color: ${colors.sub};"></div>
                    <div class="sub-bar-text">
                        <strong>Heal: ${formatNumber(user.total_healing.total)} (${formatNumber(user.total_hps)} HPS, ${healingPercent.toFixed(1)}%)</strong>
                    </div>
                </div>
                `;
            }
        }

        item.innerHTML = `
            <div class="main-bar">
                <div class="stats-bar-fill" style="width: ${mainBarPercent}%; background-color: ${mainBarColor};"></div>
                <div class="content">
                    <span class="rank">${index + 1}.</span>
                    ${classIconHtml}
                    <span class="name">${displayName}</span>
                    <span class="stats">${mainBarContent}</span>
                </div>
            </div>
            ${subBarHtml}
        `;

        fragment.appendChild(item);
    });

    columnsContainer.appendChild(fragment);
}

function updateAll() {
    const usersArray = Object.values(allUsers).filter((user) => user.total_dps > 0 || user.total_hps > 0);
    renderDataList(usersArray);
}

function processDataUpdate(data) {
    if (isPaused) return;
    if (!data.user) {
        console.warn('Received data without a "user" object:', data);
        return;
    }

    for (const userId in data.user) {
        const newUser = data.user[userId];
        const existingUser = allUsers[userId] || {};

        const updatedUser = Object.assign({}, existingUser, newUser, { id: userId });

        const hasNewValidName = newUser.name && typeof newUser.name === 'string' && newUser.name !== '未知';
        if (hasNewValidName) {
            updatedUser.name = newUser.name;
        } else if (!existingUser.name || existingUser.name === '...') {
            updatedUser.name = '...';
        }

        const hasNewProfession = newUser.profession && typeof newUser.profession === 'string';
        if (hasNewProfession) {
            updatedUser.profession = newUser.profession;
        } else if (!existingUser.profession) {
            updatedUser.profession = '';
        }

        const hasNewFightPoint = newUser.fightPoint !== undefined && typeof newUser.fightPoint === 'number';
        if (hasNewFightPoint) {
            updatedUser.fightPoint = newUser.fightPoint;
        } else if (existingUser.fightPoint === undefined) {
            updatedUser.fightPoint = 0;
        }

        allUsers[userId] = updatedUser;
        hasDataChanged = true;
    }

    if (!rafPending && hasDataChanged) {
        rafPending = true;
        requestAnimationFrame(() => {
            updateAll();
            rafPending = false;
            hasDataChanged = false;
        });
    }
}

async function clearData() {
    try {
        const currentStatus = getServerStatus();
        showServerStatus('cleared');

        const response = await fetch(`http://${SERVER_URL}/api/clear`);
        const result = await response.json();

        if (result.code === 0) {
            allUsers = {};
            userColors = {};
            updateAll();
            showServerStatus('cleared');
            console.log('Data cleared successfully.');
        } else {
            console.error('Failed to clear data on server:', result.msg);
        }

        setTimeout(() => showServerStatus(currentStatus), 1000);
    } catch (error) {
        console.error('Error sending clear request to server:', error);
    }
}

function togglePause() {
    isPaused = !isPaused;
    pauseButton.innerHTML = isPaused
        ? '<img class="icon-button" src="/assets/caret-right.svg" />'
        : '<img class="icon-button" src="/assets/player-pause.svg" />';
    showServerStatus(isPaused ? 'paused' : 'connected');
}

function closeClient() {
    window.electronAPI.closeClient();
}

function showServerStatus(status) {
    const statusElement = document.getElementById('serverStatus');
    statusElement.className = `status-indicator ${status}`;
}

function getServerStatus() {
    const statusElement = document.getElementById('serverStatus');
    return statusElement.className.replace('status-indicator ', '');
}

function connectWebSocket() {
    socket = io(`ws://${SERVER_URL}`, {
        transports: ['websocket'],
        upgrade: false,
    });

    socket.on('connect', () => {
        isWebSocketConnected = true;
        showServerStatus('connected');
        lastWebSocketMessage = Date.now();
    });

    socket.on('disconnect', () => {
        isWebSocketConnected = false;
        showServerStatus('disconnected');
    });

    socket.on('data', (data) => {
        processDataUpdate(data);
        lastWebSocketMessage = Date.now();
    });

    socket.on('user_deleted', (data) => {
        console.log(`User ${data.uid} was removed due to inactivity.`);
        delete allUsers[data.uid];
        updateAll();
    });

    socket.on('connect_error', (error) => {
        showServerStatus('disconnected');
        console.error('WebSocket connection error:', error);
    });
}

function checkConnection() {
    if (!isWebSocketConnected && socket && socket.disconnected) {
        showServerStatus('reconnecting');
        socket.connect();
    }

    if (isWebSocketConnected && Date.now() - lastWebSocketMessage > WEBSOCKET_RECONNECT_INTERVAL) {
        isWebSocketConnected = false;
        if (socket) socket.disconnect();
        connectWebSocket();
        showServerStatus('reconnecting');
    }
}

function initialize() {
    connectWebSocket();
    setInterval(checkConnection, WEBSOCKET_RECONNECT_INTERVAL);
}

function toggleSettings() {
    const isSettingsVisible = !settingsContainer.classList.contains('hidden');

    if (isSettingsVisible) {
        settingsContainer.classList.add('hidden');
        columnsContainer.classList.remove('hidden');
    } else {
        settingsContainer.classList.remove('hidden');
        columnsContainer.classList.add('hidden');
        helpContainer.classList.add('hidden');
    }
}

function toggleHelp() {
    const isHelpVisible = !helpContainer.classList.contains('hidden');
    if (isHelpVisible) {
        helpContainer.classList.add('hidden');
        columnsContainer.classList.remove('hidden');
    } else {
        helpContainer.classList.remove('hidden');
        columnsContainer.classList.add('hidden');
        settingsContainer.classList.add('hidden');
    }
}

function setBackgroundOpacity(value) {
    document.documentElement.style.setProperty('--main-bg-opacity', value);
}

// function updateClassFilterText() {
//     if (!classFilterText) return;

//     if (selectedClasses.has('all')) {
//         classFilterText.textContent = 'All Classes';
//     } else if (selectedClasses.size === 1) {
//         classFilterText.textContent = Array.from(selectedClasses)[0];
//     } else if (selectedClasses.size > 1) {
//         classFilterText.textContent = `${selectedClasses.size} classes selected`;
//     } else {
//         classFilterText.textContent = 'All Classes';
//     }
// }

function setSelectValues(select, values) {
    // Normalize input: ensure array
    if (!Array.isArray(values)) values = [values];

    // For single select: only use the first value
    if (!select.multiple && values.length > 1) {
        values = [values[0]];
    }

    const wanted = new Set(values.map(String));

    for (const opt of select.options) {
        const shouldSelect = select.multiple ? wanted.has(opt.value) : opt.value === values[0];

        if (opt.selected !== shouldSelect) {
            opt.selected = shouldSelect;
        }
    }

    // Fire change
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

document.addEventListener('DOMContentLoaded', () => {
    initialize();
    setBackgroundOpacity(opacitySlider.value);

    opacitySlider.addEventListener('input', (event) => {
        setBackgroundOpacity(event.target.value);
    });

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentMode = e.target.value;
            updateAll();
        });

        setSelectValues(sortSelect, currentMode);
    }

    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            const values = Array.from(e.target.selectedOptions).map((opt) => opt.value);
            selectedClasses = new Set(values);
            updateAll();
        });

        setSelectValues(filterSelect, Array.from(selectedClasses));
    }

    // if (sortButton && sortDropdown) {
    //     sortButton.addEventListener('click', (e) => {
    //         e.stopPropagation();
    //         sortDropdown.classList.toggle('hidden');
    //         sortButton.classList.toggle('open');
    //     });

    //     sortOptions.forEach((option) => {
    //         option.addEventListener('click', () => {
    //             const value = option.getAttribute('data-value');
    //             currentMode = value;
    //             sortText.textContent = option.textContent;

    //             sortOptions.forEach((opt) => opt.classList.remove('active'));
    //             option.classList.add('active');

    //             sortDropdown.classList.add('hidden');
    //             sortButton.classList.remove('open');
    //             updateAll();
    //         });
    //     });

    //     document.addEventListener('click', (e) => {
    //         if (!sortButton.contains(e.target) && !sortDropdown.contains(e.target)) {
    //             sortDropdown.classList.add('hidden');
    //             sortButton.classList.remove('open');
    //         }
    //     });
    // }

    // Toggle class filter dropdown
    // if (classFilterButton) {
    //     classFilterButton.addEventListener('click', (e) => {
    //         e.stopPropagation();
    //         classFilterDropdown.classList.toggle('hidden');
    //         classFilterButton.classList.toggle('open');
    //     });
    // }

    // Close class filter dropdown when clicking outside
    // document.addEventListener('click', (e) => {
    //     if (classFilterButton && classFilterDropdown) {
    //         if (!classFilterButton.contains(e.target) && !classFilterDropdown.contains(e.target)) {
    //             classFilterDropdown.classList.add('hidden');
    //             classFilterButton.classList.remove('open');
    //         }
    //     }
    // });

    // Handle class filter checkbox changes
    // if (classFilterCheckboxes.length > 0) {
    //     classFilterCheckboxes.forEach((checkbox) => {
    //         checkbox.addEventListener('change', (e) => {
    //             const allCheckbox = document.querySelector('[data-class-filter][value="all"]');
    //             const otherCheckboxes = Array.from(classFilterCheckboxes).filter((cb) => cb.value !== 'all');

    //             if (e.target.value === 'all') {
    //                 if (e.target.checked) {
    //                     otherCheckboxes.forEach((cb) => (cb.checked = false));
    //                     selectedClasses = new Set(['all']);
    //                 } else {
    //                     e.target.checked = true;
    //                     selectedClasses = new Set(['all']);
    //                 }
    //             } else {
    //                 if (e.target.checked) {
    //                     allCheckbox.checked = false;
    //                 }

    //                 selectedClasses.clear();
    //                 otherCheckboxes.forEach((cb) => {
    //                     if (cb.checked) {
    //                         selectedClasses.add(cb.value);
    //                     }
    //                 });

    //                 if (selectedClasses.size === 0) {
    //                     allCheckbox.checked = true;
    //                     selectedClasses = new Set(['all']);
    //                 }
    //             }

    //             updateClassFilterText();
    //             updateAll();
    //         });
    //     });
    // }

    // Listen for the passthrough toggle event from the main process
    window.electronAPI.onTogglePassthrough((isIgnoring) => {
        if (isIgnoring) {
            controlTool.classList.add('hidden');
            controlPassthrough.classList.remove('hidden');
        } else {
            controlPassthrough.classList.add('hidden');
            controlTool.classList.remove('hidden');
        }
    });
});

window.clearData = clearData;
window.togglePause = togglePause;
window.toggleSettings = toggleSettings;
window.closeClient = closeClient;
window.toggleHelp = toggleHelp;
