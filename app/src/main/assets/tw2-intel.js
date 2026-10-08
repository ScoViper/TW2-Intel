// ==UserScript==
// @name         TW2 Intelligence Dashboard
// @namespace    tw2-intel
// @version      1.6.0
// @description  TW2 incoming attack intelligence + attack trains + automatic Resource Deposit
// @match        *://*.tribalwars2.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
'use strict';

/* ============================================================
   CONFIG
   ============================================================ */

const NativeWorker = window.Worker;

const CFG = {
    PAGE_SIZE: 250,
    TRAIN_MAX_GAP: 5,
    PACE_TOLERANCE: 1.5,
    INCOMING_REFRESH: 60000,
    RESOURCE_CHECK: 5000,
    ACTION_COOLDOWN: 4000,
    RESOURCE_REFRESH_WAIT: 3000
};

const SPEEDS = [
    {name:'CAV / KNIGHT', speed:8},
    {name:'INFANTRY', speed:14},
    {name:'SWORD', speed:18},
    {name:'RAM / CATAPULT', speed:24},
    {name:'NOBLE', speed:35},
    {name:'TREBUCHET', speed:50}
];


/* ============================================================
   STORAGE
   ============================================================ */

function loadJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch(e) {
        return fallback;
    }
}

function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch(e) {}
}


/* ============================================================
   STATE
   ============================================================ */

const S = window.tw2Intel = {

    version:'1.6.0',

    worker:null,
    socketFound:false,

    tokenEmit:null,
    userAgent:'browser',

    incoming:new Map(),
    incomingTemplate:null,

    trains:[],

    resourceDeposit:null,
    resourceInfoVersion:0,

    resourceTemplates:
        loadJSON('tw2Intel.resourceTemplates', {}),

    resourceAuto:
        localStorage.getItem('tw2Intel.resourceAuto') !== '0',

    resourceBusy:false,

    resourceActive:
        loadJSON('tw2Intel.resourceActive', null),

    resourceLastAction:null,
    resourceLastError:null,

    currentVillageId:null,

    pending:new Map(),
    nextID:920000,

    collecting:false,
    scheduled:false,

    lastCollection:null,
    lastError:null,

    nextResourceAction:0,

    waitingFreshResource:false,
    lastCollectedJobId:null,

    attackView:'summary'
};


/* ============================================================
   HELPERS
   ============================================================ */

function clone(value) {
    try {
        return JSON.parse(JSON.stringify(value ?? {}));
    } catch(e) {
        return {};
    }
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&','&amp;')
        .replaceAll('<','&lt;')
        .replaceAll('>','&gt;')
        .replaceAll('"','&quot;')
        .replaceAll("'",'&#039;');
}

function isMaskedName(value) {
    const text = String(value ?? '').trim();

    if (!text)
        return true;

    const questions =
        (text.match(/\?/g) || []).length;

    return (
        questions >= 2 ||
        /^K\?+$/i.test(text) ||
        /^\?+$/.test(text)
    );
}

function displayCharacter(c) {

    const name =
        c && c.origin_character_name;

    if (!isMaskedName(name))
        return String(name);

    const id =
        c && c.origin_character_id;

    return (
        id !== undefined &&
        id !== null
    )
        ? 'Unknown attacker #' + id
        : 'Unknown attacker';
}

function displayOrigin(c) {

    const name =
        c && c.origin_village_name;

    if (!isMaskedName(name))
        return String(name);

    const id =
        c && c.origin_village_id;

    return (
        id !== undefined &&
        id !== null
    )
        ? 'Origin #' + id
        : 'Unknown origin';
}

function buildOrigins(attacks) {

    const map = new Map();

    for (const attack of attacks) {

        const key =
            String(
                attack.origin_village_id ??
                `${attack.origin_x}|${attack.origin_y}`
            );

        if (!map.has(key)) {

            map.set(
                key,
                {
                    id:attack.origin_village_id,
                    x:attack.origin_x,
                    y:attack.origin_y,

                    attacker:
                        displayCharacter(attack),

                    origin:
                        displayOrigin(attack),

                    attacks:[],
                    targets:new Map(),

                    noble:0,
                    trebuchet:0
                }
            );
        }

        const origin =
            map.get(key);

        origin.attacks.push(attack);

        origin.targets.set(
            String(attack.target_village_id),

            attack.target_village_name ||
            `(${attack.target_x}|${attack.target_y})`
        );

        if (
            attack._speed?.name ===
            'NOBLE'
        ) {
            origin.noble++;
        }

        if (
            attack._speed?.name ===
            'TREBUCHET'
        ) {
            origin.trebuchet++;
        }
    }

    return [...map.values()]
        .sort(
            (a,b) =>
                b.attacks.length -
                a.attacks.length
                ||
                Number(
                    a.attacks[0].time_completed
                )
                -
                Number(
                    b.attacks[0].time_completed
                )
        );
}

function fmtDuration(seconds) {

    seconds = Math.max(
        0,
        Math.floor(Number(seconds) || 0)
    );

    const h =
        Math.floor(seconds / 3600);

    const m =
        Math.floor(
            (seconds % 3600) / 60
        );

    const s =
        seconds % 60;

    if (h > 0) {

        return (
            String(h).padStart(2,'0') +
            ':' +
            String(m).padStart(2,'0') +
            ':' +
            String(s).padStart(2,'0')
        );
    }

    return (
        String(m).padStart(2,'0') +
        ':' +
        String(s).padStart(2,'0')
    );
}

function countdown(timestamp) {

    const seconds =
        Math.floor(
            Number(timestamp) -
            Date.now()/1000
        );

    if (seconds <= 0)
        return 'LANDED';

    const h =
        Math.floor(seconds / 3600);

    const m =
        Math.floor(
            (seconds % 3600) / 60
        );

    const s =
        seconds % 60;

    return (
        String(h).padStart(2,'0') +
        ':' +
        String(m).padStart(2,'0') +
        ':' +
        String(s).padStart(2,'0')
    );
}

function arrival(timestamp) {

    return new Date(
        Number(timestamp) * 1000
    ).toLocaleTimeString(
        [],
        {
            hour:'2-digit',
            minute:'2-digit',
            second:'2-digit'
        }
    );
}

function fullArrival(timestamp) {

    return new Date(
        Number(timestamp) * 1000
    ).toLocaleString(
        [],
        {
            day:'2-digit',
            month:'2-digit',
            hour:'2-digit',
            minute:'2-digit',
            second:'2-digit'
        }
    );
}


/* ============================================================
   WORKER HOOK
   ============================================================ */

window.Worker = new Proxy(
    NativeWorker,
    {
        construct(Target,args) {

            const worker =
                Reflect.construct(
                    Target,
                    args
                );

            const url =
                String(
                    args[0] || ''
                );

            if (
                /socket[-_]?worker/i
                    .test(url)
            ) {

                S.worker = worker;
                S.socketFound = true;

                console.log(
                    '[TW2 Intel] Socket worker captured:',
                    url
                );

                worker.addEventListener(
                    'message',
                    event =>
                        receive(
                            event.data
                        )
                );

                const nativePost =
                    worker.postMessage
                        .bind(worker);

                worker.postMessage =
                function(data,...rest) {

                    learnRequest(data);

                    return nativePost(
                        data,
                        ...rest
                    );
                };

                setTimeout(
                    () => {

                        scheduleCollection();
                        render();

                    },
                    1000
                );
            }

            return worker;
        }
    }
);

try {

    Object.setPrototypeOf(
        window.Worker,
        NativeWorker
    );

} catch(e) {}


/* ============================================================
   LEARN TW2 REQUESTS
   ============================================================ */

function learnRequest(msg) {

    if (
        !msg ||
        typeof msg !== 'object'
    ) {
        return;
    }

    const data =
        msg.data;

    if (
        data &&
        typeof data === 'object'
    ) {

        if (data.tokenEmit) {

            const first =
                !S.tokenEmit;

            S.tokenEmit =
                data.tokenEmit;

            if (data.userAgent) {

                S.userAgent =
                    data.userAgent;
            }

            if (first) {

                scheduleCollection();
            }
        }

        if (
            data.village_id !==
            undefined
        ) {

            S.currentVillageId =
                data.village_id;
        }
    }    if (
        msg.type ===
            'Overview/getIncoming'
        &&
        data
    ) {

        S.incomingTemplate =
            clone(data);

        scheduleCollection();
    }


    if (
        msg.type ===
        'ResourceDeposit/open'
    ) {

        S.resourceTemplates[
            'ResourceDeposit/open'
        ] =
            clone(data);

        saveJSON(
            'tw2Intel.resourceTemplates',
            S.resourceTemplates
        );
    }


    if (
        msg.type ===
        'ResourceDeposit/startJob'
    ) {

        S.resourceTemplates[
            'ResourceDeposit/startJob'
        ] =
            clone(data);

        saveJSON(
            'tw2Intel.resourceTemplates',
            S.resourceTemplates
        );

        const jobId =
            findJobId(data);

        if (jobId !== null) {

            const job =
                findDepositJob(
                    jobId
                );

            if (job) {

                saveActiveJob({
                    jobId:
                        Number(jobId),

                    amount:
                        Number(
                            job.amount || 0
                        ),

                    resource:
                        job.resource_type ||
                        '',

                    duration:
                        Number(
                            job.duration || 0
                        ),

                    startedAt:
                        Date.now(),

                    finishAt:
                        Date.now() +
                        Number(
                            job.duration || 0
                        ) * 1000,

                    bootstrap:false
                });

            } else {

                saveActiveJob({
                    jobId:
                        Number(jobId),

                    amount:0,
                    resource:'',
                    duration:0,

                    startedAt:
                        Date.now(),

                    finishAt:0,
                    bootstrap:true
                });
            }
        }

        S.resourceLastAction =
            'Learned Start';
    }


    if (
        msg.type ===
        'ResourceDeposit/collect'
    ) {

        S.resourceTemplates[
            'ResourceDeposit/collect'
        ] =
            clone(data);

        saveJSON(
            'tw2Intel.resourceTemplates',
            S.resourceTemplates
        );

        S.resourceLastAction =
            'Learned Collect';
    }

    render();
}


/* ============================================================
   REQUEST SENDERS
   ============================================================ */

function send(
    type,
    data,
    timeout=15000
) {

    return new Promise(
        (resolve,reject) => {

            if (!S.worker) {

                reject(
                    new Error(
                        'Socket worker unavailable'
                    )
                );

                return;
            }

            const id =
                ++S.nextID;

            const timer =
                setTimeout(
                    () => {

                        S.pending
                            .delete(id);

                        reject(
                            new Error(
                                'Request timed out: ' +
                                type
                            )
                        );

                    },
                    timeout
                );

            S.pending.set(
                id,
                {
                    resolve,
                    reject,
                    timer,
                    type
                }
            );

            try {

                NativeWorker
                    .prototype
                    .postMessage
                    .call(
                        S.worker,
                        {
                            type,
                            data,
                            id
                        }
                    );

            } catch(error) {

                clearTimeout(timer);

                S.pending
                    .delete(id);

                reject(error);
            }
        }
    );
}


function sendRaw(
    type,
    data
) {

    if (!S.worker)
        return false;

    try {

        NativeWorker
            .prototype
            .postMessage
            .call(
                S.worker,
                {
                    type,
                    data,
                    id:
                        ++S.nextID
                }
            );

        return true;

    } catch(error) {

        console.warn(
            '[TW2 Intel] sendRaw failed:',
            type,
            error
        );

        return false;
    }
}


/* ============================================================
   RECEIVE / SCAN
   ============================================================ */

function receive(msg) {

    if (
        !msg ||
        typeof msg !== 'object'
    ) {
        return;
    }

    if (
        msg.id !== undefined
    ) {

        const id =
            Number(msg.id);

        const request =
            S.pending.get(id);

        if (request) {

            clearTimeout(
                request.timer
            );

            S.pending
                .delete(id);

            request.resolve(msg);
        }
    }

    scan(msg,0);
    render();
}


function scan(
    obj,
    depth
) {

    if (
        !obj ||
        depth > 7
    ) {
        return;
    }

    if (
        Array.isArray(obj)
    ) {

        for (
            const item of obj
        ) {
            scan(
                item,
                depth+1
            );
        }

        return;
    }

    if (
        typeof obj !==
        'object'
    ) {
        return;
    }


    if (
        Array.isArray(
            obj.commands
        )
    ) {

        const valid =
            obj.commands.length === 0
            ||
            obj.commands.some(
                c =>
                    c &&
                    c.command_id !==
                    undefined
            );

        if (valid) {

            ingest(
                obj.commands
            );
        }
    }


    if (
        obj.type ===
            'ResourceDeposit/info'
        &&
        obj.data
    ) {

        S.resourceDeposit =
            obj.data;

        S.resourceInfoVersion++;

        S.waitingFreshResource =
            false;

        if (
            S.lastCollectedJobId !==
                null
            &&
            Array.isArray(
                S.resourceDeposit.jobs
            )
        ) {

            S.resourceDeposit.jobs =
                S.resourceDeposit.jobs
                    .filter(
                        job =>
                            Number(job.id) !==
                            Number(
                                S.lastCollectedJobId
                            )
                    );
        }

        if (
            S.resourceAuto &&
            !S.resourceActive
        ) {

            S.resourceLastAction =
                'Fresh jobs received';

            S.nextResourceAction =
                Date.now() + 750;

            setTimeout(
                resourceCycle,
                900
            );
        }
    }


    for (
        const key in obj
    ) {

        if (
            key === 'commands'
        ) {
            continue;
        }

        try {

            if (
                obj[key] &&
                typeof obj[key] ===
                'object'
            ) {

                scan(
                    obj[key],
                    depth+1
                );
            }

        } catch(e) {}
    }
}


/* ============================================================
   INCOMING COLLECTION
   ============================================================ */

function scheduleCollection() {

    if (S.scheduled)
        return;

    if (
        !S.worker ||
        !S.tokenEmit
    ) {
        return;
    }

    S.scheduled = true;

    setTimeout(
        () => {

            S.scheduled = false;

            collectIncoming();

        },
        5000
    );
}


async function collectIncoming() {

    if (S.collecting)
        return;

    if (!S.worker) {

        S.lastError =
            'Waiting for socket worker';

        render();
        return;
    }

    if (!S.tokenEmit) {

        S.lastError =
            'Waiting for TW2 session';

        render();
        return;
    }

    S.collecting = true;
    S.lastError = null;

    render();

    try {

        const fresh =
            new Map();

        let offset = 0;
        let total = Infinity;

        while (
            offset < total
        ) {

            const data = {

                ...(
                    S.incomingTemplate ||
                    {}
                ),

                count:
                    CFG.PAGE_SIZE,

                offset,

                sorting:
                    'target_village_name',

                reverse:0,

                groups:[],

                command_types:[
                    'attack',
                    'support',
                    'relocate'
                ],

                villages:[],

                tokenEmit:
                    S.tokenEmit,

                userAgent:
                    S.userAgent ||
                    'browser'
            };


            const response =
                await send(
                    'Overview/getIncoming',
                    data
                );


            if (
                response &&
                response.error
            ) {

                throw new Error(
                    typeof response.error ===
                    'string'
                        ?
                        response.error
                        :
                        JSON.stringify(
                            response.error
                        )
                );
            }


            const result =
                response &&
                response.data;


            if (
                !result ||
                !Array.isArray(
                    result.commands
                )
            ) {

                throw new Error(
                    'Server did not return incoming commands'
                );
            }


            const serverTotal =
                Number(
                    result.total
                );


            total =
                Number.isFinite(
                    serverTotal
                )
                    ?
                    serverTotal
                    :
                    offset +
                    result.commands.length;


            for (
                const command
                of result.commands
            ) {

                if (
                    command &&
                    command.command_id !==
                    undefined
                ) {

                    fresh.set(
                        command.command_id,
                        command
                    );
                }
            }


            if (
                !result.commands.length
            ) {
                break;
            }


            offset +=
                result.commands.length;


            if (
                offset > 10000
            ) {
                break;
            }
        }


        S.incoming =
            fresh;

        S.lastCollection =
            Date.now();

        analyse();


    } catch(error) {

        S.lastError =
            error.message ||
            String(error);

        console.error(
            '[TW2 Intel]',
            error
        );

    } finally {

        S.collecting = false;

        render();
    }
}


function ingest(commands) {

    let changed =
        false;

    for (
        const command
        of commands
    ) {

        if (
            !command ||
            command.command_id ===
            undefined
        ) {
            continue;
        }

        S.incoming.set(
            command.command_id,
            command
        );

        changed = true;
    }

    if (changed) {

        analyse();
    }
}


/* ============================================================
   ATTACK INTELLIGENCE
   ============================================================ */

function getDistance(c) {

    return Math.hypot(

        Number(
            c.target_x
        ) -
        Number(
            c.origin_x
        ),

        Number(
            c.target_y
        ) -
        Number(
            c.origin_y
        )
    );
}


function getPace(c) {

    const distance =
        getDistance(c);

    if (!distance)
        return null;

    const seconds =
        Number(
            c.time_completed
        ) -
        Number(
            c.time_start
        );

    if (
        !Number.isFinite(
            seconds
        )
    ) {
        return null;
    }

    return (
        seconds /
        60 /
        distance
    );
}


function classify(pace) {

    if (
        !Number.isFinite(
            pace
        )
    ) {
        return null;
    }

    let best =
        null;

    for (
        const speed
        of SPEEDS
    ) {

        const difference =
            Math.abs(
                pace -
                speed.speed
            );

        if (
            !best ||
            difference <
            best.difference
        ) {

            best = {
                name:
                    speed.name,

                nominal:
                    speed.speed,

                difference
            };
        }
    }

    return best;
}


function getAttacks() {

    return [
        ...S.incoming.values()
    ]

    .filter(
        c =>
            c &&
            c.command_type ===
                'attack'
            &&
            Number(
                c.time_completed
            ) >
            Date.now()/1000
    )

    .map(
        c => {

            const pace =
                getPace(c);

            return {
                ...c,

                _distance:
                    getDistance(c),

                _pace:
                    pace,

                _speed:
                    classify(pace)
            };
        }
    )

    .sort(
        (a,b) =>
            Number(
                a.time_completed
            ) -
            Number(
                b.time_completed
            )
    );
}


/* ============================================================
   TRAIN ANALYSIS
   ============================================================ */

function buildTrains(attacks) {

    const groups =
        new Map();

    for (
        const command
        of attacks
    ) {

        if (
            !command._speed
        ) {
            continue;
        }

        const key = [
            command.origin_character_id,
            command.origin_village_id,
            command.target_village_id,
            command._speed.name
        ].join('|');

        if (
            !groups.has(key)
        ) {

            groups.set(
                key,
                []
            );
        }

        groups
            .get(key)
            .push(command);
    }


    const trains = [];


    for (
        const commands
        of groups.values()
    ) {

        commands.sort(
            (a,b) =>
                Number(
                    a.time_completed
                )
                -
                Number(
                    b.time_completed
                )
        );

        let current = [];


        function finish() {

            if (
                current.length >= 2
            ) {

                const gaps = [];

                for (
                    let i=1;
                    i<current.length;
                    i++
                ) {

                    gaps.push(
                        Number(
                            current[i]
                                .time_completed
                        )
                        -
                        Number(
                            current[i-1]
                                .time_completed
                        )
                    );
                }

                trains.push({
                    commands:
                        [...current],

                    gaps,

                    maxGap:
                        Math.max(
                            ...gaps
                        ),

                    spread:
                        Number(
                            current[
                                current.length-1
                            ].time_completed
                        )
                        -
                        Number(
                            current[0]
                                .time_completed
                        )
                });
            }

            current = [];
        }


        for (
            const command
            of commands
        ) {

            if (
                !current.length
            ) {

                current.push(
                    command
                );

                continue;
            }

            const previous =
                current[
                    current.length-1
                ];

            const gap =
                Number(
                    command.time_completed
                )
                -
                Number(
                    previous.time_completed
                );

            const paceDifference =
                Math.abs(
                    command._pace -
                    previous._pace
                );

            if (
                gap >= 0 &&
                gap <=
                    CFG.TRAIN_MAX_GAP
                &&
                paceDifference <=
                    CFG.PACE_TOLERANCE
            ) {

                current.push(
                    command
                );

            } else {

                finish();

                current.push(
                    command
                );
            }
        }

        finish();
    }


    return trains.sort(
        (a,b) =>
            Number(
                a.commands[0]
                    .time_completed
            )
            -
            Number(
                b.commands[0]
                    .time_completed
            )
    );
}


function analyse() {

    const attacks =
        getAttacks();

    S.trains =
        buildTrains(
            attacks
        )
        .filter(
            train => {

                const speed =
                    train.commands[0]
                        ._speed;

                return (
                    speed &&
                    (
                        speed.name ===
                            'NOBLE'
                        ||
                        speed.name ===
                            'TREBUCHET'
                    )
                );
            }
        );

    render();
}


function rating(train) {

    const n =
        train.commands.length;

    const gap =
        train.maxGap;

    if (
        n >= 4 &&
        gap <= 1
    ) {
        return '🚨 EXTREMELY TIGHT';
    }

    if (
        n >= 4 &&
        gap <= 2
    ) {
        return '🔥 VERY STRONG';
    }

    if (
        n >= 3 &&
        gap <= 3
    ) {
        return '🔴 STRONG';
    }    return '🟠 LIKELY';
}


function snipeWindowsHTML(train) {

    const commands =
        train?.commands || [];

    const windows = [];

    for (let i=1; i<commands.length; i++) {

        const before =
            Number(commands[i-1].time_completed);

        const after =
            Number(commands[i].time_completed);

        const gap = after - before;

        if (gap < 1)
            continue;

        windows.push({
            before,
            after,
            gap,
            suggested:
                gap >= 2
                    ? before + Math.floor(gap / 2)
                    : null
        });
    }

    if (!windows.length)
        return '';

    let html = `
        <div style="
            margin-top:7px;
            padding:7px;
            background:#1d262c;
            border:1px solid #46606d;
            border-radius:4px;
        ">
            <b>🎯 SNIPE WINDOWS</b><br>
    `;

    for (const w of windows) {

        if (w.gap === 1) {
            html += `
                ${arrival(w.before)} → ${arrival(w.after)}
                : <b style="color:#ffcf66">1s — VERY TIGHT</b>
                <span style="opacity:.65">(sub-second order unknown)</span><br>
            `;
        } else {
            html += `
                ${arrival(w.before)} → ${arrival(w.after)}
                : <b>${w.gap}s</b>
                • aim around <b style="color:#67e480">${arrival(w.suggested)}</b><br>
            `;
        }
    }

    html += `</div>`;
    return html;
}


function speedLabel(speed) {

    if (!speed)
        return 'UNKNOWN';

    switch(
        speed.name
    ) {

        case 'NOBLE':
            return '👑 NOBLE SPEED';

        case 'TREBUCHET':
            return '🚨 TREBUCHET — NOBLE POSSIBLE';

        case 'RAM / CATAPULT':
            return '💥 RAM / CATAPULT';

        case 'SWORD':
            return '🛡 SWORD';

        case 'INFANTRY':
            return '⚔ INFANTRY';

        case 'CAV / KNIGHT':
            return '🐎 CAV / KNIGHT';

        default:
            return speed.name;
    }
}


function speedColour(speed) {

    if (!speed)
        return '#ddd';

    if (
        speed.name ===
        'NOBLE'
    ) {
        return '#ff5555';
    }

    if (
        speed.name ===
        'TREBUCHET'
    ) {
        return '#ff963f';
    }

    if (
        speed.name ===
        'RAM / CATAPULT'
    ) {
        return '#ffd166';
    }

    return '#ddd';
}


/* ============================================================
   TARGET SUMMARY
   ============================================================ */

function buildTargets(attacks) {

    const map =
        new Map();

    for (
        const attack
        of attacks
    ) {

        const key =
            String(
                attack.target_village_id
            );

        if (
            !map.has(key)
        ) {

            map.set(
                key,
                {
                    id:
                        attack.target_village_id,

                    name:
                        attack.target_village_name,

                    x:
                        attack.target_x,

                    y:
                        attack.target_y,

                    attacks:[],

                    noble:0,
                    trebuchet:0,
                    ram:0
                }
            );
        }

        const target =
            map.get(key);

        target.attacks
            .push(attack);

        if (
            attack._speed?.name ===
            'NOBLE'
        ) {
            target.noble++;
        }

        if (
            attack._speed?.name ===
            'TREBUCHET'
        ) {
            target.trebuchet++;
        }

        if (
            attack._speed?.name ===
            'RAM / CATAPULT'
        ) {
            target.ram++;
        }
    }


    return [
        ...map.values()
    ]
    .sort(
        (a,b) => {

            const scoreA =
                a.attacks.length +
                a.noble * 20 +
                a.trebuchet * 10 +
                a.ram * 3;

            const scoreB =
                b.attacks.length +
                b.noble * 20 +
                b.trebuchet * 10 +
                b.ram * 3;

            return (
                scoreB -
                scoreA
            );
        }
    );
}


/* ============================================================
   ATTACKER SUMMARY
   ============================================================ */

function buildAttackers(attacks) {

    const map =
        new Map();

    for (
        const attack
        of attacks
    ) {

        const key =
            String(
                attack.origin_character_id
            );

        if (
            !map.has(key)
        ) {

            map.set(
                key,
                {
                    id:
                        attack.origin_character_id,

                    name:
                        displayCharacter(
                            attack
                        ),

                    attacks:[],

                    origins:
                        new Set(),

                    targets:
                        new Set(),

                    noble:0,
                    trebuchet:0,
                    ram:0
                }
            );
        }

        const attacker =
            map.get(key);

        attacker.attacks
            .push(attack);

        attacker.origins
            .add(
                attack.origin_village_id
            );

        attacker.targets
            .add(
                attack.target_village_id
            );

        if (
            attack._speed?.name ===
            'NOBLE'
        ) {
            attacker.noble++;
        }

        if (
            attack._speed?.name ===
            'TREBUCHET'
        ) {
            attacker.trebuchet++;
        }

        if (
            attack._speed?.name ===
            'RAM / CATAPULT'
        ) {
            attacker.ram++;
        }
    }


    return [
        ...map.values()
    ]
    .sort(
        (a,b) =>
            b.attacks.length -
            a.attacks.length
    );
}


/* ============================================================
   RESOURCE HELPERS
   ============================================================ */

function findJobId(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    if (
        Array.isArray(value)
    ) {

        for (
            const item
            of value
        ) {

            const result =
                findJobId(item);

            if (
                result !== null
            ) {
                return result;
            }
        }

        return null;
    }

    if (
        typeof value !==
        'object'
    ) {
        return null;
    }

    if (
        value.job_id !==
        undefined
    ) {
        return Number(
            value.job_id
        );
    }

    if (
        value.jobId !==
        undefined
    ) {
        return Number(
            value.jobId
        );
    }

    for (
        const child
        of Object.values(value)
    ) {

        if (
            child &&
            typeof child ===
            'object'
        ) {

            const result =
                findJobId(
                    child
                );

            if (
                result !== null
            ) {
                return result;
            }
        }
    }

    return null;
}


function patchJobId(
    value,
    jobId
) {

    if (
        Array.isArray(value)
    ) {

        return value.map(
            item =>
                patchJobId(
                    item,
                    jobId
                )
        );
    }

    if (
        !value ||
        typeof value !==
        'object'
    ) {
        return value;
    }

    const result = {
        ...value
    };

    for (
        const key
        of Object.keys(result)
    ) {

        if (
            key === 'job_id' ||
            key === 'jobId'
        ) {

            result[key] =
                Number(jobId);

        } else if (
            result[key] &&
            typeof result[key] ===
            'object'
        ) {

            result[key] =
                patchJobId(
                    result[key],
                    jobId
                );
        }
    }

    return result;
}


function patchSession(value) {

    if (
        Array.isArray(value)
    ) {
        return value.map(
            patchSession
        );
    }

    if (
        !value ||
        typeof value !==
        'object'
    ) {
        return value;
    }

    const result = {
        ...value
    };

    if (
        'tokenEmit' in result
    ) {
        result.tokenEmit =
            S.tokenEmit;
    }

    if (
        'userAgent' in result
    ) {
        result.userAgent =
            S.userAgent ||
            'browser';
    }

    if (
        'village_id' in result &&
        S.currentVillageId !== null
    ) {

        result.village_id =
            S.currentVillageId;
    }

    for (
        const key
        of Object.keys(result)
    ) {

        if (
            result[key] &&
            typeof result[key] ===
            'object'
        ) {

            result[key] =
                patchSession(
                    result[key]
                );
        }
    }

    return result;
}


/* ============================================================
   RESOURCE JOB LOOKUP
   ============================================================ */

function findDepositJob(jobId) {

    if (
        !S.resourceDeposit ||
        !Array.isArray(
            S.resourceDeposit.jobs
        )
    ) {
        return null;
    }

    return (
        S.resourceDeposit.jobs.find(
            job =>
                Number(job.id) ===
                Number(jobId)
        )
        ||
        null
    );
}


function rankedDepositJobs() {

    if (
        !S.resourceDeposit ||
        !Array.isArray(
            S.resourceDeposit.jobs
        )
    ) {
        return [];
    }

    return S.resourceDeposit.jobs

        .filter(
            job =>
                job &&
                Number(job.id) &&
                Number(job.duration) > 0
                &&
                (
                    S.lastCollectedJobId === null
                    ||
                    Number(job.id) !==
                    Number(
                        S.lastCollectedJobId
                    )
                )
        )

        .map(
            job => ({
                ...job,

                _rate:
                    Number(job.amount) /
                    Number(job.duration)
            })
        )

        .sort(
            (a,b) =>
                b._rate -
                a._rate
                ||
                Number(a.duration) -
                Number(b.duration)
        );
}


function bestDepositJob() {

    return (
        rankedDepositJobs()[0]
        ||
        null
    );
}


/* ============================================================
   RESOURCE ACTION
   ============================================================ */

async function resourceAction(
    action,
    jobId
) {

    const type =
        'ResourceDeposit/' +
        action;

    const template =
        S.resourceTemplates[
            type
        ];

    if (
        template ===
        undefined
    ) {

        throw new Error(
            action +
            ' request not learned'
        );
    }

    let data =
        clone(template);

    if (
        jobId !== undefined &&
        jobId !== null
    ) {

        data =
            patchJobId(
                data,
                jobId
            );
    }

    data =
        patchSession(
            data
        );

    const response =
        await send(
            type,
            data,
            10000
        );

    if (
        response &&
        response.error
    ) {

        throw new Error(
            typeof response.error ===
            'string'
                ?
                response.error
                :
                JSON.stringify(
                    response.error
                )
        );
    }

    return response;
}


/* ============================================================
   RESOURCE ACTIVE JOB
   ============================================================ */

function saveActiveJob(job) {

    if (!job) {

        S.resourceActive =
            null;

        localStorage.removeItem(
            'tw2Intel.resourceActive'
        );

        return;
    }

    S.resourceActive =
        job;

    saveJSON(
        'tw2Intel.resourceActive',
        job
    );
}


/* ============================================================
   FRESH RESOURCE INFO
   ============================================================ */

function requestFreshResourceInfo() {

    if (
        !S.worker ||
        !S.tokenEmit
    ) {
        return false;
    }

    let openData =
        clone(
            S.resourceTemplates[
                'ResourceDeposit/open'
            ]
            ??
            {}
        );

    openData =
        patchSession(
            openData
        );

    S.waitingFreshResource =
        true;

    const sent =
        sendRaw(
            'ResourceDeposit/open',
            openData
        );

    if (sent) {

        S.resourceLastAction =
            'Refreshing Resource Deposit...';
    }

    return sent;
}


/* ============================================================
   START BEST RESOURCE JOB
   ============================================================ */

async function startBestResourceJob() {

    if (
        S.waitingFreshResource
    ) {
        return false;
    }

    const jobs =
        rankedDepositJobs();

    if (!jobs.length) {

        throw new Error(
            'No available Resource Deposit jobs'
        );
    }

    let lastError =
        null;

    for (
        const job
        of jobs
    ) {

        if (
            S.lastCollectedJobId !==
                null
            &&
            Number(job.id) ===
            Number(
                S.lastCollectedJobId
            )
        ) {
            continue;
        }

        try {

            await resourceAction(
                'startJob',
                job.id
            );

            const active = {

                jobId:
                    Number(job.id),

                amount:
                    Number(
                        job.amount || 0
                    ),

                resource:                    job.resource_type ||
                    '',

                duration:
                    Number(
                        job.duration || 0
                    ),

                startedAt:
                    Date.now(),

                finishAt:
                    Date.now() +
                    Number(
                        job.duration || 0
                    ) *
                    1000,

                bootstrap:false
            };

            saveActiveJob(
                active
            );

            S.lastCollectedJobId =
                null;

            S.resourceLastAction =
                'Started ' +
                active.amount +
                ' ' +
                active.resource;

            S.resourceLastError =
                null;

            S.nextResourceAction =
                Date.now() +
                CFG.ACTION_COOLDOWN;

            return true;

        } catch(error) {

            lastError =
                error;

            console.warn(
                '[TW2 Intel] Start job rejected:',
                job.id,
                error
            );
        }
    }

    throw (
        lastError
        ||
        new Error(
            'No job could be started'
        )
    );
}


/* ============================================================
   COLLECT RESOURCE JOB
   ============================================================ */

async function collectResourceJob(
    active
) {

    const collectedJobId =
        Number(
            active.jobId
        );

    await resourceAction(
        'collect',
        collectedJobId
    );

    S.resourceLastAction =
        'Collected job #' +
        collectedJobId +
        ' — refreshing jobs...';

    S.resourceLastError =
        null;

    S.lastCollectedJobId =
        collectedJobId;

    saveActiveJob(
        null
    );


    if (
        S.resourceDeposit &&
        Array.isArray(
            S.resourceDeposit.jobs
        )
    ) {

        S.resourceDeposit.jobs =
            S.resourceDeposit.jobs
                .filter(
                    job =>
                        Number(job.id) !==
                        collectedJobId
                );
    }


    /*
       IMPORTANT:
       destroy old cached list so it can never
       start the collected job again.
    */

    S.resourceDeposit =
        null;

    S.waitingFreshResource =
        true;

    S.nextResourceAction =
        Date.now() +
        CFG.RESOURCE_REFRESH_WAIT;


    setTimeout(
        () => {

            requestFreshResourceInfo();

        },
        750
    );

    render();

    return true;
}


/* ============================================================
   BOOTSTRAP EXISTING RESOURCE JOB
   ============================================================ */

function bootstrapExistingJob() {

    if (
        S.resourceActive
    ) {
        return;
    }

    const template =
        S.resourceTemplates[
            'ResourceDeposit/startJob'
        ];

    if (
        template ===
        undefined
    ) {
        return;
    }

    const jobId =
        findJobId(
            template
        );

    if (
        jobId === null
    ) {
        return;
    }

    if (
        S.lastCollectedJobId !==
            null
        &&
        Number(jobId) ===
        Number(
            S.lastCollectedJobId
        )
    ) {
        return;
    }

    const job =
        findDepositJob(
            jobId
        );

    saveActiveJob({

        jobId:
            Number(jobId),

        amount:
            Number(
                job?.amount || 0
            ),

        resource:
            job?.resource_type ||
            '',

        duration:
            Number(
                job?.duration || 0
            ),

        startedAt:0,
        finishAt:0,
        bootstrap:true
    });

    S.resourceLastAction =
        'Watching existing job #' +
        jobId;
}


/* ============================================================
   RESOURCE AUTO LOOP
   ============================================================ */

async function resourceCycle() {

    if (
        !S.resourceAuto
    ) {
        return;
    }

    if (
        S.resourceBusy
    ) {
        return;
    }

    if (
        Date.now() <
        S.nextResourceAction
    ) {
        return;
    }

    if (
        !S.worker ||
        !S.tokenEmit
    ) {
        return;
    }


    const startLearned =
        S.resourceTemplates[
            'ResourceDeposit/startJob'
        ] !== undefined;

    const collectLearned =
        S.resourceTemplates[
            'ResourceDeposit/collect'
        ] !== undefined;


    if (
        !startLearned ||
        !collectLearned
    ) {
        return;
    }


    S.resourceBusy =
        true;


    try {

        if (
            S.waitingFreshResource
        ) {

            S.resourceLastAction =
                'Waiting for fresh job list';

            return;
        }


        bootstrapExistingJob();


        const active =
            S.resourceActive;


        if (active) {

            if (
                active.finishAt &&
                Date.now() <
                active.finishAt +
                1000
            ) {

                const seconds =
                    Math.max(
                        0,
                        Math.ceil(
                            (
                                active.finishAt -
                                Date.now()
                            ) /
                            1000
                        )
                    );

                S.resourceLastAction =
                    'Running ' +
                    (
                        active.amount
                            ?
                            active.amount +
                            ' '
                            :
                            ''
                    )
                    +
                    (
                        active.resource ||
                        'job'
                    )
                    +
                    ' • ' +
                    fmtDuration(
                        seconds
                    );

                return;
            }


            try {

                await collectResourceJob(
                    active
                );

                return;

            } catch(error) {

                if (
                    active.bootstrap
                ) {

                    S.resourceLastAction =
                        'Existing job still running';

                    S.resourceLastError =
                        null;

                    S.nextResourceAction =
                        Date.now() +
                        10000;

                    return;
                }

                throw error;
            }
        }


        if (
            !S.resourceDeposit
        ) {

            S.resourceLastAction =
                'Waiting for fresh Resource Deposit data';

            if (
                !S.waitingFreshResource
            ) {

                requestFreshResourceInfo();
            }

            return;
        }


        const best =
            bestDepositJob();

        if (!best) {

            S.resourceLastAction =
                'No available jobs';

            return;
        }


        await startBestResourceJob();


    } catch(error) {

        S.resourceLastError =
            error.message ||
            String(error);

        console.warn(
            '[TW2 Intel Resource Auto]',
            error
        );

        S.resourceDeposit =
            null;

        S.waitingFreshResource =
            true;

        S.nextResourceAction =
            Date.now() +
            5000;

        setTimeout(
            () => {

                requestFreshResourceInfo();

            },
            1500
        );

    } finally {

        S.resourceBusy =
            false;

        render();
    }
}


function toggleResourceAuto() {

    S.resourceAuto =
        !S.resourceAuto;

    localStorage.setItem(
        'tw2Intel.resourceAuto',
        S.resourceAuto
            ?
            '1'
            :
            '0'
    );

    S.resourceLastAction =
        S.resourceAuto
            ?
            'Auto Jobs enabled'
            :
            'Auto Jobs disabled';

    render();

    if (
        S.resourceAuto
    ) {

        setTimeout(
            resourceCycle,
            500
        );
    }
}


/* ============================================================
   MAIN DASHBOARD
   ============================================================ *//* ============================================================
   PANEL UI STATE
   ============================================================ */

const PANEL_UI = {
    intelClosed:false,
    attacksClosed:false,

    intelPosition:
        loadJSON(
            'tw2Intel.intelPanelPosition',
            null
        ),

    attacksPosition:
        loadJSON(
            'tw2Intel.attackPanelPosition',
            null
        )
};


/* ============================================================
   PANEL DRAGGING
   ============================================================ */

function installPanelDragging(
    panel,
    positionName,
    storageKey
) {

    if (
        !panel ||
        panel.dataset.tw2DragInstalled === '1'
    ) {
        return;
    }

    panel.dataset.tw2DragInstalled = '1';

    let dragging = false;
    let pointerId = null;
    let offsetX = 0;
    let offsetY = 0;


    panel.addEventListener(
        'pointerdown',
        event => {

            const handle =
                event.target.closest(
                    '[data-tw2-drag-handle]'
                );

            if (
                !handle ||
                event.target.closest('button')
            ) {
                return;
            }

            const rect =
                panel.getBoundingClientRect();

            panel.style.left =
                rect.left + 'px';

            panel.style.top =
                rect.top + 'px';

            panel.style.right =
                'auto';

            dragging = true;
            pointerId = event.pointerId;

            offsetX =
                event.clientX -
                rect.left;

            offsetY =
                event.clientY -
                rect.top;

            try {
                panel.setPointerCapture(
                    pointerId
                );
            } catch(e) {}

            event.preventDefault();
            event.stopPropagation();
        },
        true
    );


    panel.addEventListener(
        'pointermove',
        event => {

            if (
                !dragging ||
                event.pointerId !== pointerId
            ) {
                return;
            }

            const rect =
                panel.getBoundingClientRect();

            let left =
                event.clientX -
                offsetX;

            let top =
                event.clientY -
                offsetY;

            left =
                Math.max(
                    0,
                    Math.min(
                        left,
                        window.innerWidth -
                        Math.min(
                            rect.width,
                            80
                        )
                    )
                );

            top =
                Math.max(
                    0,
                    Math.min(
                        top,
                        window.innerHeight -
                        40
                    )
                );

            panel.style.left =
                left + 'px';

            panel.style.top =
                top + 'px';

            panel.style.right =
                'auto';

            event.preventDefault();
            event.stopPropagation();
        },
        true
    );


    function stopDragging(event) {

        if (!dragging)
            return;

        if (
            event &&
            event.pointerId !== pointerId
        ) {
            return;
        }

        dragging = false;

        try {
            panel.releasePointerCapture(
                pointerId
            );
        } catch(e) {}

        pointerId = null;

        const rect =
            panel.getBoundingClientRect();

        const position = {
            left:
                Math.round(rect.left),

            top:
                Math.round(rect.top)
        };

        PANEL_UI[positionName] =
            position;

        saveJSON(
            storageKey,
            position
        );

        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
    }


    panel.addEventListener(
        'pointerup',
        stopDragging,
        true
    );

    panel.addEventListener(
        'pointercancel',
        stopDragging,
        true
    );
}


function applyPanelPosition(
    panel,
    position
) {

    if (
        !panel ||
        !position
    ) {
        return;
    }

    panel.style.left =
        Math.max(
            0,
            Number(position.left) || 0
        ) + 'px';

    panel.style.top =
        Math.max(
            0,
            Number(position.top) || 0
        ) + 'px';

    panel.style.right =
        'auto';
}


/* ============================================================
   PERMANENT REOPEN BUTTONS
   ============================================================ */

function getPanelLauncher() {

    let launcher =
        document.getElementById(
            'tw2-panel-launcher'
        );

    if (launcher)
        return launcher;

    launcher =
        document.createElement(
            'div'
        );

    launcher.id =
        'tw2-panel-launcher';

    launcher.setAttribute(
        'role',
        'dialog'
    );

    Object.assign(
        launcher.style,
        {
            position:'fixed',
            right:'12px',
            bottom:'12px',
            zIndex:'2147483647',
            display:'flex',
            gap:'5px',
            padding:'5px',

            background:
                'rgba(18,18,18,.95)',

            border:
                '1px solid #777',

            borderRadius:'7px',

            boxShadow:
                '0 3px 14px rgba(0,0,0,.6)',

            font:
                '12px Arial,sans-serif'
        }
    );

    launcher.innerHTML = `
        <button
            id="tw2-launch-intel"
            type="button"
            style="
                padding:7px 9px;
                border:1px solid #667;
                border-radius:5px;
                background:#26343b;
                color:white;
                font-weight:bold;
                cursor:pointer;
            "
        >
            ⚔ Intel
        </button>

        <button
            id="tw2-launch-attacks"
            type="button"
            style="
                padding:7px 9px;
                border:1px solid #855;
                border-radius:5px;
                background:#482828;
                color:white;
                font-weight:bold;
                cursor:pointer;
            "
        >
            🚨 Attacks
        </button>
    `;


    launcher.addEventListener(
        'pointerdown',
        event => {

            event.stopPropagation();

        },
        true
    );


    launcher.addEventListener(
        'click',
        event => {

            if (
                event.target.closest(
                    '#tw2-launch-intel'
                )
            ) {

                PANEL_UI.intelClosed =
                    !PANEL_UI.intelClosed;

                render();
            }


            if (
                event.target.closest(
                    '#tw2-launch-attacks'
                )
            ) {

                PANEL_UI.attacksClosed =
                    !PANEL_UI.attacksClosed;

                render();
            }

            event.stopPropagation();
        },
        true
    );


    document.documentElement
        .appendChild(
            launcher
        );

    return launcher;
}


/* ============================================================
   MAIN DASHBOARD
   ============================================================ */

function getPanel() {

    let panel =
        document.getElementById(
            'tw2-intel-dashboard'
        );

    if (panel) {

        panel.style.display =
            PANEL_UI.intelClosed
                ?
                'none'
                :
                'block';

        return panel;
    }


    if (
        !document.documentElement
    ) {
        return null;
    }


    panel =
        document.createElement(
            'div'
        );

    panel.id =
        'tw2-intel-dashboard';


    /*
       Important for Android WebView:
       identifies this as UI rather than the
       underlying TW2 map surface.
    */

    panel.setAttribute(
        'role',
        'dialog'
    );


    Object.assign(
        panel.style,
        {
            position:'fixed',
            top:'70px',
            right:'15px',
            width:'350px',
            maxHeight:'82vh',
            overflowY:'auto',
            zIndex:'2147483647',

            background:
                'rgba(18,18,18,.97)',

            color:'#eee',

            border:
                '1px solid #777',

            borderRadius:'8px',

            padding:'12px',

            font:
                '12px Arial,sans-serif',

            boxShadow:
                '0 5px 25px rgba(0,0,0,.65)'
        }
    );


    applyPanelPosition(
        panel,
        PANEL_UI.intelPosition
    );


    installPanelDragging(
        panel,
        'intelPosition',
        'tw2Intel.intelPanelPosition'
    );


    document.documentElement
        .appendChild(
            panel
        );


    panel.style.display =
        PANEL_UI.intelClosed
            ?
            'none'
            :
            'block';


    return panel;
}


/* ============================================================
   ATTACK CENTRE PANEL
   ============================================================ */

function getAttackPanel() {

    let panel =
        document.getElementById(
            'tw2-attack-centre'
        );

    if (panel) {

        panel.style.display =
            PANEL_UI.attacksClosed
                ?
                'none'
                :
                'block';

        return panel;
    }


    if (
        !document.documentElement
    ) {
        return null;
    }


    panel =
        document.createElement(
            'div'
        );

    panel.id =
        'tw2-attack-centre';


    panel.setAttribute(
        'role',
        'dialog'
    );


    Object.assign(
        panel.style,
        {
            position:'fixed',
            top:'70px',
            right:'390px',
            width:'560px',
            maxHeight:'82vh',
            overflowY:'auto',
            zIndex:'2147483646',

            background:
                'rgba(15,15,15,.97)',

            color:'#eee',

            border:
                '1px solid #777',

            borderRadius:'8px',

            padding:'11px',

            font:
                '12px Arial,sans-serif',

            boxShadow:
                '0 5px 25px rgba(0,0,0,.65)'
        }
    );


    applyPanelPosition(
        panel,
        PANEL_UI.attacksPosition
    );


    installPanelDragging(
        panel,
        'attacksPosition',
        'tw2Intel.attackPanelPosition'
    );


    document.documentElement
        .appendChild(
            panel
        );


    panel.style.display =
        PANEL_UI.attacksClosed
            ?
            'none'
            :
            'block';


    return panel;
}


/* ============================================================
   MAIN PANEL RENDER
   ============================================================ */

function render() {

    if (
        !document.documentElement
    ) {
        return;
    }

    getPanelLauncher();

    renderMainPanel();
    renderAttackCentre();
}


function renderMainPanel() {

    const panel =
        getPanel();

    if (
        !panel ||
        PANEL_UI.intelClosed
    ) {
        return;
    }


    const attacks =
        getAttacks();

    const startLearned =
        S.resourceTemplates[
            'ResourceDeposit/startJob'
        ] !== undefined;

    const collectLearned =
        S.resourceTemplates[
            'ResourceDeposit/collect'
        ] !== undefined;


    let html = `

    <div
        data-tw2-drag-handle
        style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            cursor:move;
            touch-action:none;
            user-select:none;
            padding-bottom:4px;
        "
    >

        <b style="font-size:16px">
            ⚔ TW2 INTELLIGENCE
        </b>

        <div style="
            display:flex;
            align-items:center;
            gap:7px;
        ">

            <span style="
                opacity:.55;
                font-size:10px;
            ">
                v${S.version}
            </span>

            <button
                id="tw2-close-intel"
                type="button"
                title="Close"
                style="
                    width:28px;
                    height:28px;
                    padding:0;
                    border:1px solid #777;
                    border-radius:5px;
                    background:#3b2323;
                    color:#fff;
                    font-size:18px;
                    font-weight:bold;
                    line-height:24px;
                    cursor:pointer;
                "
            >
                ×
            </button>

        </div>

    </div>


    <div style="
        margin-top:8px;
        background:#292929;
        padding:8px;
        border-radius:5px;
        line-height:1.65;
    ">

        Socket worker:
        <b style="
            color:${
                S.socketFound
                    ?
                    '#67e480'
                    :
                    '#ff6969'
            }
        ">
            ${
                S.socketFound
                    ?
                    'CONNECTED'
                    :
                    'WAITING'
            }
        </b>

        <br>

        Session:
        <b style="
            color:${
                S.tokenEmit
                    ?
                    '#67e480'
                    :
                    '#ffcf66'
            }
        ">
            ${
                S.tokenEmit
                    ?
                    'READY'
                    :
                    'WAITING'
            }
        </b>

        <br>

        Collector:
        <b>
            ${
                S.collecting
                    ?
                    'SCANNING...'
                    :
                    'READY'
            }
        </b>

        <br>

        Commands:
        <b>
            ${S.incoming.size}
        </b>

        <br>

        Attacks:
        <b>
            ${attacks.length}
        </b>

        <br>

        Potential Noble trains:
        <b>
            ${S.trains.length}
        </b>

    </div>


    <button
        id="tw2-refresh"
        style="
            margin-top:8px;
            padding:6px 10px;
            cursor:pointer;
        "
    >
        ↻ Refresh Incoming
    </button>
    `;    if (
        S.lastError
    ) {

        html += `

        <div style="
            margin-top:7px;
            background:#572929;
            padding:7px;
            border-radius:4px;
        ">
            ${esc(
                S.lastError
            )}
        </div>
        `;
    }


    html += `

    <div style="
        margin-top:13px;
        font-size:14px;
        font-weight:bold;
    ">
        🚨 POTENTIAL NOBLE TRAINS
    </div>
    `;


    if (
        !S.trains.length
    ) {

        html += `

        <div style="
            margin-top:6px;
            opacity:.7;
        ">
            None detected.
        </div>
        `;
    }


    for (
        const train
        of S.trains.slice(
            0,
            20
        )
    ) {

        const first =
            train.commands[0];

        html += `

        <div style="
            margin-top:8px;
            background:#242424;
            border:1px solid #555;
            border-radius:5px;
            padding:7px;
        ">

            <b>
                ${rating(train)}
            </b>

            <br>

            ${esc(
                displayCharacter(
                    first
                )
            )}

            →

            <b>
                ${esc(
                    first.target_village_name ||
                    '?'
                )}
            </b>

            <br>

            ${speedLabel(
                first._speed
            )}

            <br>

            ${
                train.commands.length
            } attacks

            • max gap
            ${train.maxGap}s

        </div>
        `;
    }


    html += `

    <div style="
        margin-top:14px;
        padding-top:10px;
        border-top:1px solid #555;
    ">

        <b style="font-size:14px">
            ⛏ RESOURCE DEPOSIT AUTO
        </b>

        <br>

        <button
            id="tw2-resource-toggle"
            style="
                margin-top:7px;
                padding:6px 10px;
                cursor:pointer;
            "
        >
            Auto Jobs:
            ${
                S.resourceAuto
                    ?
                    'ON'
                    :
                    'OFF'
            }
        </button>

        <div style="
            margin-top:8px;
            line-height:1.55;
        ">

            Start learned:
            <b style="
                color:${
                    startLearned
                        ?
                        '#67e480'
                        :
                        '#ffcf66'
                }
            ">
                ${
                    startLearned
                        ?
                        'YES'
                        :
                        'NO'
                }
            </b>

            <br>

            Collect learned:
            <b style="
                color:${
                    collectLearned
                        ?
                        '#67e480'
                        :
                        '#ffcf66'
                }
            ">
                ${
                    collectLearned
                        ?
                        'YES'
                        :
                        'NO'
                }
            </b>

            <br>

            Automation:
            <b style="
                color:${
                    S.resourceAuto
                        ?
                        '#67e480'
                        :
                        '#ff6969'
                }
            ">
                ${
                    S.resourceAuto
                        ?
                        'ON'
                        :
                        'OFF'
                }
            </b>

            <br>
    `;


    if (
        S.waitingFreshResource
    ) {

        html += `

            Status:
            <b style="
                color:#ffcf66
            ">
                REFRESHING JOB LIST
            </b>

            <br>
        `;

    } else if (
        S.resourceBusy
    ) {

        html += `

            Status:
            <b>
                WORKING...
            </b>

            <br>
        `;
    }


    if (
        S.resourceActive
    ) {

        const active =
            S.resourceActive;

        let remaining =
            active.bootstrap
                ?
                'checking'
                :
                '00:00';

        if (
            active.finishAt
        ) {

            remaining =
                fmtDuration(
                    Math.max(
                        0,
                        (
                            active.finishAt -
                            Date.now()
                        ) /
                        1000
                    )
                );
        }


        html += `

            Active job:
            <b>
                #${active.jobId}
            </b>

            <br>

            ${
                active.amount
                    ?
                    'Reward: <b>' +
                    active.amount +
                    ' ' +
                    esc(
                        active.resource
                    ) +
                    '</b><br>'
                    :
                    ''
            }

            Time:
            <b>
                ${remaining}
            </b>

            <br>
        `;
    }


    if (
        S.resourceLastAction
    ) {

        html += `

            Last:
            <b>
                ${esc(
                    S.resourceLastAction
                )}
            </b>

            <br>
        `;
    }


    if (
        S.resourceLastError
    ) {

        html += `

            <span style="
                color:#ff6969
            ">
                ${esc(
                    S.resourceLastError
                )}
            </span>

            <br>
        `;
    }


    const deposit =
        S.resourceDeposit;


    if (!deposit) {

        html += `

            <br>

            <span style="
                color:#ffcf66
            ">
                ${
                    S.waitingFreshResource
                        ?
                        'Waiting for fresh jobs from TW2...'
                        :
                        'Waiting for Resource Deposit data...'
                }
            </span>
        `;

    } else {

        html += `

            <br>

            Collected:
            <b>
                ${
                    Number(
                        deposit.resources_collected ||
                        0
                    )
                    .toLocaleString()
                }
            </b>

            <br>

            Remaining:
            <b>
                ${
                    Number(
                        deposit.resources_left ||
                        0
                    )
                    .toLocaleString()
                }
            </b>

            <br>
        `;


        if (
            Array.isArray(
                deposit.jobs
            )
        ) {

            html += `

                Jobs available:
                <b>
                    ${deposit.jobs.length}
                </b>

                <br>
            `;

            const best =
                bestDepositJob();

            if (best) {

                html += `

                    Best:
                    <b>
                        ${
                            Number(
                                best.amount
                            )
                            .toLocaleString()
                        }

                        ${esc(
                            best.resource_type ||
                            ''
                        )}
                    </b>

                    /

                    ${fmtDuration(
                        best.duration
                    )}

                    <br>
                `;
            }
        }


        if (
            Array.isArray(
                deposit.milestones
            )
        ) {

            const reached =
                deposit.milestones
                    .filter(
                        m =>
                            m.reached
                    )
                    .length;

            html += `

                Milestones:
                <b>
                    ${reached}/${
                        deposit.milestones.length
                    }
                </b>

                <br>
            `;
        }


        if (
            deposit.time_next_reset
        ) {

            html += `

                Reset:
                <b>
                    ${countdown(
                        deposit.time_next_reset
                    )}
                </b>

                <br>
            `;
        }
    }


    html += `

        </div>
    </div>

    <div style="
        margin-top:10px;
        font-size:10px;
        opacity:.45;
    ">
        TW2 Intel v${S.version}
        • ONE SCRIPT
    </div>
    `;


    panel.innerHTML =
        html;


    const closeIntel =
        document.getElementById(
            'tw2-close-intel'
        );

    if (closeIntel) {

        closeIntel.onclick =
            event => {

                event.preventDefault();
                event.stopPropagation();

                PANEL_UI.intelClosed =
                    true;

                panel.style.display =
                    'none';
            };
    }


    const refresh =
        document.getElementById(
            'tw2-refresh'
        );

    if (refresh) {

        refresh.onclick =
            collectIncoming;
    }


    const toggle =
        document.getElementById(
            'tw2-resource-toggle'
        );

    if (toggle) {

        toggle.onclick =
            toggleResourceAuto;
    }
}


/* ============================================================
   ATTACK CENTRE RENDER
   ============================================================ */

function renderAttackCentre() {

    const panel =
        getAttackPanel();

    if (
        !panel ||
        PANEL_UI.attacksClosed
    ) {
        return;
    }


    const attacks =
        getAttacks();

    const targets =
        buildTargets(
            attacks
        );

    const attackers =
        buildAttackers(
            attacks
        );

    const origins =
        buildOrigins(
            attacks
        );

    const trains =
        buildTrains(
            attacks
        );

    const noble =
        attacks.filter(
            a =>
                a._speed?.name ===
                'NOBLE'
        );

    const trebuchet =
        attacks.filter(
            a =>
                a._speed?.name ===
                'TREBUCHET'
        );

    const next =
        attacks[0];


    let html = `

    <div
        data-tw2-drag-handle
        style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            cursor:move;
            touch-action:none;
            user-select:none;
            padding-bottom:4px;
        "
    >

        <b style="
            font-size:16px
        ">
            ⚔ INCOMING ATTACK CENTRE
        </b>

        <div style="
            display:flex;
            align-items:center;
            gap:7px;
        ">

            <span style="
                opacity:.55
            ">
                v1.6.0
            </span>

            <button
                id="tw2-close-attacks"
                type="button"
                title="Close"
                style="
                    width:28px;
                    height:28px;
                    padding:0;
                    border:1px solid #777;
                    border-radius:5px;
                    background:#3b2323;
                    color:#fff;
                    font-size:18px;
                    font-weight:bold;
                    line-height:24px;
                    cursor:pointer;
                "
            >
                ×
            </button>

        </div>

    </div>


    <div style="
        margin-top:8px;
        padding:8px;
        background:#292929;
        border-radius:5px;
        line-height:1.6;
    ">

        Attacks:
        <b>
            ${attacks.length}
        </b>

        &nbsp; | &nbsp;

        Targets:
        <b>
            ${targets.length}
        </b>

        &nbsp; | &nbsp;

        Attackers:
        <b>
            ${attackers.length}
        </b>

        <br>

        👑 Noble speed:
        <b style="
            color:#ff6969
        ">
            ${noble.length}
        </b>

        &nbsp;

        🚨 Trebuchet:
        <b style="
            color:#ff9b55
        ">
            ${trebuchet.length}
        </b>

        &nbsp;

        🚂 Trains:
        <b>
            ${trains.length}
        </b>

    </div>
    `;


    if (next) {

        html += `

        <div style="
            margin-top:8px;
            padding:8px;
            border:1px solid #875;
            background:#30271f;
            border-radius:5px;
        ">

            <b>
                ⏱ NEXT ATTACK
            </b>

            <br>

            <span style="
                font-size:20px;
                font-weight:bold;
                color:#ffd166;
            ">
                ${countdown(
                    next.time_completed
                )}
            </span>

            <br>

            ${esc(
                displayCharacter(
                    next
                )
            )}

            →

            <b>
                ${esc(
                    next.target_village_name ||
                    '?'
                )}

                (${next.target_x}|${next.target_y})
            </b>

            <br>

            <span style="
                color:${
                    speedColour(
                        next._speed
                    )
                }
            ">
                ${speedLabel(
                    next._speed
                )}
            </span>

            <br>

            Lands:
            <b>
                ${fullArrival(
                    next.time_completed
                )}
            </b>

        </div>
        `;
    }


    html += `

    <div style="
        display:flex;
        gap:5px;
        flex-wrap:wrap;
        margin-top:8px;
    ">

        <button
            data-view="summary"
        >
            Summary
        </button>

        <button
            data-view="all"
        >
            All Attacks
        </button>

        <button
            data-view="targets"
        >
            Targets
        </button>

        <button
            data-view="attackers"
        >
            Attackers
        </button>

        <button
            data-view="patterns"
        >
            Patterns
        </button>

        <button
            data-view="trains"
        >
            Trains
        </button>

    </div>
    `;


    /* ========================================================
       SUMMARY
       ======================================================== */

    if (S.attackView === 'summary') {

        html += `

        <div style="
            margin-top:12px;
            border-top:1px solid #555;
            padding-top:8px;
        ">

            <b style="font-size:14px">
                🚨 PRIORITY WARNINGS
            </b>

        </div>
        `;


        const dangerous =
            attacks.filter(
                a =>
                    a._speed &&
                    (
                        a._speed.name === 'NOBLE' ||
                        a._speed.name === 'TREBUCHET'
                    )
            );


        if (!dangerous.length) {

            html += `

            <div style="
                margin-top:7px;
                opacity:.7;
            ">
                No Noble/Trebuchet-speed attacks detected.
            </div>
            `;

        } else {

            for (
                const attack
                of dangerous.slice(0,20)
            ) {

                html += attackCard(
                    attack,
                    true
                );
            }
        }


        html += `

        <div style="
            margin-top:12px;
            border-top:1px solid #555;
            padding-top:8px;
        ">

            <b style="font-size:14px">
                🎯 MOST ATTACKED VILLAGES
            </b>

        </div>
        `;


        for (
            const target
            of targets.slice(0,10)
        ) {

            html += targetCard(target);
        }
    }    /* ========================================================
       ALL ATTACKS
       ======================================================== */

    if (S.attackView === 'all') {

        html += `

        <div style="
            margin-top:12px;
            border-top:1px solid #555;
            padding-top:8px;
        ">

            <b style="font-size:14px">
                📋 ALL INCOMING ATTACKS
            </b>

        </div>
        `;


        if (!attacks.length) {

            html += `

            <div style="
                margin-top:7px;
                opacity:.7;
            ">
                No incoming attacks.
            </div>
            `;

        } else {

            attacks.forEach(
                (attack,index) => {

                    html += attackCard(
                        attack,
                        false,
                        index+1
                    );
                }
            );
        }
    }


    /* ========================================================
       TARGETS
       ======================================================== */

    if (S.attackView === 'targets') {

        html += `

        <div style="
            margin-top:12px;
            border-top:1px solid #555;
            padding-top:8px;
        ">

            <b style="font-size:14px">
                🎯 TARGET DANGER
            </b>

        </div>
        `;


        targets.forEach(
            target => {

                html += targetCard(target);
            }
        );
    }


    /* ========================================================
       ATTACKERS
       ======================================================== */

    if (S.attackView === 'attackers') {

        html += `

        <div style="
            margin-top:12px;
            border-top:1px solid #555;
            padding-top:8px;
        ">

            <b style="font-size:14px">
                👤 ATTACKERS
            </b>

        </div>
        `;


        attackers.forEach(
            attacker => {

                html += `

                <div style="
                    margin-top:7px;
                    padding:8px;
                    background:#242424;
                    border-radius:5px;
                ">

                    <b style="font-size:14px">
                        ${esc(attacker.name)}
                    </b>

                    <br>

                    Total attacks:
                    <b>${attacker.attacks.length}</b>

                    <br>

                    Origin villages:
                    <b>${attacker.origins.size}</b>

                    <br>

                    Your villages targeted:
                    <b>${attacker.targets.size}</b>

                    ${
                        attacker.noble
                            ?
                            `<br>
                             👑 Noble-speed:
                             <b style="color:#ff6969">
                                ${attacker.noble}
                             </b>`
                            :
                            ''
                    }

                    ${
                        attacker.trebuchet
                            ?
                            `<br>
                             🚨 Trebuchet-speed:
                             <b style="color:#ff9b55">
                                ${attacker.trebuchet}
                             </b>`
                            :
                            ''
                    }

                    ${
                        attacker.ram
                            ?
                            `<br>
                             💥 Ram/Catapult-speed:
                             <b>
                                ${attacker.ram}
                             </b>`
                            :
                            ''
                    }

                    <br>

                    Next landing:
                    <b style="color:#ffd166">
                        ${
                            countdown(
                                attacker.attacks[0]
                                    .time_completed
                            )
                        }
                    </b>

                </div>
                `;
            }
        );
    }


    /* ========================================================
       ORIGIN PATTERNS
       ======================================================== */

    if (S.attackView === 'patterns') {

        html += `

        <div style="
            margin-top:12px;
            border-top:1px solid #555;
            padding-top:8px;
        ">

            <b style="font-size:14px">
                🧭 ORIGIN PATTERNS
            </b>

            <br>

            <span style="opacity:.7">
                Masked TW2 names are shown with stable
                player/village IDs and coordinates.
            </span>

        </div>
        `;


        for (
            const origin
            of origins
        ) {

            const first =
                origin.attacks[0];

            const last =
                origin.attacks[
                    origin.attacks.length - 1
                ];

            const targetNames =
                [...origin.targets.values()]
                    .slice(0,8)
                    .map(esc)
                    .join(', ');


            html += `

            <div style="
                margin-top:6px;
                padding:7px;
                background:#242424;
                border-left:3px solid
                    ${speedColour(first._speed)};
                border-radius:4px;
            ">

                <b>
                    ${esc(origin.attacker)}
                </b>

                •

                <b>
                    ${esc(origin.origin)}
                </b>

                (${origin.x}|${origin.y})

                <br>

                <b>
                    ${origin.attacks.length}
                </b>

                attacks →

                <b>
                    ${origin.targets.size}
                </b>

                targets

                ${
                    origin.noble
                        ?
                        ` • 👑 ${origin.noble}`
                        :
                        ''
                }

                ${
                    origin.trebuchet
                        ?
                        ` • 🚨 Treb ${origin.trebuchet}`
                        :
                        ''
                }

                <br>

                Targets:
                ${targetNames}

                ${
                    origin.targets.size > 8
                        ?
                        '…'
                        :
                        ''
                }

                <br>

                First:
                <b>
                    ${fullArrival(
                        first.time_completed
                    )}
                </b>

                •

                ${countdown(
                    first.time_completed
                )}

                <br>

                Last:
                <b>
                    ${fullArrival(
                        last.time_completed
                    )}
                </b>

            </div>
            `;
        }
    }


    /* ========================================================
       TRAINS
       ======================================================== */

    if (S.attackView === 'trains') {

        html += `

        <div style="
            margin-top:12px;
            border-top:1px solid #555;
            padding-top:8px;
        ">

            <b style="font-size:14px">
                🚂 ALL DETECTED ATTACK TRAINS
            </b>

        </div>
        `;


        if (!trains.length) {

            html += `

            <div style="
                margin-top:7px;
                opacity:.7;
            ">
                No attack trains detected.
            </div>
            `;

        } else {

            trains.forEach(
                (train,index) => {

                    const first =
                        train.commands[0];

                    html += `

                    <div style="
                        margin-top:8px;
                        padding:8px;
                        background:#242424;
                        border:1px solid #555;
                        border-radius:5px;
                    ">

                        <b>
                            #${index+1}
                            ${rating(train)}
                        </b>

                        <br><br>

                        Attacker:
                        <b>
                            ${esc(
                                displayCharacter(
                                    first
                                )
                            )}
                        </b>

                        <br>

                        From:
                        <b>
                            ${esc(
                                displayOrigin(
                                    first
                                )
                            )}
                        </b>

                        (${first.origin_x}|${first.origin_y})

                        <br>

                        Target:
                        <b>
                            ${esc(
                                first.target_village_name ||
                                '?'
                            )}
                        </b>

                        (${first.target_x}|${first.target_y})

                        <br>

                        Speed:
                        <b style="
                            color:${speedColour(first._speed)}
                        ">
                            ${speedLabel(first._speed)}
                        </b>

                        <br>

                        Commands:
                        <b>
                            ${train.commands.length}
                        </b>

                        &nbsp; • &nbsp;

                        Spread:
                        <b>
                            ${train.spread}s
                        </b>

                        &nbsp; • &nbsp;

                        Max gap:
                        <b>
                            ${train.maxGap}s
                        </b>


                        <div style="
                            margin-top:7px;
                            background:#171717;
                            padding:6px;
                            border-radius:4px;
                            font-family:monospace;
                        ">
                    `;


                    train.commands.forEach(
                        (command,i) => {

                            let gap =
                                '';

                            if (
                                i > 0
                            ) {

                                const seconds =
                                    Number(
                                        command.time_completed
                                    )
                                    -
                                    Number(
                                        train.commands[
                                            i-1
                                        ].time_completed
                                    );

                                gap =
                                    ` <span style="color:#ffd166">+${seconds}s</span>`;
                            }

                            html += `

                            ${
                                String(i+1)
                                    .padStart(
                                        2,
                                        '0'
                                    )
                            }

                            &nbsp;

                            ${arrival(
                                command.time_completed
                            )}

                            ${gap}

                            <br>
                            `;
                        }
                    );


                    html += `

                        </div>

                        ${snipeWindowsHTML(train)}

                        <div style="
                            margin-top:7px;
                        ">

                            Next landing:

                            <b style="
                                color:#ffd166
                            ">
                                ${countdown(
                                    first.time_completed
                                )}
                            </b>

                        </div>

                    </div>
                    `;
                }
            );
        }
    }


    html += `

    <div style="
        margin-top:10px;
        font-size:10px;
        opacity:.45;
    ">
        Speed = calculated command speed class.
        Exact enemy troop composition is not visible.
    </div>
    `;


    panel.innerHTML =
        html;


    /*
       New close button handler.
    */

    const closeAttacks =
        document.getElementById(
            'tw2-close-attacks'
        );

    if (closeAttacks) {

        closeAttacks.onclick =
            event => {

                event.preventDefault();
                event.stopPropagation();

                PANEL_UI.attacksClosed =
                    true;

                panel.style.display =
                    'none';
            };
    }


    panel
        .querySelectorAll(
            '[data-view]'
        )
        .forEach(
            button => {

                button.onclick =
                    () => {

                        S.attackView =
                            button.getAttribute(
                                'data-view'
                            );

                        renderAttackCentre();
                    };
            }
        );
}


/* ============================================================
   ATTACK CARD
   ============================================================ */

function attackCard(
    attack,
    priority=false,
    number=null
) {

    const speed =
        attack._speed;

    return `

    <div style="
        margin-top:7px;
        padding:8px;
        background:
            ${
                priority
                    ?
                    '#302020'
                    :
                    '#222'
            };
        border-left:4px solid
            ${speedColour(speed)};
        border-radius:4px;
    ">

        <div style="
            display:flex;
            justify-content:space-between;
            gap:10px;
        ">

            <b>

                ${
                    number !== null
                        ?
                        '#' + number + ' '
                        :
                        ''
                }

                ${esc(
                    displayCharacter(
                        attack
                    )
                )}

            </b>

            <b style="
                color:#ffd166
            ">
                ${countdown(
                    attack.time_completed
                )}
            </b>

        </div>

        <br>

        From:

        <b>
            ${esc(
                displayOrigin(
                    attack
                )
            )}
        </b>

        (${attack.origin_x}|${attack.origin_y})

        <br>

        Target:

        <b>
            ${esc(
                attack.target_village_name ||
                '?'
            )}
        </b>

        (${attack.target_x}|${attack.target_y})

        <br>

        Lands:

        <b>
            ${fullArrival(
                attack.time_completed
            )}
        </b>

        <br>

        Distance:

        <b>
            ${attack._distance.toFixed(2)}
        </b>

        fields

        <br>

        Pace:

        <b>
            ${
                Number.isFinite(
                    attack._pace
                )
                    ?
                    attack._pace.toFixed(2)
                    :
                    '?'
            }
        </b>

        min/field

        <br>

        Speed:

        <b style="
            color:${speedColour(speed)}
        ">
            ${speedLabel(speed)}
        </b>

        <br>

        Command ID:

        <span style="
            opacity:.65
        ">
            ${attack.command_id}
        </span>

    </div>
    `;
}


/* ============================================================
   TARGET CARD
   ============================================================ */

function targetCard(target) {

    let danger =
        '🟢 LOW';

    let colour =
        '#67e480';

    if (
        target.noble > 0 ||
        target.trebuchet > 0
    ) {

        danger =
            '🔴 HIGH';

        colour =
            '#ff6969';

    } else if (
        target.attacks.length >= 5 ||
        target.ram >= 3
    ) {

        danger =
            '🟠 MEDIUM';

        colour =
            '#ffb347';
    }


    return `

    <div style="
        margin-top:7px;
        padding:8px;
        background:#242424;
        border-radius:5px;
    ">

        <b style="
            font-size:14px
        ">
            ${esc(
                target.name ||
                '?'
            )}

            (${target.x}|${target.y})
        </b>

        <br>

        <b style="
            color:${colour}
        ">
            ${danger}
        </b>

        <br>

        Incoming:
        <b>
            ${target.attacks.length}
        </b>        ${
            target.noble
                ?
                ` &nbsp; 👑 <b>${target.noble}</b>`
                :
                ''
        }

        ${
            target.trebuchet
                ?
                ` &nbsp; 🚨 Treb <b>${target.trebuchet}</b>`
                :
                ''
        }

        ${
            target.ram
                ?
                ` &nbsp; 💥 <b>${target.ram}</b>`
                :
                ''
        }

        <br>

        Next:

        <b style="
            color:#ffd166
        ">
            ${countdown(
                target.attacks[0]
                    .time_completed
            )}
        </b>

    </div>
    `;
}


/* ============================================================
   LIVE DISPLAY
   ============================================================ */

setInterval(
    () => {

        if (
            document.getElementById(
                'tw2-intel-dashboard'
            )
            ||
            document.getElementById(
                'tw2-attack-centre'
            )
        ) {

            render();
        }

    },
    1000
);


/* ============================================================
   AUTO INCOMING REFRESH
   ============================================================ */

setInterval(
    () => {

        if (
            S.socketFound &&
            S.tokenEmit
        ) {

            collectIncoming();
        }

    },
    CFG.INCOMING_REFRESH
);


/* ============================================================
   RESOURCE AUTO TIMER
   ============================================================ */

setInterval(
    resourceCycle,
    CFG.RESOURCE_CHECK
);


/* ============================================================
   PUBLIC HELPERS
   ============================================================ */

window.tw2AttackCentre = {

    getAttacks,

    getTargets:
        () =>
            buildTargets(
                getAttacks()
            ),

    getAttackers:
        () =>
            buildAttackers(
                getAttacks()
            ),

    getOrigins:
        () =>
            buildOrigins(
                getAttacks()
            ),

    getTrains:
        () =>
            buildTrains(
                getAttacks()
            ),

    refresh:
        collectIncoming
};


/* ============================================================
   MOBILE SHELL
   ============================================================ */

/*
 * The APK uses a desktop user-agent and can have a viewport
 * wider than the old 760px mobile breakpoint.
 *
 * The main Intel and Attack Centre panels now already contain
 * their own draggable title bars, close buttons and permanent
 * reopen controls, so the old mobile shell must not create a
 * second set of controls.
 */

function installMobileShell() {

    if (
        document.getElementById(
            'tw2-mobile-style'
        )
    ) {
        return;
    }


    const style =
        document.createElement(
            'style'
        );

    style.id =
        'tw2-mobile-style';


    style.textContent = `

        /*
         * Keep TW2 Intel controls above the game UI.
         */

        #tw2-panel-launcher {
            z-index:2147483647 !important;
        }


        /*
         * Only the title/drag areas consume drag gestures.
         * The rest of each panel can scroll normally.
         */

        #tw2-intel-dashboard
        [data-tw2-drag-handle],

        #tw2-attack-centre
        [data-tw2-drag-handle] {

            touch-action:none !important;

            -webkit-user-select:none !important;
            user-select:none !important;
        }


        #tw2-intel-dashboard,
        #tw2-attack-centre {

            box-sizing:border-box;

            -webkit-overflow-scrolling:touch;
        }


        /*
         * Slightly constrain the panels on genuinely
         * narrow screens without changing their normal
         * desktop/APK positioning.
         */

        @media (max-width:760px) {

            #tw2-intel-dashboard {

                width:min(
                    350px,
                    calc(100vw - 16px)
                ) !important;

                max-width:
                    calc(100vw - 16px) !important;

                max-height:
                    calc(100vh - 90px) !important;
            }


            #tw2-attack-centre {

                width:min(
                    560px,
                    calc(100vw - 16px)
                ) !important;

                max-width:
                    calc(100vw - 16px) !important;

                max-height:
                    calc(100vh - 90px) !important;
            }


            #tw2-panel-launcher {

                right:8px !important;
                bottom:8px !important;
            }
        }
    `;


    document.documentElement
        .appendChild(
            style
        );
}


/* ============================================================
   BOOT
   ============================================================ */

function boot() {

    if (
        !document.documentElement
    ) {

        requestAnimationFrame(
            boot
        );

        return;
    }


    installMobileShell();

    getPanelLauncher();

    render();
}


boot();


console.log(
    '%c[TW2 Intelligence v1.6.0 loaded]',
    'color:#00ff88;font-weight:bold'
);

// Capture manual spy mission requests
window.tw2SpyCapture = [];

const originalLearnRequest = learnRequest;

learnRequest = function(msg) {
    originalLearnRequest(msg);

    if (!msg || typeof msg.type !== 'string') return;

    if (/spy|scout|espionage/i.test(msg.type)) {
        const record = {
            type: msg.type,
            data: clone(msg.data),
            time: new Date().toISOString()
        };

        window.tw2SpyCapture.push(record);
        localStorage.setItem(
            'tw2Intel.spyCapture',
            JSON.stringify(window.tw2SpyCapture)
        );

        console.log('[TW2 Spy Capture]', record);
    }
};
   // View saved spy capture on mobile
window.showTW2SpyCapture = function() {
    const saved = localStorage.getItem('tw2Intel.spyCapture');
    const records = saved ? JSON.parse(saved) : [];

    const output = document.createElement('textarea');
    output.value = JSON.stringify(records, null, 2);
    output.readOnly = true;
    output.style.cssText =
        'position:fixed;top:10%;left:5%;width:90%;height:65%;' +
        'z-index:2147483647;background:#111;color:#fff;' +
        'font-size:14px;padding:10px;';

    const close = document.createElement('button');
    close.textContent = 'CLOSE';
    close.style.cssText =
        'position:fixed;top:76%;left:5%;z-index:2147483647;' +
        'padding:12px;background:#333;color:white;';
    close.onclick = () => {
        output.remove();
        close.remove();
    };

    document.body.append(output, close);
};

const spyButton = document.createElement('button');
spyButton.textContent = '🕵️ SPY CAPTURE';
spyButton.style.cssText =
    'position:fixed;bottom:65px;left:10px;z-index:2147483646;' +
    'padding:10px;background:#273b48;color:white;';
spyButton.onclick = window.showTW2SpyCapture;
if (document.body) {
    document.body.appendChild(spyButton);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(spyButton);
    }, { once: true });
}
// Capture scouting report response types safely
const tw2NativeScan = scan;

scan = function(obj, depth) {
    if (
        obj &&
        typeof obj === 'object' &&
        typeof obj.type === 'string' &&
        /scout|spy|report/i.test(obj.type)
    ) {
        const captures = JSON.parse(
            localStorage.getItem('tw2Intel.reportTypes') || '[]'
        );

        if (!captures.includes(obj.type)) {
            captures.push(obj.type);
            localStorage.setItem(
                'tw2Intel.reportTypes',
                JSON.stringify(captures)
            );
            console.log('[TW2 Report Type]', obj.type);
        }
    }

    return tw2NativeScan(obj, depth);
};
})();
