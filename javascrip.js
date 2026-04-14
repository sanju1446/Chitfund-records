let systemDate = localStorage.getItem("systemDate") 
    ? new Date(localStorage.getItem("systemDate")) 
    : new Date();
/* ═══════════════════════════════════════════════════════════
   RR Kakatiya Chit Fund — javascript.js  (v5 — Production Enhanced)
   ═══════════════════════════════════════════════════════════ */

/* ── State ──────────────────────────────────────────────── */
let groups       = JSON.parse(localStorage.getItem("chitGroups"))       || {};
let trash        = JSON.parse(localStorage.getItem("chitTrash"))        || {};
let reminders    = JSON.parse(localStorage.getItem("chitReminders"))    || [];
let penaltyRates = JSON.parse(localStorage.getItem("chitPenaltyRates")) || {};
let transactions = JSON.parse(localStorage.getItem("chitTransactions")) || [];
let activeGroup  = null;

/* ═══════════════════════════════════════════════════════════
   UTILS / FORMAT
   ═══════════════════════════════════════════════════════════ */
function fmt(n) {
    return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function save() {
    localStorage.setItem("chitGroups",       JSON.stringify(groups));
    localStorage.setItem("chitTrash",        JSON.stringify(trash));
    localStorage.setItem("chitReminders",    JSON.stringify(reminders));
    localStorage.setItem("chitPenaltyRates", JSON.stringify(penaltyRates));
    localStorage.setItem("chitTransactions", JSON.stringify(transactions));
}
function validatePhone(phone) { return /^\d{10}$/.test(phone.trim()); }
function isGroupCompleted(group) { return group.currentMonth >= group.months; }
function esc(str) { return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
function penaltyKey(gn, mi) { return gn + "::" + mi; }
function getPenaltyRate(gn, mi) { return parseFloat(penaltyRates[penaltyKey(gn, mi)] || 0); }
/* Calculate which chit month number a given date falls into, based on group start date.
   Month 1 = from startDate up to (but not including) startDate + 1 calendar month, etc. */
function calcTakenMonthFromDate(group, dateStr) {
    if (!dateStr || !group.startDate) return null;
    let start = new Date(group.startDate);
    start.setHours(0,0,0,0);
    let target = new Date(dateStr);
    target.setHours(0,0,0,0);
    if (target < start) return null;
    // Calculate how many full months have elapsed since start
    let yearDiff  = target.getFullYear() - start.getFullYear();
    let monthDiff = target.getMonth() - start.getMonth();
    let dayDiff   = target.getDate() - start.getDate();
    let totalMonths = yearDiff * 12 + monthDiff;
    if (dayDiff < 0) totalMonths -= 1; // haven't reached same day of month yet
    let monthNum = totalMonths + 1; // month 1-based
    return Math.max(1, Math.min(monthNum, group.months));
}

/* ═══════════════════════════════════════════════════════════
   TRANSACTION LOG  (Req #8 — global audit trail)
   ═══════════════════════════════════════════════════════════ */
function logTransaction(type, member, groupName, amount, extra, receiptDate) {
    let rDate = receiptDate
        ? new Date(receiptDate).toISOString()
        : systemDate.toISOString();
    transactions.push({
        id:          Date.now() + Math.random(),
        type:        type,           // "payment" | "payout" | "penalty_applied"
        member:      member,
        group:       groupName,
        amount:      amount,
        date:        rDate,
        receiptDate: rDate,
        reason:      extra || ""
    });
    // Keep last 2000 entries — sort by receiptDate descending after each push
    if (transactions.length > 2000) transactions.splice(0, transactions.length - 2000);
    transactions.sort(function(a, b) {
        return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
    });
}

/* ═══════════════════════════════════════════════════════════
   CALCULATIONS  (single source — Req #9)
   ═══════════════════════════════════════════════════════════ */
function calcPayout(group, takenMonth) {
    let commission = group.totalAmount * group.commissionRate;
    return (group.totalAmount - commission) + (takenMonth - 1) * group.increment;
}
function calcMonthlyDue(group, member, checkMonth) {
    let base = group.totalAmount / group.months;
    return (member.taken && member.takenMonth !== null && checkMonth > member.takenMonth)
        ? base + group.increment : base;
}
function getExpectedTillNow(group, member) {
    let base = group.totalAmount / group.months, expected = 0;
    for (let m = 1; m <= group.currentMonth; m++) {
        expected += (member.taken && member.takenMonth !== null && m > member.takenMonth)
            ? base + group.increment : base;
    }
    return expected;
}
function getTotalExpected(group, member) {
    let base = group.totalAmount / group.months;
    let total = base * group.months;
    if (member.taken && member.takenMonth !== null)
        total += group.increment * (group.months - member.takenMonth);
    return total;
}
function getTotalRemaining(group, member) {
    return Math.max(0, getTotalExpected(group, member) - (member.totalPaid || 0));
}
/* PS members: how much they still need to pay from takenMonth+1 until the last month.
   Formula: sum of all instalments from (takenMonth+1) to (group.months) minus
   whatever they have already paid after taking the prize.
   "Paid after taking" = totalPaid - sum of instalments for months 1..takenMonth */
function getPS_StillToPay(group, member) {
    if (!member.taken || !member.takenMonth) return getTotalRemaining(group, member);
    let base = group.totalAmount / group.months;

    // Total instalments they must pay AFTER taking (months takenMonth+1 → group.months)
    let totalAfterTaking = group.increment > 0
        ? (base + group.increment) * (group.months - member.takenMonth)
        : base * (group.months - member.takenMonth);

    // What they paid BEFORE taking (months 1 → takenMonth, all at base rate)
    let paidBeforeTaking = base * member.takenMonth;

    // What they've paid towards post-taking instalments
    let paidAfterTaking = Math.max(0, (member.totalPaid || 0) - paidBeforeTaking);

    return Math.max(0, totalAfterTaking - paidAfterTaking);
}
function recalcCurrentDue(group, member) {
    /* Recalculate how much is owed for all months up to currentMonth minus what's been paid */
    let base = group.totalAmount / group.months, accDue = 0;
    for (let m = 1; m <= group.currentMonth; m++) {
        accDue += (member.taken && member.takenMonth !== null && m > member.takenMonth)
            ? base + group.increment : base;
    }
    let netDue = accDue - (member.totalPaid || 0);

    /* After recalc, split into previousDue and currentMonthDue.
       currentMonthDue is always the instalment for the current month.
       previousDue is whatever is left over. */
    let currentMonthlyInstalment = (member.taken && member.takenMonth !== null && group.currentMonth > member.takenMonth)
        ? base + group.increment : base;

    if (netDue <= 0) {
        member.previousDue     = 0;
        member.currentMonthDue = Math.max(0, currentMonthlyInstalment + netDue); // credit reduces current
    } else if (netDue <= currentMonthlyInstalment) {
        member.previousDue     = 0;
        member.currentMonthDue = netDue;
    } else {
        member.previousDue     = netDue - currentMonthlyInstalment;
        member.currentMonthDue = currentMonthlyInstalment;
    }
    return netDue;
}
/* Net collected after payouts */
function calcNetCollected() {
    let net = 0;
    for (let gn in groups) {
        groups[gn].members.forEach(function(m) { net += (m.totalPaid || 0); });
    }
    // Subtract payouts
    transactions.filter(function(t){ return t.type === "payout"; })
                .forEach(function(t){ net -= (t.amount || 0); });
    return net;
}
function calcTotalPaidOut() {
    return transactions.filter(function(t){ return t.type === "payout"; })
                       .reduce(function(s, t){ return s + (t.amount || 0); }, 0);
}
function calcActiveDue() {
    let d = 0;
    for (let gn in groups) {
        let g = groups[gn];
        g.members.forEach(function(m) {
            // SOURCE OF TRUTH: use member.currentDue (not expected - totalPaid)
            d += Math.max(0, m.currentDue || 0);
        });
    }
    return d;
}

/* ═══════════════════════════════════════════════════════════
   THEME
   ═══════════════════════════════════════════════════════════ */
function toggleTheme() {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem("chitTheme", isDark ? "dark" : "light");
    document.getElementById("themeBtn").textContent = isDark ? "☀️" : "🌙";
}
(function initTheme() {
    if (localStorage.getItem("chitTheme") === "dark") {
        document.body.classList.add("dark");
        const btn = document.getElementById("themeBtn");
        if (btn) btn.textContent = "☀️";
    }
})();

/* ═══════════════════════════════════════════════════════════
   AUTO-MONTH TICK
   ═══════════════════════════════════════════════════════════ */
function autoTickAllGroups() { for (let name in groups) autoTickGroup(name); }
function autoTickGroup(groupName) {
    let ticked = false;
    let group = groups[groupName];

    let today = new Date(systemDate);   // ✅ USE SYSTEM DATE
    today.setHours(0,0,0,0);

    let lastTick = new Date(group.lastTickDate);
    lastTick.setHours(0,0,0,0);
    while (group.currentMonth < group.months) {
        let nextTick = new Date(lastTick);
        nextTick.setMonth(nextTick.getMonth() + 1);
        nextTick.setDate(1); nextTick.setHours(0,0,0,0);
        if (today >= nextTick) {
            advanceMonth(group);
            group.lastTickDate = nextTick.toISOString().split("T")[0];
            lastTick = nextTick; ticked = true;
        } else break;
    }
    if (ticked) save();
}
function advanceMonth(group) {
    group.currentMonth += 1;
    group.members.forEach(function(member) {
        let newMonthlyDue = calcMonthlyDue(group, member, group.currentMonth);

        /* ── Month transition (Rule #3) ─────────────────────────────
           previousDue  = whatever was still owed at end of last month
           currentMonthDue = fresh instalment for the new month
           currentDue   = previousDue + currentMonthDue
        ──────────────────────────────────────────────────────────── */
        member.previousDue    = Math.max(0, member.currentDue);   // carry forward unpaid
        member.currentMonthDue = newMonthlyDue;
        member.currentDue     = member.previousDue + member.currentMonthDue;

        /* Re-apply stored penalty rate (if any) on previousDue only (Rule #4) */
        let gName = null;
        for (let gn in groups) { if (groups[gn] === group) { gName = gn; break; } }
        if (gName !== null) {
            let idx = group.members.indexOf(member);
            let pct = getPenaltyRate(gName, idx);
            if (pct > 0) {
                member.penalty = member.previousDue * (pct / 100);
            }
        }
    });
}

/* ═══════════════════════════════════════════════════════════
   PAYMENTS  (single function — Req #9)
   Payment priority: penalty → previousDue → currentMonthDue (Rule #5)
   ═══════════════════════════════════════════════════════════ */
function applyPayment(member, amount, groupName, memberName, receiptDate) {
    let remaining = amount;

    /* 1. Clear penalty first */
    let penalty = member.penalty || 0;
    if (penalty > 0) {
        let penaltyPaid = Math.min(remaining, penalty);
        member.penalty  = penalty - penaltyPaid;
        remaining       -= penaltyPaid;
        if (penaltyPaid > 0 && groupName) {
            logTransaction("penalty_applied", memberName || member.name, groupName, penaltyPaid, "Penalty deducted from payment", receiptDate);
        }
    }

    /* 2. Apply to previousDue */
    if (remaining > 0) {
        let prevDue = member.previousDue || 0;
        if (prevDue > 0) {
            let prevPaid = Math.min(remaining, prevDue);
            member.previousDue -= prevPaid;
            remaining          -= prevPaid;
        }
    }

    /* 3. Apply to currentMonthDue */
    if (remaining > 0) {
        let curMonthDue = member.currentMonthDue || 0;
        if (curMonthDue > 0) {
            let curPaid = Math.min(remaining, curMonthDue);
            member.currentMonthDue -= curPaid;
            remaining              -= curPaid;
        }
    }

    /* 4. Any extra amount reduces future dues (negative currentDue = credit) */
    /* Record full payment amount in totalPaid; recalc currentDue */
    member.totalPaid  = (member.totalPaid || 0) + amount;
    member.currentDue = (member.previousDue || 0) + (member.currentMonthDue || 0);

    if (amount > 0 && groupName) {
        logTransaction("payment", memberName || member.name, groupName, amount, "", receiptDate);
    }
}
function addAllPayments(groupName) {
    let group = groups[groupName], anyAdded = false;
    let systemDateStr = systemDate.toISOString().split("T")[0];
    group.members.forEach(function(member, i) {
        let input     = document.getElementById("pay"   + i);
        let narrEl    = document.getElementById("narr"  + i);
        let dateEl    = document.getElementById("receiptDate" + i);
        let narration = narrEl ? narrEl.value.trim() : "";
        // Use the per-row date, fallback to systemDate
        let receiptDateVal = (dateEl && dateEl.value) ? dateEl.value : systemDateStr;
        let receiptDateISO = new Date(receiptDateVal).toISOString();
        if (!input || (input.value === "" && !narration)) return;
        let amount = input.value !== "" ? parseFloat(input.value) : 0;
        if (isNaN(amount) || amount < 0) return;
        if (!member.history) member.history = [];
        if (amount > 0) applyPayment(member, amount, groupName, member.name, receiptDateISO);
        anyAdded = true;
        member.history.push({ amount: amount || 0, date: receiptDateISO, receiptDate: receiptDateISO, narration: narration });
        // Keep history sorted by receiptDate descending
        member.history.sort(function(a, b) {
            return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
        });
    });
    if (!anyAdded) { showToast("⚠️ Enter at least one payment or narration", "warning"); return; }
    save(); showGroup(groupName);
    showToast("✅ Payments recorded", "success");
}
function deletePaymentEntry(groupName, memberName, idxArg, isRealIdx) {
    let group  = groups[groupName];
    let member = group.members.find(function(m) { return m.name === memberName; });
    if (!member || !member.history) return;
    let realIdx = isRealIdx ? idxArg : (member.history.length - 1 - idxArg);
    let entry   = member.history[realIdx];
    if (!entry) return;
    if (!confirm("Delete payment of " + fmt(entry.amount) + " for " + member.name + "?")) return;
    member.history.splice(realIdx, 1);
    member.totalPaid  = member.history.reduce(function(s, h) { return s + (h.amount || 0); }, 0);
    let netDue = recalcCurrentDue(group, member);
    member.currentDue = (member.previousDue || 0) + (member.currentMonthDue || 0);
    save(); showToast("🗑 Payment deleted and amounts updated", "info");
    if (document.getElementById("historyDetailsTitle")) showHistoryGroup(groupName);
}
function updateNarration(groupName, memberName, displayIdx, newText) {
    let group  = groups[groupName]; if (!group) return;
    let member = group.members.find(function(m) { return m.name === memberName; });
    if (!member || !member.history) return;
    // History is sorted descending; displayIdx maps directly to sorted position
    // But we need to find the actual history entry — use sorted array to find it
    let sorted = member.history.slice().sort(function(a, b) {
        return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
    });
    let entry = sorted[displayIdx];
    if (!entry) return;
    let realIndex = member.history.indexOf(entry);
    if (realIndex !== -1) member.history[realIndex].narration = newText;
    save(); showToast("✏️ Narration updated", "info");
}

/* ═══════════════════════════════════════════════════════════
   PENALTY MANAGEMENT  (single function — Req #5 + #9)
   ═══════════════════════════════════════════════════════════ */
function setPenalty(groupName, memberIndex, value) {
    groups[groupName].members[memberIndex].penalty = Math.max(0, parseFloat(value) || 0);
    save();
}
function setMemberPenaltyPct(groupName, memberIndex, pct) {
    let parsedPct = Math.max(0, parseFloat(pct) || 0);
    let key = penaltyKey(groupName, memberIndex);
    if (parsedPct <= 0) { delete penaltyRates[key]; }
    else { penaltyRates[key] = parsedPct; }
    let g = groups[groupName]; if (!g) return;
    let m = g.members[memberIndex]; if (!m) return;

    /* Rule #4: Penalty = previousDue × (rate/100). NEVER use currentDue. */
    let prevDue = Math.max(0, m.previousDue || 0);
    let oldPenalty = m.penalty || 0;
    m.penalty = prevDue * (parsedPct / 100);

    // Log if penalty increased
    if (m.penalty > oldPenalty) {
        logTransaction("penalty_applied", m.name, groupName, m.penalty - oldPenalty,
            "Penalty rate " + parsedPct + "% on previousDue " + fmt(prevDue));
    }
    save();
    showToast(parsedPct > 0 ? "⚠️ Penalty set to " + parsedPct + "% on prev. due " + fmt(prevDue) : "✅ Penalty cleared", parsedPct > 0 ? "warning" : "success");
    /* Sync all views */
    if (document.getElementById("dueTable")) showDueList();
    if (document.getElementById("penaltyTable")) showPenaltyList();
}
function setPenaltyDirect(groupName, memberIndex, amount) {
    let g = groups[groupName]; if (!g) return;
    let m = g.members[memberIndex]; if (!m) return;
    let newAmt = Math.max(0, parseFloat(amount) || 0);
    m.penalty = newAmt;
    save();
    showToast("✅ Penalty amount updated", "success");
    if (document.getElementById("penaltyTable")) showPenaltyList();
}

/* ═══════════════════════════════════════════════════════════
   WORKER ASSIGNMENT
   ═══════════════════════════════════════════════════════════ */
function setWorker(groupName, memberIndex, workerName) {
    groups[groupName].members[memberIndex].worker = workerName.trim();
    save();
}
function getAllMembersFlat() {
    let result = [];
    for (let gName in groups) {
        groups[gName].members.forEach(function(m) {
            result.push({ groupName: gName, group: groups[gName], member: m });
        });
    }
    return result;
}
function getAllWorkers() {
    let workers = new Set();
    for (let gName in groups)
        groups[gName].members.forEach(function(m) { if (m.worker && m.worker.trim()) workers.add(m.worker.trim()); });
    return [...workers].sort();
}

/* ═══════════════════════════════════════════════════════════
   CREATE GROUP
   ═══════════════════════════════════════════════════════════ */
function generateMemberInputs() {
    let count     = parseInt(document.getElementById("memberCount").value);
    let container = document.getElementById("memberInputs");
    container.innerHTML = "";
    if (!count || count < 0) {
        container.innerHTML = '<p style="color:var(--danger);font-size:13px;font-weight:500;">⚠️ Please enter valid number of members.</p>';
        return;
    }
    let html = '<div class="member-cards">';
    for (let i = 0; i < count; i++) {
        html += '<div class="member-card-input">' +
            '<div class="member-label">Member ' + (i+1) + '</div>' +
            '<input type="text" id="mName'   + i + '" placeholder="Full Name" autocomplete="off">' +
            '<input type="tel"  id="mPhone'  + i + '" placeholder="Phone (10 digits)" maxlength="10" oninput="this.value=this.value.replace(/[^0-9]/g,\'\')" autocomplete="off">' +
            '<input type="text" id="mWorker' + i + '" placeholder="Assigned Worker (optional)" autocomplete="off">' +
            '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}
function previewCommission() {
    const total = parseFloat(document.getElementById("totalAmount").value) || 0;
    const months = parseInt(document.getElementById("months").value) || 0;
    const increment = parseFloat(document.getElementById("increment").value) || 0;
    const box = document.getElementById("commissionPreview");
    if (!box || total <= 0 || months <= 0) return;
    let commission = total * 0.05, base = total / months;
    box.innerHTML = '<strong>Commission (5%):</strong> ' + fmt(commission) + '<br>' +
        '<strong>Base monthly per member:</strong> ' + fmt(base) + '<br>' +
        '<strong>Month 1 taker gets:</strong> ' + fmt(total - commission) + '<br>' +
        '<strong>Month ' + months + ' taker gets:</strong> ' + fmt((total - commission) + (months-1)*increment) +
        (increment > 0 ? ' <span style="color:var(--text-muted)">(extra ₹' + increment.toLocaleString("en-IN") + '/mo from prior takers)</span>' : '');
}
function createGroup() {
    let name      = document.getElementById("groupName").value.trim();
    let count     = parseInt(document.getElementById("memberCount").value);
    let total     = parseFloat(document.getElementById("totalAmount").value);
    let months    = parseInt(document.getElementById("months").value);
    let startDate = document.getElementById("startDate").value;
    let increment = parseFloat(document.getElementById("increment").value) || 0;

    if (!name)                { alert("Enter Group Name");           return; }
    if (!total || total <= 0) { alert("Enter a valid Total Amount"); return; }
    if (!months || months < 1){ alert("Enter valid Months");         return; }
    if (!startDate)           { alert("Enter Start Date");           return; }
    if (groups[name])         { alert("Group name already exists!"); return; }

    let members = [];
    for (let i = 0; i < count; i++) {
        let mName   = (document.getElementById("mName"   + i)?.value.trim()) || ("Member " + (i+1));
        let mPhone  = (document.getElementById("mPhone"  + i)?.value.trim()) || "";
        let mWorker = (document.getElementById("mWorker" + i)?.value.trim()) || "";
        if (mPhone && !validatePhone(mPhone)) {
            alert("Member " + (i+1) + " (" + mName + "): Phone must be exactly 10 digits."); return;
        }
        members.push({ name: mName, phone: mPhone || "—", worker: mWorker,
            totalPaid: 0,
            previousDue: 0,
            currentMonthDue: total / months,
            currentDue: total / months,
            penalty: 0,
            taken: false, takenMonth: null, history: [] });
    }
    groups[name] = { totalAmount: total, months: months, commissionRate: 0.05, increment: increment,
        startDate: startDate, startDay: parseInt(startDate.split("-")[2]),
        currentMonth: 1, lastTickDate: startDate, members: members };
    save();
    showToast('✅ Group "' + name + '" created!', "success");
    navigate("tables", document.querySelector('.nav-item[onclick*="tables"]'));
}

/* ═══════════════════════════════════════════════════════════
   DISPLAY GROUP LIST
   ═══════════════════════════════════════════════════════════ */
function displayGroups() {
    let list = document.getElementById("groupList");
    if (!list) return;
    list.innerHTML = "";
    let keys = Object.keys(groups);
    if (keys.length === 0) { list.innerHTML = '<div class="group-empty">📭 No groups yet. Create one!</div>'; return; }
    keys.forEach(function(name) {
        let g = groups[name];
        let div = document.createElement("div");
        div.className = "group-item" + (name === activeGroup ? " active" : "");
        div.innerHTML =
            '<div class="group-item-name">' +
                '<div class="group-title">' + name + '</div>' +
                '<div class="group-sub">Month ' + g.currentMonth + '/' + g.months + '</div>' +
            '</div>' +
            '<button class="btn btn-danger" onclick="event.stopPropagation();deleteGroup(\'' + esc(name) + '\')">🗑 Delete</button>';
        div.onclick = function() {
            activeGroup = name;
            document.querySelectorAll(".group-item").forEach(function(el) { el.classList.remove("active"); });
            div.classList.add("active");
            showGroup(name);
            // Re-apply search filter if a query is active
            let q = (document.getElementById("searchBox")?.value || "").toLowerCase().trim();
            if (q) {
                let memberHits = [];
                groups[name].members.forEach(function(m, idx) {
                    if (m.name.toLowerCase().includes(q) || (m.phone && m.phone.toLowerCase().includes(q))) memberHits.push(idx);
                });
                let groupNameMatch = name.toLowerCase().includes(q);
                _filterGroupDetailForSearch(name, q, memberHits.length > 0 ? memberHits : null, groupNameMatch);
            }
        };
        list.appendChild(div);
    });
}

/* ═══════════════════════════════════════════════════════════
   SHOW GROUP DETAILS
   ═══════════════════════════════════════════════════════════ */
function showGroup(name) {
    autoTickGroup(name);
    let details = document.getElementById("groupDetails");
    if (!details) return;
    let group = groups[name];
    let base  = group.totalAmount / group.months;

    let nextTick = new Date(group.lastTickDate);
    nextTick.setMonth(nextTick.getMonth() + 1); nextTick.setDate(1);
    let nextTickStr = group.currentMonth >= group.months ? "Completed ✅"
        : nextTick.toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" });

    let rows = "";
    let totalPaidSum = 0, totalDueSum = 0;
    group.members.forEach(function(m, i) {
        let totalExpected    = getTotalExpected(group, m);
        let totalPaid        = m.totalPaid || 0;
        let overallRemaining = Math.max(0, totalExpected - totalPaid);
        let currentDue       = Math.max(0, m.currentDue);
        let expectedSoFar    = getExpectedTillNow(group, m);
        let dueClass         = currentDue <= 0 ? "due-zero" : (totalPaid > 0 && totalPaid >= base ? "due-partial" : "due-full");
        let payoutCell       = m.taken && m.takenMonth !== null
            ? '<span class="payout-badge">💰 ' + fmt(calcPayout(group, m.takenMonth)) + '</span>' +
              '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' +
              'Month ' + m.takenMonth +
              (m.takenDate ? ' \xb7 ' + new Date(m.takenDate).toLocaleDateString("en-IN", {day:"numeric",month:"short",year:"numeric"}) : '') +
              '</div>'
            : '<span style="color:var(--text-muted);font-size:12px;">—</span>';
        let penaltyAmt = m.penalty || 0;
        let prevDue    = m.previousDue || 0;
        let currMonthDue = Math.max(0, m.currentMonthDue || 0);
        // Penalty cell: show amount + basis note
        let penaltyCell = penaltyAmt > 0
            ? '<span class="penalty-badge">' + fmt(penaltyAmt) + '</span>' +
              '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">on prev due ' + fmt(prevDue) + '</div>'
            : '<span style="color:var(--text-muted);font-size:12px">—</span>';
        // Due cell: show breakdown previousDue + currentMonthDue
        let dueBreakdown = (prevDue > 0 || currMonthDue > 0)
            ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' +
              (prevDue > 0 ? 'prev: ' + fmt(prevDue) + ' ' : '') +
              (currMonthDue > 0 ? 'curr: ' + fmt(currMonthDue) : '') +
              '</div>'
            : '';

        totalPaidSum += totalPaid;
        totalDueSum  += currentDue;

        rows += '<tr data-member-idx="' + i + '">' +
            '<td><strong>' + m.name + '</strong> <span style="color:var(--text-muted);font-size:12px">(' + m.phone + ')</span></td>' +
            '<td class="paid-cell">' + fmt(totalPaid) + '</td>' +
            '<td class="' + dueClass + '">' + fmt(currentDue) + dueBreakdown + '</td>' +
            '<td>' + fmt(overallRemaining) + '</td>' +
            '<td style="color:var(--warning,#f59e0b);font-weight:600">' + penaltyCell + '</td>' +
            '<td>' + payoutCell + '</td>' +
            '<td>' +
                '<select onchange="setTaken(\'' + esc(name) + '\',' + i + ',this.value)" style="width:72px">' +
                    '<option value="no" '  + (!m.taken ? "selected" : "") + '>NPS</option>' +
                    '<option value="yes" ' + ( m.taken ? "selected" : "") + '>PS</option>' +
                '</select>' +
            '</td>' +
            '<td>' +
                '<input type="date" id="takenMonth' + i + '"' +
                ' value="' + (m.takenDate || '') + '"' +
                ' onblur="if(this.value)setTakenMonthFromDate(\'' + esc(name) + '\',' + i + ',this.value)"' +
                ' style="width:140px" ' + (!m.taken ? "disabled" : "") + '>' +
                (m.takenMonth ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Month ' + m.takenMonth + '</div>' : '') +
            '</td>' +
            '<td><input type="text" class="worker-input" placeholder="Worker name" value="' + (m.worker || '') + '"' +
                ' onchange="setWorker(\'' + esc(name) + '\',' + i + ',this.value)" style="width:130px"></td>' +
            '<td><input type="number" id="pay' + i + '" placeholder="Amount" min="0" style="width:110px"></td>' +
            '<td class="narration-cell"><input type="text" id="narr' + i + '" placeholder="Narration (optional)" style="width:100%;min-width:200px"></td>' +
            '<td class="narration-cell"><input type="date" id="receiptDate' + i + '" value="' + systemDate.toISOString().split("T")[0] + '" title="Receipt Date (defaults to system date)" style="width:100%;min-width:140px"></td>' +
            '</tr>';
    });

    details.innerHTML =
        '<div class="group-detail-header">' +
            '<h4>' + name + (isGroupCompleted(group) ? ' <span style="font-size:14px;color:var(--accent)">✅ Completed</span>' : '') + '</h4>' +
            '<div class="meta">' +
                '<span class="meta-pill">💰 ' + fmt(group.totalAmount) + '</span>' +
                '<span class="meta-pill">📅 ' + group.months + ' months</span>' +
                '<span class="meta-pill">📆 Base/month: ' + fmt(base) + '</span>' +
                '<span class="meta-pill">🔼 Increment: ' + fmt(group.increment) + '</span>' +
                '<span class="meta-pill">🏷 Commission: 5%</span>' +
                '<span class="meta-pill">🔢 Month <b>' + group.currentMonth + '</b>/' + group.months + '</span>' +
                '<span class="meta-pill">📅 Start: ' + group.startDate + '</span>' +
                '<span class="meta-pill">⏭ Next: ' + nextTickStr + '</span>' +
            '</div>' +
        '</div>' +
        /* Dynamic summary row — Req #3 & #6 */
        '<div class="table-summary-bar" id="groupSummaryBar">' +
            '<span class="summary-chip chip-paid">Total Paid: <b id="grpSumPaid">' + fmt(totalPaidSum) + '</b></span>' +
            '<span class="summary-chip chip-due">Monthly Due: <b id="grpSumDue">' + fmt(totalDueSum) + '</b></span>' +
            '<span class="summary-chip chip-month">Visible: <b id="grpSumVisible">' + group.members.length + ' members</b></span>' +
        '</div>' +
        '<div class="member-search-wrap">' +
            '<input type="text" id="memberSearch" placeholder="🔍 Search member…" oninput="filterMembers(\'' + esc(name) + '\')">' +
        '</div>' +
        '<div class="table-wrap">' +
            '<table><thead><tr>' +
                '<th>Name (Phone)</th><th>Total Paid</th><th>Monthly Due</th>' +
                '<th>Overall Remaining</th><th>Penalty</th><th>Prize Payout</th>' +
                '<th>Taken?</th><th>Taken Date</th>' +
                '<th>Incharge</th>' +
                '<th>Add Payment</th><th class="narration-cell">Narration</th><th>receipt date</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div>' +
        '<div class="btn-row">' +
            '<button class="btn btn-primary" onclick="addAllPayments(\'' + esc(name) + '\')">➕ Add All Payments</button>' +
        '</div>';
}

/* ═══════════════════════════════════════════════════════════
   FILTER + TAKEN/MONTH SETTERS
   ═══════════════════════════════════════════════════════════ */
function filterMembers(groupName) {
    let query = (document.getElementById("memberSearch")?.value || "").toLowerCase();
    let group = groups[groupName];
    if (!group) return;
    let table = document.querySelector("#groupDetails table");
    if (!table) return;
    let rows = table.querySelectorAll("tbody tr");
    let visiblePaid = 0, visibleDue = 0, visibleCount = 0;
    rows.forEach(function(row, i) {
        let match = (row.children[0]?.innerText || "").toLowerCase().includes(query);
        row.style.display = match ? "" : "none";
        if (match) {
            let m = group.members[parseInt(row.dataset.memberIdx) || i];
            if (m) {
                visiblePaid += (m.totalPaid || 0);
                visibleDue  += Math.max(0, m.currentDue);
                visibleCount++;
            }
        }
    });
    // Update dynamic summary — Req #3
    let sp = document.getElementById("grpSumPaid");
    let sd = document.getElementById("grpSumDue");
    let sv = document.getElementById("grpSumVisible");
    if (sp) sp.textContent = fmt(visiblePaid);
    if (sd) sd.textContent = fmt(visibleDue);
    if (sv) sv.textContent = visibleCount + " member" + (visibleCount !== 1 ? "s" : "");
}
function setTaken(groupName, index, value) {
    let member = groups[groupName].members[index];
    member.taken = (value === "yes");
    if (!member.taken) { member.takenMonth = null; member.takenDate = null; }
    else if (member.taken && member.takenMonth !== null) {
        // Log payout when PS state entered — Req #4
        let payout = calcPayout(groups[groupName], member.takenMonth);
        logTransaction("payout", member.name, groupName, payout, "Member took chit (Month " + member.takenMonth + ")", systemDate.toISOString());
    }
    let tmInput = document.getElementById("takenMonth" + index);
    if (tmInput) tmInput.disabled = !member.taken;
    save();
}
function setTakenMonth(groupName, index, value) {
    let member = groups[groupName].members[index];
    let old = member.takenMonth;
    member.takenMonth = parseInt(value) || null;
    // Log payout transaction when month is set for a PS member — Req #4
    if (member.taken && member.takenMonth && member.takenMonth !== old) {
        let payout = calcPayout(groups[groupName], member.takenMonth);
        logTransaction("payout", member.name, groupName, payout, "Member took chit (Month " + member.takenMonth + ")", systemDate.toISOString());
    }
    save();
}
/* New: accept a date string, compute which month it falls in, store both */
function setTakenMonthFromDate(groupName, index, dateStr) {
    let group  = groups[groupName];
    let member = group.members[index];
    let old    = member.takenMonth;
    let computed = calcTakenMonthFromDate(group, dateStr);
    member.takenDate  = dateStr;       // store the raw date
    member.takenMonth = computed;      // store computed month number
    if (member.taken && computed && computed !== old) {
        let payout = calcPayout(group, computed);
        logTransaction("payout", member.name, groupName, payout,
            "Member took chit on " + dateStr + " (Month " + computed + ")", systemDate.toISOString());
    }
    save();
    // Refresh to show updated "Month X" label under the date input
    showGroup(groupName);
}
function clearTableSearch() {
    let box = document.getElementById("searchBox");
    if (box) { box.value = ""; }
    liveSearchTables();
}

function liveSearchTables() {
    let query = (document.getElementById("searchBox")?.value || "").toLowerCase().trim();
    let banner = document.getElementById("searchResultsBanner");

    // ── No query: restore normal group list, clear group detail ──────────
    if (!query) {
        document.querySelectorAll("#groupList .group-item").forEach(function(item) {
            item.style.display = "";
            // Remove any member-match highlight badges
            let badge = item.querySelector(".search-member-badge");
            if (badge) badge.remove();
        });
        // Restore member filter inside currently open group (show all rows)
        let table = document.querySelector("#groupDetails table");
        if (table) {
            table.querySelectorAll("tbody tr").forEach(function(r) { r.style.display = ""; });
        }
        // Reset the per-group memberSearch input if it exists
        let ms = document.getElementById("memberSearch");
        if (ms) ms.value = "";
        if (activeGroup && groups[activeGroup]) {
            // Re-run filterMembers with empty query to reset summary counts
            filterMembers(activeGroup);
        }
        if (banner) banner.style.display = "none";
        return;
    }

    // ── Build match map ────────────────────────────────────────────────────
    // For each group: does the group name match? Which members match?
    let groupNameMatches = [];    // group names whose title matches
    let memberMatchMap   = {};    // { groupName: [memberIndexes] }
    let totalMemberHits  = 0;

    for (let gName in groups) {
        let g = groups[gName];
        let groupHit = gName.toLowerCase().includes(query);
        let memberHits = [];

        g.members.forEach(function(m, idx) {
            if (m.name.toLowerCase().includes(query) ||
                (m.phone && m.phone.toLowerCase().includes(query))) {
                memberHits.push(idx);
            }
        });

        if (groupHit) groupNameMatches.push(gName);
        if (memberHits.length > 0) {
            memberMatchMap[gName] = memberHits;
            totalMemberHits += memberHits.length;
        }
    }

    // A group is visible if: its name matches OR it has member matches
    let visibleGroups = new Set([...groupNameMatches, ...Object.keys(memberMatchMap)]);

    // ── Update group list sidebar ──────────────────────────────────────────
    document.querySelectorAll("#groupList .group-item").forEach(function(item) {
        let gName = item.querySelector(".group-title")?.textContent || "";
        let isVisible = visibleGroups.has(gName);
        item.style.display = isVisible ? "" : "none";

        // Add/remove member-match badge
        let existingBadge = item.querySelector(".search-member-badge");
        if (existingBadge) existingBadge.remove();

        if (isVisible && memberMatchMap[gName] && !groupNameMatches.includes(gName)) {
            // Only member(s) matched — show count badge
            let badge = document.createElement("span");
            badge.className = "search-member-badge";
            badge.style.cssText = "font-size:11px;background:var(--primary);color:#fff;padding:2px 7px;border-radius:10px;margin-left:6px;font-weight:600;";
            badge.textContent = memberMatchMap[gName].length + " member" + (memberMatchMap[gName].length !== 1 ? "s" : "");
            let nameDiv = item.querySelector(".group-item-name");
            if (nameDiv) nameDiv.appendChild(badge);
        }
    });

    // ── Update banner ─────────────────────────────────────────────────────
    if (banner) {
        let parts = [];
        if (groupNameMatches.length > 0)
            parts.push(groupNameMatches.length + " group" + (groupNameMatches.length !== 1 ? "s" : "") + " matched");
        if (totalMemberHits > 0)
            parts.push(totalMemberHits + " member" + (totalMemberHits !== 1 ? "s" : "") + " found across " + Object.keys(memberMatchMap).length + " group" + (Object.keys(memberMatchMap).length !== 1 ? "s" : ""));
        if (parts.length === 0)
            parts.push('No results for \u201c' + query + '\u201d');
        banner.textContent = "🔍 " + parts.join(" · ");
        banner.style.display = "";
    }

    // ── If exactly one group is visible (or active group has hits), auto-show its detail ──
    let firstVisible = [...visibleGroups][0];

    // If the currently active group has member hits, filter its rows in place
    if (activeGroup && groups[activeGroup] && visibleGroups.has(activeGroup)) {
        _filterGroupDetailForSearch(activeGroup, query, memberMatchMap[activeGroup], groupNameMatches.includes(activeGroup));
    } else if (firstVisible) {
        // Auto-select and show the first matching group
        activeGroup = firstVisible;
        document.querySelectorAll("#groupList .group-item").forEach(function(el) { el.classList.remove("active"); });
        // Mark the matching list item active
        document.querySelectorAll("#groupList .group-item").forEach(function(item) {
            let gName = item.querySelector(".group-title")?.textContent || "";
            if (gName === firstVisible) item.classList.add("active");
        });
        showGroup(firstVisible);
        // After showGroup re-renders, filter member rows
        _filterGroupDetailForSearch(firstVisible, query, memberMatchMap[firstVisible], groupNameMatches.includes(firstVisible));
    }
}

/* Filter rows inside the currently displayed group detail.
   If groupNameMatch=true → show all rows (group name matched, show everything).
   If memberIdxs provided → show only those member rows, highlight them. */
function _filterGroupDetailForSearch(groupName, query, memberIdxs, groupNameMatch) {
    let table = document.querySelector("#groupDetails table");
    if (!table) return;
    let tbody = table.querySelector("tbody");
    if (!tbody) return;

    let visiblePaid = 0, visibleDue = 0, visibleCount = 0;
    let group = groups[groupName];

    tbody.querySelectorAll("tr").forEach(function(row) {
        let idx = parseInt(row.dataset.memberIdx);
        let show;
        if (groupNameMatch && (!memberIdxs || memberIdxs.length === 0)) {
            // Group name matched — show all
            show = true;
        } else if (memberIdxs && memberIdxs.length > 0) {
            // Member match — only show matched rows
            show = memberIdxs.includes(idx);
        } else {
            show = true;
        }
        row.style.display = show ? "" : "none";

        // Highlight matched rows
        row.style.background = (show && memberIdxs && memberIdxs.includes(idx) && !groupNameMatch)
            ? "var(--primary-dim, rgba(37,99,235,0.07))"
            : "";

        if (show && group) {
            let m = group.members[idx];
            if (m) {
                visiblePaid += (m.totalPaid || 0);
                visibleDue  += Math.max(0, m.currentDue);
                visibleCount++;
            }
        }
    });

    // Update summary chips
    let sp = document.getElementById("grpSumPaid");
    let sd = document.getElementById("grpSumDue");
    let sv = document.getElementById("grpSumVisible");
    if (sp) sp.textContent = fmt(visiblePaid);
    if (sd) sd.textContent = fmt(visibleDue);
    if (sv) sv.textContent = visibleCount + " member" + (visibleCount !== 1 ? "s" : "");
}

/* ═══════════════════════════════════════════════════════════
   DELETE / TRASH
   ═══════════════════════════════════════════════════════════ */
function deleteGroup(name) {
    if (!confirm('Move "' + name + '" to Trash?')) return;
    trash[name] = { data: groups[name], deletedAt: Date.now() };
    delete groups[name];
    if (activeGroup === name) {
        activeGroup = null;
        let det = document.getElementById("groupDetails");
        if (det) det.innerHTML = "";
    }
    save(); displayGroups(); displayTrash();
    showToast('🗑 "' + name + '" moved to Trash', "info");
}
function displayTrash() {
    let list = document.getElementById("trashList");
    if (!list) return;
    list.innerHTML = "";
    if (Object.keys(trash).length === 0) { list.innerHTML = '<div class="trash-empty">✨ Trash is empty</div>'; return; }
    for (let name in trash) {
        let deletedAgo = Math.floor((Date.now() - trash[name].deletedAt) / 3600000);
        let div = document.createElement("div");
        div.className = "trash-item";
        div.innerHTML = '<div><div class="trash-item-name">' + name + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">Deleted ' + deletedAgo + 'h ago</div></div>' +
            '<div class="trash-actions">' +
            '<button class="btn btn-success" onclick="restoreGroup(\'' + esc(name) + '\')">↩ Restore</button>' +
            '<button class="btn btn-danger"  onclick="permanentDelete(\'' + esc(name) + '\')">🗑 Delete</button>' +
            '</div>';
        list.appendChild(div);
    }
}
function restoreGroup(name) {
    groups[name] = trash[name].data; delete trash[name];
    save(); displayGroups(); displayTrash();
    showToast('✅ "' + name + '" restored', "success");
}
function permanentDelete(name) {
    if (!confirm('Permanently delete "' + name + '"? This cannot be undone.')) return;
    delete trash[name]; save(); displayTrash();
    showToast('🗑 Permanently deleted "' + name + '"', "info");
}
function cleanTrash() {
    let twoDays = 2 * 24 * 60 * 60 * 1000;
    for (let name in trash) if (Date.now() - trash[name].deletedAt > twoDays) delete trash[name];
    save();
}

/* ═══════════════════════════════════════════════════════════
   REMINDERS
   ═══════════════════════════════════════════════════════════ */
function getReminderUrgency(dateStr) {
    let today = new Date(); today.setHours(0,0,0,0);
    let remDate = new Date(dateStr); remDate.setHours(0,0,0,0);
    let d = Math.round((remDate - today) / 86400000);
    if (d < 0)  return { label:"Overdue",  cls:"rem-overdue",  days:d };
    if (d <= 2) return { label:"Urgent",   cls:"rem-urgent",   days:d };
    if (d <= 7) return { label:"Soon",     cls:"rem-soon",     days:d };
    return            { label:"Upcoming", cls:"rem-upcoming", days:d };
}
function addReminder() {
    let title = document.getElementById("remTitle").value.trim();
    let date  = document.getElementById("remDate").value;
    let note  = document.getElementById("remNote").value.trim();
    if (!title) { showToast("⚠️ Enter a reminder title","warning"); return; }
    if (!date)  { showToast("⚠️ Select a date","warning");          return; }
    reminders.push({ id: Date.now(), title, date, note });
    save();
    document.getElementById("remTitle").value = "";
    document.getElementById("remDate").value  = new Date().toISOString().split("T")[0];
    document.getElementById("remNote").value  = "";
    displayReminders(); showToast("✅ Reminder added!", "success");
}
function deleteReminder(id) {
    reminders = reminders.filter(function(r) { return r.id !== id; });
    save(); displayReminders(); renderHomeReminders();
    showToast("🗑 Reminder deleted", "info");
}
function dismissReminder(id) {
    reminders = reminders.filter(function(r) { return r.id !== id; });
    save(); renderHomeReminders(); displayReminders();
}
function displayReminders() {
    let container = document.getElementById("reminderList");
    if (!container) return;
    let sorted = [...reminders].sort(function(a,b) { return new Date(a.date)-new Date(b.date); });
    if (sorted.length === 0) { container.innerHTML = '<div class="rem-empty">📭 No reminders yet. Add one above!</div>'; return; }
    container.innerHTML = sorted.map(function(r) {
        let urg = getReminderUrgency(r.date);
        let dateLabel = new Date(r.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
        let daysLabel = urg.days < 0 ? Math.abs(urg.days)+"day"+(Math.abs(urg.days)!==1?"s":"")+" ago"
            : urg.days === 0 ? "Today" : "in "+urg.days+" day"+(urg.days!==1?"s":"");
        return '<div class="reminder-item ' + urg.cls + '">' +
            '<div class="rem-left"><div class="rem-title">' + r.title + '</div>' +
            (r.note ? '<div class="rem-note">' + r.note + '</div>' : '') +
            '<div class="rem-meta"><span>📅 ' + dateLabel + '</span>' +
            '<span class="rem-urgency-tag ' + urg.cls + '-tag">' + urg.label + ' · ' + daysLabel + '</span></div></div>' +
            '<button class="btn btn-danger" onclick="deleteReminder(' + r.id + ')">🗑</button></div>';
    }).join("");
}
function renderHomeReminders() {
    let container = document.getElementById("homeReminders");
    if (!container) return;
    let active = [...reminders].sort(function(a,b) { return new Date(a.date)-new Date(b.date); });
    if (active.length === 0) { container.innerHTML = '<div class="home-rem-empty">🎉 No pending reminders</div>'; return; }
    container.innerHTML = active.map(function(r) {
        let urg = getReminderUrgency(r.date);
        let dateLabel = new Date(r.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
        let daysLabel = urg.days<0 ? Math.abs(urg.days)+"d overdue" : urg.days===0 ? "Today!" : urg.days+"d left";
        return '<div class="home-notif ' + urg.cls + '">' +
            '<div class="notif-icon">' + (urg.days<0?"🔴":urg.days<=2?"🟠":urg.days<=7?"🟡":"🟢") + '</div>' +
            '<div class="notif-body"><div class="notif-title">' + r.title + '</div>' +
            (r.note ? '<div class="notif-note">' + r.note + '</div>' : '') +
            '<div class="notif-date">📅 ' + dateLabel + ' · <strong>' + daysLabel + '</strong></div></div>' +
            '<button class="notif-dismiss" onclick="dismissReminder(' + r.id + ')" title="Dismiss">✕</button></div>';
    }).join("");
}

/* ═══════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════ */
function showToast(msg, type) {
    let existing = document.getElementById("chitToast");
    if (existing) existing.remove();
    let colors = { success:"#059669", error:"#dc2626", warning:"#f59e0b", info:"#2563eb" };
    let toast  = document.createElement("div");
    toast.id   = "chitToast";
    toast.textContent = msg;
    Object.assign(toast.style, {
        position:"fixed", bottom:"24px", right:"24px",
        background: colors[type] || "#1e293b", color:"#fff",
        padding:"12px 20px", borderRadius:"10px", fontSize:"14px",
        fontWeight:"600", boxShadow:"0 4px 20px rgba(0,0,0,0.25)",
        zIndex:"9999", transition:"opacity 0.3s", maxWidth:"320px"
    });
    document.body.appendChild(toast);
    setTimeout(function(){ toast.style.opacity="0"; }, 2400);
    setTimeout(function(){ toast.remove(); }, 2700);
}

/* ═══════════════════════════════════════════════════════════
   DUE LIST  — PS/NPS display logic (Req #1)
   ═══════════════════════════════════════════════════════════ */
function getDueMembers(filterMode, filterCompleted) {
    let dueList = [];
    for (let groupName in groups) {
        let group = groups[groupName], completed = isGroupCompleted(group);
        if (filterCompleted === 'ongoing'   && completed)  continue;
        if (filterCompleted === 'completed' && !completed) continue;
        group.members.forEach(function(member, idx) {
            if (filterMode === 'ps'  && !member.taken) return;
            if (filterMode === 'nps' &&  member.taken) return;
            // SOURCE OF TRUTH: always use member.currentDue and member.penalty
            let dueAmount  = Math.max(0, member.currentDue || 0);
            let penaltyAmt = member.penalty || 0;
            // Only include members who have a pending due OR a pending penalty
            if (dueAmount > 0 || penaltyAmt > 0) {
                let pct      = getPenaltyRate(groupName, idx);
                let expected = getExpectedTillNow(group, member);
                let paid     = member.totalPaid || 0;
                dueList.push({ groupName, group, member, expected, paid,
                    dueAmount: dueAmount, memberIndex: idx,
                    penaltyPct: pct, penaltyAmt: penaltyAmt });
            }
        });
    }
    return dueList;
}

function _filterDueRows() {
    let q = (window._dueSearch || '').toLowerCase().trim();
    let tbody = document.querySelector('#dueTable tbody');
    if (!tbody) return;
    let visibleDue = 0, visibleCount = 0;
    tbody.querySelectorAll('tr[data-member]').forEach(function(tr) {
        let show = true;
        if (q) {
            let member = (tr.dataset.member || '').toLowerCase();
            let group  = (tr.dataset.group  || '').toLowerCase();
            show = member.includes(q) || group.includes(q);
        }
        tr.style.display = show ? '' : 'none';
        if (show) {
            visibleDue += parseFloat(tr.dataset.due || 0);
            visibleCount++;
        }
    });
    // Req #3 — dynamic total update
    let countEl = document.getElementById('dueVisibleCount');
    if (countEl) countEl.textContent = visibleCount + ' member' + (visibleCount!==1?'s':'');
    let totalPill = document.getElementById('dueTotalPill');
    if (totalPill) totalPill.innerHTML = 'Visible Due: <b>' + fmt(visibleDue) + '</b>';
}

function showDueList() {
    let content         = document.getElementById("contentArea");
    let filterMode      = window._dueFilter    || 'all';
    let filterCompleted = window._dueCompleted || 'all';
    let searchQuery     = window._dueSearch    || '';
    let dueMembers      = getDueMembers(filterMode, filterCompleted);
    let totalDue        = dueMembers.reduce(function(s,d) { return s+d.dueAmount; }, 0);

    let existingTable = document.getElementById('dueTable');
    if (existingTable) {
        _rebuildDueRows(dueMembers, totalDue);
        _updateDueFilterBtns(filterMode, filterCompleted);
        _filterDueRows();
        return;
    }

    let filterBar =
        '<div class="card due-filter-card">' +
        '<div class="due-filter-top">' +
            '<div class="due-filter-group">' +
                '<span class="filter-label">Status:</span>' +
                ['all','ps','nps'].map(function(f) {
                    return '<button id="dueF_' + f + '" class="btn ' + (filterMode===f?'btn-primary':'btn-secondary') + ' btn-sm" onclick="window._dueFilter=\'' + f + '\';showDueList()">' + f.toUpperCase() + '</button>';
                }).join('') +
            '</div>' +
            '<div class="due-filter-group">' +
                '<span class="filter-label">Group:</span>' +
                ['all','ongoing','completed'].map(function(f) {
                    return '<button id="dueC_' + f + '" class="btn ' + (filterCompleted===f?'btn-primary':'btn-secondary') + ' btn-sm" onclick="window._dueCompleted=\'' + f + '\';showDueList()">' + f.charAt(0).toUpperCase()+f.slice(1) + '</button>';
                }).join('') +
            '</div>' +
            '<button class="btn btn-ghost btn-sm" onclick="printDueList()">🖨️ Print / Export PDF</button>' +
        '</div>' +
        '<div class="due-search-row">' +
            '<input type="text" id="dueSearchInput" placeholder="🔍 Search by member name or group name…" value="' + (searchQuery||'') + '" oninput="window._dueSearch=this.value;_filterDueRows()">' +
            '<button class="btn btn-secondary btn-sm" onclick="window._dueSearch=\'\';document.getElementById(\'dueSearchInput\').value=\'\';_filterDueRows()">✕ Clear</button>' +
        '</div>' +
        '</div>';

    let tableCard =
        '<div class="card">' +
        '<div class="card-header">' +
            '<div class="section-title">⚠️ Due List</div>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                '<span class="meta-pill" style="color:var(--danger)" id="dueTotalPill">Visible Due: <b>' + fmt(totalDue) + '</b></span>' +
                '<span class="meta-pill" id="dueVisibleCount">' + dueMembers.length + ' member' + (dueMembers.length!==1?'s':'') + '</span>' +
            '</div>' +
        '</div>' +
        /* Column header changes based on which filter is active */
        '<div class="table-wrap"><table id="dueTable">' +
            '<thead><tr>' +
                '<th>#</th><th>Member</th><th>Group</th><th>Incharge</th>' +
                '<th>Running Month</th><th>Status</th>' +
                '<th id="dynColHeader">' + (filterMode === 'ps' ? 'Future liability' : filterMode === 'nps' ? 'Amount Paid So Far' : '💸 Paid / Still To Pay') + '</th>' +
                '<th>Expected So Far</th><th>Penalty %</th><th>Current Due</th><th>Total amount</th>' +
                '<th style="background:var(--th-bg);color:#fbbf24;font-weight:700">Future due liability</th>' +
            '</tr></thead>' +
            '<tbody id="dueTableBody"></tbody>' +
        '</table></div></div>';

    content.innerHTML = filterBar + tableCard;
    _rebuildDueRows(dueMembers, totalDue);
    _filterDueRows();
}

function _updateDueFilterBtns(filterMode, filterCompleted) {
    ['all','ps','nps'].forEach(function(f) {
        let btn = document.getElementById('dueF_' + f);
        if (btn) { btn.className = 'btn btn-sm ' + (filterMode===f?'btn-primary':'btn-secondary'); }
    });
    ['all','ongoing','completed'].forEach(function(f) {
        let btn = document.getElementById('dueC_' + f);
        if (btn) { btn.className = 'btn btn-sm ' + (filterCompleted===f?'btn-primary':'btn-secondary'); }
    });
}

function _rebuildDueRows(dueMembers, totalDue) {
    let tbody = document.getElementById('dueTableBody');
    if (!tbody) return;
    let totalPill = document.getElementById('dueTotalPill');
    if (totalPill) totalPill.innerHTML = 'Visible Due: <b>' + fmt(totalDue) + '</b>';

    /* Update the dynamic column header to match the active filter */
    let dynHeader = document.getElementById('dynColHeader');
    if (dynHeader) {
        let fm = window._dueFilter || 'all';
        dynHeader.textContent = fm === 'ps' ? 'Future liability'
            : fm === 'nps' ? 'Amount Paid So Far'
            : '💸 Paid / Still To Pay';
    }

    if (dueMembers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:20px">✅ No dues — all members are up to date 🎉</td></tr>';
        return;
    }

    let rows = dueMembers.map(function(d, i) {
        let m = d.member, isPS = m.taken;
        let penaltyPct = d.penaltyPct || 0;
        let penaltyAmt = d.penaltyAmt || 0;
        let paid = m.totalPaid || 0;
        let expected = getExpectedTillNow(d.group, m);

        /* PS → total remaining instalments from takenMonth+1 to last month (minus what already paid after taking)
           NPS → total paid so far */
        let dynamicColLabel, dynamicColVal;
        if (isPS) {
            let stillToPay = getPS_StillToPay(d.group, m);
            let totalAfterTaking = d.group.months - (m.takenMonth || 0);
            dynamicColLabel = 'Still to pay (M' + ((m.takenMonth||0)+1) + '→M' + d.group.months + ')';
            dynamicColVal = '<span style="color:var(--danger);font-weight:700">' + fmt(stillToPay) + '</span>' +
                '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' +
                    'Took M' + (m.takenMonth||'?') + ' · Payout: ' + fmt(calcPayout(d.group, m.takenMonth||1)) +
                '</div>';
        } else {
            dynamicColLabel = 'Total paid so far';
            dynamicColVal = '<span style="color:var(--accent);font-weight:700">' + fmt(paid) + '</span>' +
                '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' +
                    'of expected ' + fmt(expected) +
                '</div>';
        }

        let statusBadge = isPS
            ? '<span class="badge-status badge-ps">PS</span>'
            : '<span class="badge-status badge-nps">NPS</span>';

        let psInfo = isPS
            ? '<div class="due-sub-info">Taken M' + m.takenMonth + '</div>'
            : '<div class="due-sub-info">NPS member</div>';

        let penaltyCell = '<div class="penalty-edit-cell">' +
            (penaltyPct > 0
                ? '<span class="penalty-badge">' + penaltyPct + '% = ' + fmt(penaltyAmt) + '</span>'
                : '<span style="color:var(--text-muted);font-size:12px">—</span>') +
            '<div class="penalty-input-row">' +
                '<input type="number" min="0" max="100" step="0.5" placeholder="%" value="' + (penaltyPct||'') + '"' +
                ' id="penPct_' + i + '" title="Set penalty %">' +
                '<button class="btn btn-sm btn-ghost" style="padding:5px 10px;font-size:12px" ' +
                'onclick="setMemberPenaltyPct(\'' + esc(d.groupName) + '\',' + d.memberIndex + ',document.getElementById(\'penPct_' + i + '\').value)">Set</button>' +
            '</div>' +
        '</div>';

        // Total Payable (PS only): still-to-pay future instalments + current due + penalty
        let totalPayableCell;
        if (isPS) {
        
            let stillToPay  = getPS_StillToPay(d.group, m);   // future payments
            let currentDue  = Math.max(0, m.currentDue || 0); // current due
            let penaltyAmt2 = m.penalty || 0;                 // penalty
        
            let totalPayable = stillToPay + currentDue + penaltyAmt2;
        
            totalPayableCell =
                '<span style="font-size:15px;font-weight:800;color:var(--danger)">' + fmt(totalPayable) + '</span>' +
                '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;line-height:1.5">' +
                    'Future: ' + fmt(stillToPay) + '<br>' +
                    'Due: ' + fmt(currentDue) +
                    (penaltyAmt2 > 0 ? '<br>Penalty: ' + fmt(penaltyAmt2) : '') +
                '</div>';
        
        } else {
            totalPayableCell = '<span style="color:var(--text-muted);font-size:12px">—</span>';
        }

        return '<tr data-member="' + (m.name||'').toLowerCase() + '" data-group="' + (d.groupName||'').toLowerCase() + '" data-due="' + d.dueAmount + '">' +
            '<td style="text-align:center;width:40px">' + (i+1) + '</td>' +
            '<td><strong>' + m.name + '</strong> <span style="color:var(--text-muted);font-size:12px">(' + m.phone + ')</span></td>' +
            '<td>' + d.groupName + '<div style="font-size:11px;color:var(--text-muted)">Start: ' + d.group.startDate + '</div></td>' +
            '<td>' + (m.worker || '<span style="color:var(--text-muted)">—</span>') + '</td>' +
            '<td><span class="meta-pill" style="font-size:11px">M' + d.group.currentMonth + ' / ' + d.group.months + '</span></td>' +
            '<td>' + statusBadge + psInfo + '</td>' +
            '<td>' + dynamicColVal + '<div class="due-sub-info" style="color:var(--text-muted)">' + dynamicColLabel + '</div></td>' +
            '<td style="color:var(--text-muted)">' + fmt(d.expected) + '</td>' +
            '<td>' + penaltyCell + '</td>' +
            '<td style="color:var(--danger);font-weight:700">' + fmt(d.dueAmount) + '</td>' +
            '<td>' + fmt(getTotalExpected(d.group, m)) + '</td>' +
            '<td style="white-space:nowrap">' + totalPayableCell + '</td>' +
            '</tr>';
    }).join("");

    tbody.innerHTML = rows;
}

function printDueList() {
    let filterMode = window._dueFilter || 'all', filterCompleted = window._dueCompleted || 'all';
    let dueMembers = getDueMembers(filterMode, filterCompleted);
    let totalDue   = dueMembers.reduce(function(s,d) { return s+d.dueAmount; }, 0);
    let today      = new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
    let rows = dueMembers.map(function(d,i) {
        let m = d.member, penalty = m.penalty || 0, pct = d.penaltyPct || 0;
        let isPS = m.taken;
        let dynamicVal = isPS ? getTotalRemaining(d.group, m) : (m.totalPaid || 0);
        let dynamicLabel = isPS ? "Remaining" : "Paid";
        return '<tr><td>' + (i+1) + '</td><td>' + m.name + '</td><td>' + m.phone + '</td>' +
            '<td>' + d.groupName + '</td><td>' + d.group.startDate + '</td>' +
            '<td>' + (m.worker||'—') + '</td>' +
            '<td>Month ' + d.group.currentMonth + '/' + d.group.months + '</td>' +
            '<td>' + (isPS?'PS':'NPS') + '</td>' +
            '<td>' + dynamicLabel + ': ₹' + dynamicVal.toLocaleString('en-IN') + '</td>' +
            '<td>' + (pct>0?pct+'% ('+fmt(penalty)+')':'—') + '</td>' +
            '<td style="color:#dc2626;font-weight:700">₹' + d.dueAmount.toLocaleString('en-IN') + '</td></tr>';
    }).join('');
    let w = window.open('','_blank');
    w.document.write('<!DOCTYPE html><html><head><title>Due List — ' + today + '</title>' +
        '<style>body{font-family:"Segoe UI",sans-serif;padding:24px;color:#1a1d23}h1{font-size:22px;margin-bottom:4px}.sub{color:#6b7280;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#1e293b;color:#e2e8f0;padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}td{padding:9px 12px;border-bottom:1px solid #e2e5ea}tr:nth-child(even) td{background:#f7f8fa}.total{margin-top:14px;font-size:15px;font-weight:700;color:#dc2626}@media print{body{padding:0}}</style>' +
        '</head><body><h1>RR Kakatiya Chit Fund — Due List</h1>' +
        '<div class="sub">Generated: ' + today + ' · Filter: ' + filterMode.toUpperCase() + ' / ' + filterCompleted + '</div>' +
        '<table><thead><tr><th>#</th><th>Member</th><th>Phone</th><th>Group</th><th>Start Date</th><th>Worker</th><th>Running Month</th><th>Status</th><th>PS: Remaining / NPS: Paid</th><th>Penalty</th><th>Current Due</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<div class="total">Total Outstanding: ₹' + totalDue.toLocaleString('en-IN') + '</div>' +
        '<script>window.onload=function(){window.print();}<\/script></body></html>');
    w.document.close();
}

/* ═══════════════════════════════════════════════════════════
   PENALTY LIST PAGE  (Req #5 — Dedicated Module)
   ═══════════════════════════════════════════════════════════ */
function showPenaltyList() {
    let content = document.getElementById("contentArea");
    let searchQ = (window._penaltySearch || '').toLowerCase();

    /* Collect all members with penalty info */
    let penaltyMembers = [];
    for (let gn in groups) {
        let g = groups[gn];
        g.members.forEach(function(m, idx) {
            penaltyMembers.push({
                groupName: gn, group: g, member: m, memberIndex: idx,
                penaltyAmt: m.penalty || 0,
                penaltyPct: getPenaltyRate(gn, idx)
            });
        });
    }
    let totalPenalty = penaltyMembers.reduce(function(s,p){ return s + p.penaltyAmt; }, 0);

    let existingTable = document.getElementById('penaltyTable');
    if (existingTable) {
        _rebuildPenaltyRows(penaltyMembers, totalPenalty);
        _filterPenaltyRows();
        return;
    }

    content.innerHTML =
        '<div class="card due-filter-card">' +
        '<div class="due-search-row">' +
            '<input type="text" id="penaltySearchInput" placeholder="🔍 Search member or group…" value="' + (searchQ||'') + '" oninput="window._penaltySearch=this.value;_filterPenaltyRows()">' +
            '<button class="btn btn-secondary btn-sm" onclick="window._penaltySearch=\'\';document.getElementById(\'penaltySearchInput\').value=\'\';_filterPenaltyRows()">✕ Clear</button>' +
        '</div>' +
        '</div>' +
        '<div class="card">' +
        '<div class="card-header">' +
            '<div class="section-title">⚡ Penalty List</div>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                '<span class="meta-pill" style="color:var(--danger)" id="penTotalPill">Total Penalty: <b>' + fmt(totalPenalty) + '</b></span>' +
                '<span class="meta-pill" id="penVisibleCount">' + penaltyMembers.length + ' members</span>' +
            '</div>' +
        '</div>' +
        '<div class="table-wrap"><table id="penaltyTable">' +
            '<thead><tr>' +
                '<th>#</th><th>Member</th><th>Group</th><th>Incharge</th>' +
                '<th>Status</th><th title="Penalty is calculated only on this amount (unpaid from previous months)">Prev. Due (Penalty Basis) ⓘ</th>' +
                '<th>Penalty %</th><th>Penalty Amount</th><th>Actions</th>' +
            '</tr></thead>' +
            '<tbody id="penaltyTableBody"></tbody>' +
        '</table></div></div>';

    _rebuildPenaltyRows(penaltyMembers, totalPenalty);
    _filterPenaltyRows();
}
function _rebuildPenaltyRows(penaltyMembers, totalPenalty) {
    let tbody = document.getElementById('penaltyTableBody');
    if (!tbody) return;
    let pill = document.getElementById('penTotalPill');
    if (pill) pill.innerHTML = 'Total Penalty: <b>' + fmt(totalPenalty) + '</b>';

    if (penaltyMembers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">No members found</td></tr>';
        return;
    }
    tbody.innerHTML = penaltyMembers.map(function(p, i) {
        let m = p.member, gn = p.groupName;
        let prevDue    = Math.max(0, m.previousDue || 0);
        let currMonthDue = Math.max(0, m.currentMonthDue || 0);
        let currentDue = Math.max(0, m.currentDue);
        let isPS = m.taken;
        return '<tr data-member="' + (m.name||'').toLowerCase() + '" data-group="' + gn.toLowerCase() + '" data-penalty="' + p.penaltyAmt + '">' +
            '<td style="text-align:center;width:40px">' + (i+1) + '</td>' +
            '<td><strong>' + m.name + '</strong><br><span style="color:var(--text-muted);font-size:11px">' + m.phone + '</span></td>' +
            '<td>' + gn + '</td>' +
            '<td>' + (m.worker || '—') + '</td>' +
            '<td>' + (isPS ? '<span class="badge-status badge-ps">PS</span>' : '<span class="badge-status badge-nps">NPS</span>') + '</td>' +
            '<td class="' + (prevDue > 0 ? 'due-full' : 'due-zero') + '">' +
                fmt(prevDue) +
                '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' +
                    'curr month: ' + fmt(currMonthDue) +
                    ' | total: ' + fmt(currentDue) +
                '</div>' +
            '</td>' +
            '<td>' +
                '<div class="penalty-input-row">' +
                '<input type="number" min="0" max="100" step="0.5" placeholder="%" value="' + (p.penaltyPct||'') + '"' +
                ' id="penP_' + i + '" style="width:68px;padding:5px 8px;font-size:12px">' +
                '<button class="btn btn-sm btn-ghost" onclick="setMemberPenaltyPct(\'' + esc(gn) + '\',' + p.memberIndex + ',document.getElementById(\'penP_' + i + '\').value)">%</button>' +
                '</div>' +
            '</td>' +
            '<td>' +
                '<div class="penalty-input-row">' +
                '<input type="number" min="0" step="0.01" placeholder="₹ amount" value="' + (p.penaltyAmt > 0 ? p.penaltyAmt.toFixed(2) : '') + '"' +
                ' id="penA_' + i + '" style="width:100px;padding:5px 8px;font-size:12px">' +
                '<button class="btn btn-sm btn-ghost" onclick="setPenaltyDirect(\'' + esc(gn) + '\',' + p.memberIndex + ',document.getElementById(\'penA_' + i + '\').value)">Set</button>' +
                '</div>' +
                (p.penaltyAmt > 0 ? '<span class="penalty-badge" style="margin-top:4px;display:inline-block">' + fmt(p.penaltyAmt) + '</span>' : '<span style="color:var(--text-muted);font-size:12px">No penalty</span>') +
            '</td>' +
            '<td>' +
                '<button class="btn btn-sm btn-danger" onclick="clearMemberPenalty(\'' + esc(gn) + '\',' + p.memberIndex + ')">Clear</button>' +
            '</td>' +
            '</tr>';
    }).join('');
}
function _filterPenaltyRows() {
    let q = (window._penaltySearch || '').toLowerCase().trim();
    let tbody = document.querySelector('#penaltyTable tbody');
    if (!tbody) return;
    let visiblePenalty = 0, visibleCount = 0;
    tbody.querySelectorAll('tr[data-member]').forEach(function(tr) {
        let show = !q || (tr.dataset.member||'').includes(q) || (tr.dataset.group||'').includes(q);
        tr.style.display = show ? '' : 'none';
        if (show) { visiblePenalty += parseFloat(tr.dataset.penalty || 0); visibleCount++; }
    });
    let pill = document.getElementById('penTotalPill');
    if (pill) pill.innerHTML = 'Visible Penalty: <b>' + fmt(visiblePenalty) + '</b>';
    let cnt = document.getElementById('penVisibleCount');
    if (cnt) cnt.textContent = visibleCount + ' members';
}
function clearMemberPenalty(groupName, memberIndex) {
    let g = groups[groupName]; if (!g) return;
    let m = g.members[memberIndex]; if (!m) return;
    m.penalty = 0;
    delete penaltyRates[penaltyKey(groupName, memberIndex)];
    save();
    showToast("✅ Penalty cleared for " + m.name, "success");
    showPenaltyList();
}

/* ═══════════════════════════════════════════════════════════
   ADMIN DASHBOARD  (Req #4 — net financial logic)
   ═══════════════════════════════════════════════════════════ */
function buildDashboard() {
    let netCollected   = calcNetCollected();
    let totalPaidOut   = calcTotalPaidOut();
    let activeDue      = calcActiveDue();
    let txCount        = transactions.length;
    let completedGroups = 0;
    let recentTx = [];

    for (let gName in groups) {
        let g = groups[gName];
        if (isGroupCompleted(g)) completedGroups++;
        g.members.forEach(function(m) {
            (m.history || []).forEach(function(h) {
                recentTx.push({ name: m.name, group: gName, amount: h.amount, date: h.receiptDate || h.date, receiptDate: h.receiptDate || h.date, narration: h.narration || "" });
            });
        });
    }
    // Also include transaction log entries
    transactions.filter(function(t){ return t.type === "payout"; }).forEach(function(t) {
        recentTx.push({ name: t.member, group: t.group, amount: -t.amount, date: t.date, narration: "💰 Payout: " + t.reason });
    });
    recentTx.sort(function(a,b) { return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date); });
    let recentRows = recentTx.slice(0,10).length
        ? recentTx.slice(0,10).map(function(t) {
            let d = new Date(t.receiptDate || t.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
            let amtStyle = t.amount < 0 ? 'color:var(--danger)' : 'color:var(--accent)';
            return '<tr><td>' + t.name + '</td>' +
                '<td style="font-size:11px;color:var(--text-muted)">' + t.group + '</td>' +
                '<td style="' + amtStyle + ';font-weight:700">' + (t.amount < 0 ? '−' : '+') + fmt(Math.abs(t.amount)) + '</td>' +
                '<td style="font-size:11px;color:var(--text-muted)">' + d + '</td>' +
                '<td style="font-size:11px;color:var(--text-muted);white-space:normal;word-break:break-word;max-width:260px">' + (t.narration || '—') + '</td></tr>';
        }).join("")
        : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:12px">No transactions yet</td></tr>';

    function dashCard(icon, label, value, color) {
        return '<div class="stat-card"><div style="font-size:22px;margin-bottom:4px">' + icon + '</div>' +
            '<div class="stat-num" style="color:' + color + ';font-size:20px">' + value + '</div>' +
            '<div class="stat-label">' + label + '</div></div>';
    }
    let totalGroups = Object.keys(groups).length;
    let totalManaged = Object.values(groups).reduce(function(s,g){return s+g.totalAmount;},0);
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:20px">' +
        dashCard("💰","Net Collected",     fmt(netCollected),   "var(--accent)") +
        dashCard("📊","Total Managed",     fmt(totalManaged),   "var(--primary)") +
        dashCard("💸","Total Paid Out",    fmt(totalPaidOut),   "#ea580c") +
        dashCard("⚠️","Active Dues",       fmt(activeDue),      "var(--danger)") +
        dashCard("📁","Active Groups",     totalGroups - completedGroups, "var(--accent)") +
        dashCard("✅","Completed Groups",  completedGroups,     "var(--text-muted)") +
        dashCard("🧾","Transactions",      txCount,             "var(--primary)") +
    '</div>' +
    '<div class="section-title" style="margin-bottom:10px">🕐 Recent Activity</div>' +
    '<div class="table-wrap"><table style="font-size:13px">' +
        '<thead><tr><th>Member</th><th>Group</th><th>Amount</th><th>Date</th><th class="narration-cell">Note</th></tr></thead>' +
        '<tbody>' + recentRows + '</tbody>' +
    '</table></div>';
}

/* ═══════════════════════════════════════════════════════════
   WORKERS PAGE  (Req #2 — unified group references)
   ═══════════════════════════════════════════════════════════ */
function showWorkersPage() {
    let content      = document.getElementById("contentArea");
    let workers      = getAllWorkers();
    let workerOptions = workers.map(function(w) { return '<option value="'+w+'">'+w+'</option>'; }).join('');
    let groupOptions  = Object.keys(groups).map(function(g) { return '<option value="'+g+'">'+g+'</option>'; }).join('');

    content.innerHTML =
        '<div class="card">' +
        '<div class="card-header"><div class="section-title">👨‍💼 Incharge Management</div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
            '<div class="field"><label>Search by Worker Name</label>' +
                '<input type="text" id="workerSearchInput" list="workersList" placeholder="Type or pick a worker" oninput="workerSearch()">' +
                '<datalist id="workersList">' + workerOptions + '</datalist>' +
            '</div>' +
            '<div class="field"><label>Search by Group Name</label>' +
                '<select id="workerGroupFilter" onchange="workerGroupSearch()" style="width:100%;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:inherit;font-size:14px;outline:none">' +
                    '<option value="">— Select a group —</option>' + groupOptions +
                '</select>' +
            '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:4px">' +
            '<button class="btn btn-secondary" onclick="clearWorkerSearch()">✕ Clear</button>' +
            '<button class="btn btn-ghost" onclick="printWorkerView()" id="workerPrintBtn" style="display:none">🖨️ Print</button>' +
        '</div></div>' +
        '<div id="workerResults"></div>';
}

function startEditWorkerName(oldName) {
    let newName = prompt('Rename worker "' + oldName + '" to:', oldName);
    if (newName === null || newName.trim() === oldName || newName.trim() === '') return;
    newName = newName.trim();
    let count = 0;
    for (let gName in groups) {
        groups[gName].members.forEach(function(m) {
            if ((m.worker||'').trim() === oldName) { m.worker = newName; count++; }
        });
    }
    save();
    showToast('✅ Renamed ' + count + ' member(s) from "' + oldName + '" to "' + newName + '"', 'success');
    showAllWorkers();
}
function showAllWorkers() {
    let workers = getAllWorkers();
    if (!workers.length) return;
    let results = document.getElementById("workerResults");
    if (!results) return;
    let html = '';
    workers.forEach(function(workerName) {
        let matches = getAllMembersFlat().filter(function(r){ return (r.member.worker||'').trim() === workerName; });
        let safeW = esc(workerName);
        let rows = matches.map(function(r) {
            let m = r.member, mIdx = r.group.members.indexOf(m);
            return workerRowHtml(m, r.groupName, mIdx);
        }).join('');
        html += workerGroupCard(workerName, safeW, matches.length, rows);
    });
    results.innerHTML = html;
}
function workerRowHtml(m, groupName, mIdx) {
    return '<tr>' +
        '<td><strong>' + m.name + '</strong> <span style="color:var(--text-muted);font-size:12px">(' + m.phone + ')</span></td>' +
        '<td>' + groupName + '</td>' +
        '<td class="paid-cell">' + fmt(m.totalPaid||0) + '</td>' +
        '<td class="' + (Math.max(0,m.currentDue)>0?'due-full':'due-zero') + '">' + fmt(Math.max(0,m.currentDue)) + '</td>' +
        '<td>' + (m.penalty>0?'<span class="penalty-badge">'+fmt(m.penalty)+'</span>':'—') + '</td>' +
        '<td><input type="text" class="worker-inline-input" value="' + (m.worker||'') + '" placeholder="Worker…"' +
            ' onchange="updateMemberWorker(\'' + esc(groupName) + '\',' + mIdx + ',this.value)" style="width:130px"></td>' +
        '<td><span class="status-dot ' + (m.taken?'dot-yellow':'dot-red') + '"></span>' +
            '<span style="font-size:11px;color:var(--text-muted);margin-left:5px">' + (m.taken?'PS':'NPS') + '</span></td>' +
        '</tr>';
}
function workerGroupCard(workerName, safeW, count, rows) {
    return '<div class="card" style="margin-bottom:16px">' +
        '<div class="card-header">' +
            '<div class="section-title">👷 ' + workerName +
                ' <button class="btn btn-ghost btn-sm" onclick="startEditWorkerName(\'' + safeW + '\')">✏️ Rename All</button></div>' +
            '<span class="meta-pill">' + count + ' member' + (count!==1?'s':'') + '</span>' +
        '</div>' +
        '<div class="table-wrap"><table>' +
            '<thead><tr><th>Name (Phone)</th><th>Group</th><th>Total Paid</th><th>Monthly Due</th><th>Penalty</th><th>Worker Assignment</th><th>Status</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';
}
function updateMemberWorker(groupName, memberIndex, workerName) {
    if (!groups[groupName]) return;
    groups[groupName].members[memberIndex].worker = workerName.trim();
    save();
    showToast('✅ Worker updated', 'success');
}
function workerSearch() {
    let query = (document.getElementById("workerSearchInput")?.value || "").trim().toLowerCase();
    document.getElementById("workerGroupFilter").value = "";
    let results = document.getElementById("workerResults");
    let btn     = document.getElementById("workerPrintBtn");
    if (!query) { results.innerHTML = ""; if (btn) btn.style.display = "none"; return; }
    let matches = getAllMembersFlat().filter(function(r) {
        return (r.member.worker || "").toLowerCase().includes(query);
    });
    renderWorkerResultsByWorker(matches, query);
    if (btn) btn.style.display = matches.length ? "" : "none";
}
function updateSystemDate() {
    let val = document.getElementById("systemDateInput").value;
    if (!val) return;

    systemDate = new Date(val);
    localStorage.setItem("systemDate", val);

    // VERY IMPORTANT
    autoTickAllGroups();  

    save();

    if (activeGroup) showGroup(activeGroup);

    showToast("📅 Date updated and system recalculated", "info");
}
function workerGroupSearch() {
    let groupName = document.getElementById("workerGroupFilter")?.value || "";
    document.getElementById("workerSearchInput").value = "";
    let results = document.getElementById("workerResults");
    let btn     = document.getElementById("workerPrintBtn");
    if (!groupName || !groups[groupName]) { results.innerHTML = ""; if (btn) btn.style.display = "none"; return; }
    let group = groups[groupName];
    let rows  = group.members.map(function(m, i) {
        return '<tr>' +
            '<td><strong>' + m.name + '</strong> <span style="color:var(--text-muted);font-size:12px">(' + m.phone + ')</span></td>' +
            '<td><input type="text" class="worker-inline-input" value="' + (m.worker||'') + '" placeholder="Assign worker…"' +
                ' onchange="updateMemberWorker(\'' + esc(groupName) + '\',' + i + ',this.value)" style="width:130px"></td>' +
            '<td class="paid-cell">' + fmt(m.totalPaid || 0) + '</td>' +
            '<td class="' + (Math.max(0,m.currentDue)>0?'due-full':'due-zero') + '">' + fmt(Math.max(0,m.currentDue)) + '</td>' +
            '<td>' + (m.penalty>0?'<span class="penalty-badge">'+fmt(m.penalty)+'</span>':'—') + '</td>' +
            '<td><span class="status-dot ' + (m.taken?'dot-yellow':'dot-red') + '"></span>' +
                '<span style="font-size:11px;color:var(--text-muted);margin-left:5px">' + (m.taken?'PS':'NPS') + '</span></td>' +
        '</tr>';
    }).join('');
    results.innerHTML = '<div class="card">' +
        '<div class="card-header"><div class="section-title">📋 Group: ' + groupName + ' — Members &amp; Workers</div>' +
        '<span class="meta-pill">' + group.members.length + ' members</span></div>' +
        '<div class="table-wrap"><table>' +
            '<thead><tr><th>Name (Phone)</th><th>Worker Assignment</th><th>Total Paid</th><th>Monthly Due</th><th>Penalty</th><th>Status</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';
    if (btn) btn.style.display = "";
}
function renderWorkerResultsByWorker(matches, query) {
    let results = document.getElementById("workerResults");
    if (matches.length === 0) {
        results.innerHTML = '<div class="card"><p style="color:var(--text-muted);padding:12px">No members found assigned to worker matching "' + query + '".</p></div>';
        return;
    }
    let byWorker = {};
    matches.forEach(function(r) {
        let w = r.member.worker || "Unknown";
        if (!byWorker[w]) byWorker[w] = [];
        byWorker[w].push(r);
    });
    let html = '';
    for (let workerName in byWorker) {
        let list = byWorker[workerName];
        let safeW = esc(workerName);
        let rows = list.map(function(r) {
            let m = r.member, mIdx = r.group.members.indexOf(m);
            return workerRowHtml(m, r.groupName, mIdx);
        }).join('');
        html += workerGroupCard(workerName, safeW, list.length, rows);
    }
    results.innerHTML = html;
}
function clearWorkerSearch() {
    let inp = document.getElementById("workerSearchInput");
    let grp = document.getElementById("workerGroupFilter");
    if (inp) inp.value = ""; if (grp) grp.value = "";
    let results = document.getElementById("workerResults");
    if (results) results.innerHTML = "";
    let btn = document.getElementById("workerPrintBtn");
    if (btn) btn.style.display = "none";
}
function printWorkerView() {
    let resultsEl = document.getElementById("workerResults");
    if (!resultsEl || !resultsEl.innerHTML.trim()) return;
    let today    = new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
    let bodyHtml = resultsEl.innerHTML
        .replace(/class="penalty-badge"/g, 'style="background:#fef2f2;color:#dc2626;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700"')
        .replace(/class="badge-status badge-ps"/g,  'style="background:#d1fae5;color:#059669;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700"')
        .replace(/class="badge-status badge-nps"/g, 'style="background:#e0e7ff;color:#2563eb;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700"')
        .replace(/class="[^"]*"/g,'').replace(/ onclick="[^"]*"/g,'');
    let w = window.open('','_blank');
    w.document.write('<!DOCTYPE html><html><head><title>Workers Report — ' + today + '</title>' +
        '<style>body{font-family:"Segoe UI",sans-serif;padding:24px;color:#1a1d23}h1{font-size:22px;margin-bottom:4px}.sub{color:#6b7280;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}th{background:#1e293b;color:#e2e8f0;padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase}td{padding:9px 12px;border-bottom:1px solid #e2e5ea}tr:nth-child(even) td{background:#f7f8fa}@media print{body{padding:0}}</style>' +
        '</head><body><h1>RR Kakatiya Chit Fund — Workers Report</h1>' +
        '<div class="sub">Generated: ' + today + '</div>' + bodyHtml +
        '<script>window.onload=function(){window.print();}<\/script></body></html>');
    w.document.close();
}

/* ═══════════════════════════════════════════════════════════
   HISTORY PAGE  (Req #3 — filter-aware totals)
   ═══════════════════════════════════════════════════════════ */
function historyTableHeader() {
    return '<div class="table-wrap" style="margin:0"><table style="font-size:12px;border-collapse:collapse;width:100%" id="historyTable">' +
        '<thead><tr style="font-size:11px">' +
            '<th>Type</th><th>Member</th><th>Group</th><th>Phone</th>' +
            '<th>Receipt Date ✏️</th>' +
            // Separated Money IN / Money OUT columns
            '<th style="color:#22c55e">💚 Payment (IN)</th>' +
            '<th style="color:#f97316">🔶 Payout (OUT)</th>' +
            // Payment-only detail columns
            '<th class="col-payment-only">Total Paid</th>' +
            '<th class="col-payment-only">Monthly Due</th>' +
            '<th class="col-payment-only">Unpaid Balance</th>' +
            '<th class="col-payment-only">Taken?</th>' +
            '<th class="col-payment-only">Month</th>' +
            // Payout-only column
            '<th class="col-payout-only">Taken Month</th>' +
            '<th class="narration-cell">Narration</th><th>Delete</th>' +
        '</tr></thead><tbody id="historyTableBody">';
}
function buildHistoryRows(group, groupName, member, filterDate) {
    let totalPaid   = member.totalPaid || 0;
    let unpaid      = Math.max(0, getTotalExpected(group, member) - totalPaid);
    let currentDue  = Math.max(0, member.currentDue);
    let takenStatus = member.taken
        ? '✅ M' + (member.takenMonth||'?') + ' (' + fmt(calcPayout(group, member.takenMonth||1)) + ')'
        : "—";

    let history = member.history || [];
    history = history.slice().sort(function(a, b) {
        return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
    });
    if (filterDate) {
        history = history.filter(function(h) {
            let d = h.receiptDate || h.date;
            return d && new Date(d).toISOString().split("T")[0] === filterDate;
        });
        if (history.length === 0) return "";
    }
    let safeGroup  = esc(groupName), safeMember = esc(member.name);
    if (history.length === 0) {
        return '<tr data-type="payment">' +
            '<td><span class="type-badge type-payment">Payment</span></td>' +
            '<td>' + member.name + '</td>' +
            '<td style="color:var(--text-muted);font-size:11px">' + groupName + '</td>' +
            '<td style="color:var(--text-muted);font-size:11px">' + member.phone + '</td>' +
            '<td style="color:var(--text-muted)">—</td>' +
            '<td style="color:var(--text-muted)">—</td>' +
            '<td style="color:var(--text-muted)">—</td>' +
            '<td class="col-payment-only paid-cell">' + fmt(totalPaid) + '</td>' +
            '<td class="col-payment-only" style="color:var(--danger)">' + fmt(currentDue) + '</td>' +
            '<td class="col-payment-only" style="color:' + (unpaid>0?'var(--danger)':'var(--accent)') + '">' + fmt(unpaid) + '</td>' +
            '<td class="col-payment-only">' + takenStatus + '</td>' +
            '<td class="col-payment-only" style="color:var(--text-muted);font-size:11px">Month ' + group.currentMonth + '/' + group.months + '</td>' +
            '<td class="col-payout-only" style="color:var(--text-muted)">—</td>' +
            '<td class="narration-cell" style="color:var(--text-muted)">—</td><td>—</td></tr>';
    }

    return history.map(function(h, idx) {
        let isPayout = (h.type === "payout");
        let rDate    = h.receiptDate || h.date;
        let dateStr  = rDate ? new Date(rDate).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—";
        let narrationText = h.narration || '';
        let realIdx  = (member.history || []).indexOf(h);
        if (realIdx === -1) {
            realIdx = (member.history || []).findIndex(function(x) {
                return (x.receiptDate||x.date) === (h.receiptDate||h.date) && x.amount === h.amount;
            });
        }

        // ── Ledger columns: exactly one has a value, the other shows —
        let paymentAmtCell, payoutAmtCell;
        if (isPayout) {
            let payoutAmt = h.payoutAmount != null ? fmt(h.payoutAmount) : fmt(0);
            paymentAmtCell = '<td style="color:var(--text-muted);font-size:12px;text-align:right">—</td>';
            payoutAmtCell  = '<td style="color:#f97316;font-weight:700;text-align:right">' + payoutAmt + '</td>';
        } else {
            let paymentAmt = '₹' + Number(h.amount).toLocaleString("en-IN",{minimumFractionDigits:2});
            paymentAmtCell = '<td style="color:#16a34a;font-weight:700;text-align:right">' + paymentAmt + '</td>';
            payoutAmtCell  = '<td style="color:var(--text-muted);font-size:12px;text-align:right">—</td>';
        }

        // Type badge
        let typeBadge = isPayout
            ? '<span class="type-badge type-payout">💸 Payout</span>'
            : '<span class="type-badge type-payment">💰 Payment</span>';

        // Date cell
        let dateCell = '<td class="narration-editable-cell" ' +
            'data-group="' + safeGroup + '" data-member="' + safeMember + '" data-ridx="' + realIdx + '" data-field="receiptDate" ' +
            'onclick="activateReceiptDateEdit(this)" title="Click to edit receipt date" style="cursor:pointer;min-width:110px">' +
            '<span class="receipt-date-text" style="font-size:11px;color:var(--text-muted)">' + dateStr + '</span>' +
            '<span class="narration-edit-hint" style="margin-left:4px">✏️</span>' +
            '</td>';

        // Narration cell
        let narrationCell = '<td class="narration-cell narration-editable-cell" ' +
            'data-group="' + safeGroup + '" data-member="' + safeMember + '" data-idx="' + idx + '" ' +
            'onclick="activateNarrationEdit(this)" title="Click to edit narration">' +
            '<span class="narration-text">' + (narrationText
                ? narrationText.replace(/</g,'&lt;').replace(/>/g,'&gt;')
                : '<em style=\'color:var(--text-muted)\'>Click to add narration…</em>') + '</span>' +
            '<span class="narration-edit-hint">✏️</span>' +
            '</td>';

        // Delete button
        let deleteBtn = '<td><button class="btn btn-danger" style="padding:4px 8px;font-size:11px" ' +
            'onclick="deletePaymentEntry(\'' + safeGroup + '\',\'' + safeMember + '\',' + realIdx + ',true)">🗑</button></td>';

        if (isPayout) {
            // PAYOUT ROW — payout-specific columns only; payment detail cols blank
            return '<tr data-type="payout" style="background:var(--payout-row-bg,rgba(249,115,22,0.04))">' +
                '<td>' + typeBadge + '</td>' +
                '<td><strong>' + member.name + '</strong></td>' +
                '<td style="color:var(--text-muted);font-size:11px">' + groupName + '</td>' +
                '<td style="color:var(--text-muted);font-size:11px">' + member.phone + '</td>' +
                dateCell +
                paymentAmtCell +
                payoutAmtCell +
                '<td class="col-payment-only" style="color:var(--text-muted);font-size:11px">—</td>' +
                '<td class="col-payment-only" style="color:var(--text-muted);font-size:11px">—</td>' +
                '<td class="col-payment-only" style="color:var(--text-muted);font-size:11px">—</td>' +
                '<td class="col-payment-only" style="color:var(--text-muted);font-size:11px">—</td>' +
                '<td class="col-payment-only" style="color:var(--text-muted);font-size:11px">—</td>' +
                '<td class="col-payout-only" style="font-size:11px">' + (h.takenMonth ? 'Month ' + h.takenMonth : '—') + '</td>' +
                narrationCell +
                deleteBtn +
                '</tr>';
        } else {
            // PAYMENT ROW — full financial details
            return '<tr data-type="payment">' +
                '<td>' + typeBadge + '</td>' +
                '<td>' + member.name + '</td>' +
                '<td style="color:var(--text-muted);font-size:11px">' + groupName + '</td>' +
                '<td style="color:var(--text-muted);font-size:11px">' + member.phone + '</td>' +
                dateCell +
                paymentAmtCell +
                payoutAmtCell +
                '<td class="col-payment-only paid-cell">' + fmt(totalPaid) + '</td>' +
                '<td class="col-payment-only" style="color:var(--danger)">' + fmt(currentDue) + '</td>' +
                '<td class="col-payment-only" style="color:' + (unpaid>0?'var(--danger)':'var(--accent)') + '">' + fmt(unpaid) + '</td>' +
                '<td class="col-payment-only" style="font-size:11px">' + takenStatus + '</td>' +
                '<td class="col-payment-only" style="color:var(--text-muted);font-size:11px">Month ' + group.currentMonth + '/' + group.months + '</td>' +
                '<td class="col-payout-only" style="color:var(--text-muted);font-size:11px">—</td>' +
                narrationCell +
                deleteBtn +
                '</tr>';
        }
    }).join("");
}

/* ── Print History ─────────────────────────────────────────── */
function printHistory() {
    let table = document.getElementById("historyTable");
    if (!table) { showToast("⚠️ No history visible to print", "warning"); return; }

    // Collect only visible rows
    let thead = table.querySelector("thead");
    let visibleRows = [];
    table.querySelectorAll("tbody tr").forEach(function(tr) {
        if (tr.style.display !== "none") visibleRows.push(tr.outerHTML);
    });

    let today = new Date().toLocaleDateString("en-IN", {day:"numeric",month:"long",year:"numeric"});
    let titleEl = document.getElementById("historyDetailsTitle");
    let titleText = (titleEl ? titleEl.textContent : "Transaction History") + " — " + today;

    let w = window.open("", "_blank");
    w.document.write('<!DOCTYPE html><html><head><title>' + titleText + '</title>' +
        '<style>' +
        'body{font-family:"Segoe UI",sans-serif;padding:24px;color:#1a1d23}' +
        'h1{font-size:20px;margin-bottom:4px}' +
        '.sub{color:#6b7280;font-size:12px;margin-bottom:16px}' +
        'table{width:100%;border-collapse:collapse;font-size:11px}' +
        'th{background:#1e293b;color:#e2e8f0;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px}' +
        'td{padding:8px 10px;border-bottom:1px solid #e2e5ea;vertical-align:top}' +
        'tr:nth-child(even) td{background:#f7f8fa}' +
        'tr[data-type="payout"] td{background:#fff7ed}' +
        '.type-badge{display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:600}' +
        '.type-payment{background:#dbeafe;color:#1d4ed8}' +
        '.type-payout{background:#ffedd5;color:#c2410c}' +
        'td[style*="color:#16a34a"]{color:#16a34a!important;font-weight:700}' +
        'td[style*="color:#f97316"]{color:#f97316!important;font-weight:700}' +
        '.narration-edit-hint{display:none}' +
        'button{display:none}' +
        '@media print{body{padding:0}}' +
        '</style></head><body>' +
        '<h1>RR Kakatiya Chit Fund — Transaction History</h1>' +
        '<div class="sub">Printed: ' + today + '</div>' +
        '<table>' + thead.outerHTML + '<tbody>' + visibleRows.join("") + '</tbody></table>' +
        '<script>window.onload=function(){window.print();}<\/script>' +
        '</body></html>');
    w.document.close();
}
function activateReceiptDateEdit(cell) {
    if (cell.querySelector('input')) return;
    let groupName  = cell.dataset.group;
    let memberName = cell.dataset.member;
    let realIdx    = parseInt(cell.dataset.ridx);
    let group  = groups[groupName];
    let member = group && group.members.find(function(m) { return m.name === memberName; });
    if (!member || !member.history || !member.history[realIdx]) return;
    let h = member.history[realIdx];
    let currentVal = (h.receiptDate || h.date || "").split("T")[0];
    cell.innerHTML = '<input type="date" value="' + currentVal + '" style="width:130px;padding:4px 6px;font-size:12px">';
    let input = cell.querySelector('input');
    input.focus();
    function saveEdit() {
        let newDate = input.value;
        if (!newDate) {
            cell.innerHTML = '<span class="receipt-date-text" style="font-size:11px;color:var(--text-muted)">' + (currentVal ? new Date(currentVal).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—") + '</span><span class="narration-edit-hint" style="margin-left:4px">✏️</span>';
            return;
        }
        let newISO = new Date(newDate).toISOString();
        h.receiptDate = newISO;
        h.date        = newISO;
        // Re-sort member history by receiptDate
        member.history.sort(function(a, b) {
            return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
        });
        // Re-sort transactions
        transactions.sort(function(a, b) {
            return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
        });
        save();
        showToast("📅 Receipt date updated", "info");
        // Refresh history view
        let titleEl = document.getElementById("historyDetailsTitle");
        if (titleEl) showHistoryGroup(groupName);
    }
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') {
            input.removeEventListener('blur', saveEdit);
            cell.innerHTML = '<span class="receipt-date-text" style="font-size:11px;color:var(--text-muted)">' + (currentVal ? new Date(currentVal).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—") + '</span><span class="narration-edit-hint" style="margin-left:4px">✏️</span>';
        }
    });
}
function activateNarrationEdit(cell) {
    if (cell.querySelector('input')) return;
    let groupName  = cell.dataset.group;
    let memberName = cell.dataset.member;
    let idx        = parseInt(cell.dataset.idx);
    let currentVal = '';
    let group  = groups[groupName];
    let member = group && group.members.find(function(m) { return m.name === memberName; });
    if (member && member.history) {
        // history is sorted descending; idx is the display position
        let sorted = member.history.slice().sort(function(a, b) {
            return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
        });
        currentVal = (sorted[idx] && sorted[idx].narration) || '';
    }
    cell.innerHTML = '<input type="text" class="narration-input narration-live-input" value="' + currentVal.replace(/"/g,'&quot;') + '" placeholder="Add narration…" style="width:100%;min-width:240px">';
    let input = cell.querySelector('input');
    input.focus(); input.select();
    function saveEdit() {
        let newVal = input.value;
        updateNarration(groupName, memberName, idx, newVal);
        cell.innerHTML = '<span class="narration-text">' +
            (newVal ? newVal.replace(/</g,'&lt;').replace(/>/g,'&gt;') : '<em style=\'color:var(--text-muted)\'>Click to add narration…</em>') +
            '</span><span class="narration-edit-hint">✏️</span>';
    }
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', saveEdit); cell.innerHTML = '<span class="narration-text">' + (currentVal || '<em style=\'color:var(--text-muted)\'>Click to add narration…</em>') + '</span><span class="narration-edit-hint">✏️</span>'; }
    });
}
function showHistoryGroup(groupName) {
    let group = groups[groupName]; if (!group) return;
    let container = document.getElementById("historyDetails");
    let card      = document.getElementById("historyDetailsCard");
    let titleEl   = document.getElementById("historyDetailsTitle");
    if (!container || !card) return;
    card.style.display = ""; titleEl.textContent = "Payment History — " + groupName;
    // Dynamic summary for history — Req #3
    let totalPaid = 0, totalDue = 0;
    group.members.forEach(function(m) {
        totalPaid += (m.totalPaid || 0);
        totalDue  += Math.max(0, getExpectedTillNow(group, m) - (m.totalPaid || 0));
    });
    let rows = "";
    group.members.forEach(function(member) { rows += buildHistoryRows(group, groupName, member, null); });
    container.innerHTML =
        '<div class="table-summary-bar" style="margin-bottom:12px">' +
            '<span class="summary-chip chip-paid">Total Paid: <b>' + fmt(totalPaid) + '</b></span>' +
            '<span class="summary-chip chip-due">Outstanding: <b>' + fmt(totalDue) + '</b></span>' +
        '</div>' +
        historyTableHeader() + (rows || '<tr><td colspan="14" style="text-align:center;color:var(--text-muted);padding:12px">No payments recorded yet</td></tr>') + '</tbody></table></div>';
}
function historySearch() {
    let query       = (document.getElementById("historySearch")?.value      || "").toLowerCase().trim();
    let dateVal     = (document.getElementById("historyDateSearch")?.value  || "").trim();
    let groupFilter = (document.getElementById("historyGroupFilter")?.value || "");
    let container   = document.getElementById("historyDetails");
    let card        = document.getElementById("historyDetailsCard");
    let titleEl     = document.getElementById("historyDetailsTitle");
    let modeEl      = document.getElementById("historySearchMode");

    if (!query && !dateVal && !groupFilter) {
        if (card) card.style.display = "none";
        if (modeEl) modeEl.textContent = ""; return;
    }
    if (!card || !container) return;

    let rows = "", totalPaid = 0, totalDue = 0;
    function processGroup(gName, g, mFilter) {
        g.members.forEach(function(member) {
            if (mFilter && !member.name.toLowerCase().includes(mFilter)) return;
            let r = buildHistoryRows(g, gName, member, dateVal || null);
            if (r) {
                rows += r;
                totalPaid += (member.totalPaid || 0);
                totalDue  += Math.max(0, getExpectedTillNow(g, member) - (member.totalPaid || 0));
            }
        });
    }

    if (groupFilter && groups[groupFilter]) {
        processGroup(groupFilter, groups[groupFilter], query || null);
        if (modeEl) modeEl.textContent = "Group: " + groupFilter + (dateVal?" · Date: "+dateVal:"");
        card.style.display = ""; titleEl.textContent = groupFilter + (query?' — "'+query+'"':'');
    } else if (dateVal && !query) {
        for (let gName in groups) processGroup(gName, groups[gName], null);
        if (modeEl) modeEl.textContent = "All transactions on " + dateVal;
        card.style.display = ""; titleEl.textContent = "Transactions on " + dateVal;
    } else {
        let memberFound = false;
        for (let gName in groups) {
            groups[gName].members.forEach(function(member) {
                if (member.name.toLowerCase().includes(query)) {
                    memberFound = true;
                    let r = buildHistoryRows(groups[gName], gName, member, dateVal||null);
                    if (r) {
                        rows += r;
                        totalPaid += (member.totalPaid || 0);
                        totalDue  += Math.max(0, getExpectedTillNow(groups[gName], member) - (member.totalPaid || 0));
                    }
                }
            });
        }
        if (!memberFound) {
            for (let gName in groups) {
                if (gName.toLowerCase().includes(query)) processGroup(gName, groups[gName], null);
            }
        }
        if (modeEl) modeEl.textContent = 'Search: "' + query + '"' + (dateVal?" · Date: "+dateVal:"");
        card.style.display = ""; titleEl.textContent = '"' + query + '"';
    }

    container.innerHTML =
        '<div class="table-summary-bar" style="margin-bottom:12px">' +
            '<span class="summary-chip chip-paid">Total Paid: <b>' + fmt(totalPaid) + '</b></span>' +
            '<span class="summary-chip chip-due">Outstanding: <b>' + fmt(totalDue) + '</b></span>' +
        '</div>' +
        historyTableHeader() + (rows || '<tr><td colspan="14" style="text-align:center;color:var(--text-muted);padding:12px">No results</td></tr>') + '</tbody></table></div>';
}
function clearHistorySearch() {
    ["historySearch","historyDateSearch","historyGroupFilter"].forEach(function(id) {
        let el = document.getElementById(id); if (el) el.value = "";
    });
    let card = document.getElementById("historyDetailsCard"); if (card) card.style.display = "none";
    let modeEl = document.getElementById("historySearchMode"); if (modeEl) modeEl.textContent = "";
    document.querySelectorAll("#historyGroupList .group-item").forEach(function(el){ el.style.display=""; });
}
function displayHistoryGroups() {
    let list = document.getElementById("historyGroupList"); if (!list) return;
    list.innerHTML = "";
    let keys = Object.keys(groups);
    if (keys.length === 0) { list.innerHTML = '<div class="group-empty">📭 No groups yet. Create one!</div>'; return; }
    let dd = document.getElementById("historyGroupFilter");
    if (dd) dd.innerHTML = '<option value="">All Groups</option>' + keys.map(function(k) { return '<option value="'+k+'">'+k+'</option>'; }).join("");
    for (let name of keys) {
        let g = groups[name], div = document.createElement("div");
        div.className = "group-item"; div.dataset.groupname = name.toLowerCase();
        div.innerHTML =
            '<div class="group-item-name"><span class="group-dot" style="' + (isGroupCompleted(g)?'background:var(--text-muted)':'') + '"></span>' +
            name + '<span class="group-meta-tag">Month ' + g.currentMonth + '/' + g.months + '</span></div>' +
            '<span class="meta-pill" style="font-size:11px;">' + g.members.length + ' members</span>';
        div.onclick = function() {
            document.querySelectorAll("#historyGroupList .group-item").forEach(function(el){ el.classList.remove("active"); });
            div.classList.add("active");
            ["historySearch","historyDateSearch","historyGroupFilter"].forEach(function(id){ let el = document.getElementById(id); if (el) el.value = ""; });
            let modeEl = document.getElementById("historySearchMode"); if (modeEl) modeEl.textContent = "";
            showHistoryGroup(name);
        };
        list.appendChild(div);
    }
}

/* ═══════════════════════════════════════════════════════════
   SIDEBAR + NAVIGATE
   ═══════════════════════════════════════════════════════════ */
function toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebarBackdrop").classList.toggle("show");
}

function navigate(page, el) {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarBackdrop").classList.remove("show");
    document.querySelectorAll(".nav-item").forEach(function(n){ n.classList.remove("active"); });
    if (el) el.classList.add("active");

    let title   = document.getElementById("pageTitle");
    let content = document.getElementById("contentArea");

    if (page === "home") {
        title.textContent = "Home";
        let netCollected = calcNetCollected();
        let totalDue     = calcActiveDue();
        let totalMembers = Object.values(groups).reduce(function(s,g){ return s+g.members.length; }, 0);

        content.innerHTML =
            '<div class="home-hero"><h2>RR Kakatiya Chit Fund</h2><p>Manage your chit fund groups, track payments and prize payouts.</p></div>' +
            '<div class="card reminders-home-card">' +
                '<div class="card-header" style="margin-bottom:14px">' +
                    '<div class="section-title">🔔 Reminders</div>' +
                    '<button class="btn btn-ghost" onclick="navigate(\'notices\',document.querySelector(\'.nav-item[onclick*=notices]\'))">➕ Add Reminder</button>' +
                '</div>' +
                '<div id="homeReminders"></div>' +
            '</div>' +
            '<div class="home-stats">' +
                '<div class="stat-card"><div class="stat-num">' + Object.keys(groups).length + '</div><div class="stat-label">Active Groups</div></div>' +
                '<div class="stat-card"><div class="stat-num">' + totalMembers + '</div><div class="stat-label">Total Members</div></div>' +
                '<div class="stat-card"><div class="stat-num" style="font-size:18px">' + fmt(netCollected) + '</div><div class="stat-label">Net Collected</div></div>' +
                '<div class="stat-card"><div class="stat-num" style="font-size:18px;color:var(--danger)">' + fmt(totalDue) + '</div><div class="stat-label">Pending Dues</div></div>' +
                '<div class="stat-card"><div class="stat-num">' + Object.keys(trash).length + '</div><div class="stat-label">In Trash</div></div>' +
            '</div>' +
            '<div class="card">' +
                '<div class="card-header" style="margin-bottom:16px">' +
                    '<div class="section-title">📊 Admin Dashboard</div>' +
                    '<button class="btn btn-ghost" onclick="navigate(\'due\',document.querySelector(\'.nav-item[onclick*=due]\'))">⚠️ View Due List</button>' +
                '</div>' +
                buildDashboard() +
            '</div>';
            '<div class="card">'
                '<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">'+
                    '<label style="font-weight:600;">📅 System Date:</label>'+
                    '<input type="date" id="systemDateInput">'+
                    '<button class="btn btn-primary" onclick="updateSystemDate()">Update</button>'+
                '</div>'+
            '</div>'+
        renderHomeReminders();
        document.getElementById("systemDateInput").value =
            systemDate.toISOString().split("T")[0];
    }
    else if (page === "tables") {
        title.textContent = "Tables";
        content.innerHTML =
            '<div class="card"><div class="card-header"><div class="section-title">All Groups</div></div>' +
            '<div class="search-row">' +
                '<input id="searchBox" type="text" placeholder="🔍 Search group name or member name…" oninput="liveSearchTables()" autocomplete="off">' +
                '<button class="btn btn-secondary" onclick="liveSearchTables()">🔍 Search</button>' +
                '<button class="btn btn-ghost" onclick="clearTableSearch()" title="Clear search" style="padding:8px 12px">✕</button>' +
            '</div>' +
            '<div id="searchResultsBanner" style="display:none;padding:6px 12px;font-size:13px;color:var(--text-muted);background:var(--surface2);border-radius:var(--radius-sm);margin-top:4px"></div>' +
            '<div id="groupList" class="group-list"></div></div>' +
            '<div class="card"><div class="card-header"><div class="section-title">Group Details</div></div>' +
            '<div id="groupDetails" style="color:var(--text-muted);font-size:14px;padding:12px 0;">👈 Select a group from the list above to view details.</div></div>';
        displayGroups();
        if (activeGroup && groups[activeGroup]) showGroup(activeGroup);
    }
    else if (page === "create") {
        title.textContent = "Create Table";
        content.innerHTML =
            '<div class="card"><div class="card-header"><div class="section-title">Create New Group</div></div>' +
            '<div class="form-grid">' +
                '<div class="field"><label>Group Name</label><input id="groupName" type="text" placeholder="e.g. Office Group A"></div>' +
                '<div class="field"><label>Number of Members</label><input id="memberCount" type="number" min="1" placeholder="e.g. 10" oninput="generateMemberInputs()"></div>' +
                '<div class="field"><label>Total Amount (₹)</label><input id="totalAmount" type="number" min="1" placeholder="e.g. 100000" oninput="previewCommission()"></div>' +
                '<div class="field"><label>Number of Months</label><input id="months" type="number" min="1" placeholder="e.g. 10" oninput="previewCommission()"></div>' +
                '<div class="field"><label>Start Date</label><input id="startDate" type="date"></div>' +
                '<div class="field"><label>Extra Increment per month (₹) after taking</label><input id="increment" type="number" min="0" placeholder="e.g. 1000" oninput="previewCommission()"></div>' +
            '</div>' +
            '<div class="info-box" id="commissionPreview">Fill in Total Amount, Months, and Increment to see a preview.</div>' +
            '<div id="memberInputs"></div>' +
            '<div class="btn-row"><button class="btn btn-primary" onclick="createGroup()">✅ Create Group</button></div></div>';
    }
    else if (page === "workers") {
        title.textContent = "Incharge";
        showWorkersPage();
    }
    else if (page === "history") {
        title.innerText = "History";
        let groupOptions = Object.keys(groups).map(function(k){ return '<option value="'+k+'">'+k+'</option>'; }).join("");
        content.innerHTML =
            '<div class="card" style="margin-bottom:10px">' +
            '<div class="section-title" style="margin-bottom:12px">🔍 Advanced Search</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
                '<div class="field"><label>Member / Group Name</label><input id="historySearch" type="text" placeholder="Search member or group…" oninput="historySearch()" style="width:100%"></div>' +
                '<div class="field"><label>Date Filter</label><input id="historyDateSearch" type="date" oninput="historySearch()" style="width:100%"></div>' +
                '<div class="field"><label>Filter by Group</label><select id="historyGroupFilter" onchange="historySearch()" style="width:100%;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:inherit;font-size:14px;outline:none"><option value="">All Groups</option>' + groupOptions + '</select></div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;margin-top:10px;align-items:center">' +
                '<button class="btn btn-secondary" onclick="clearHistorySearch()" style="font-size:13px">✕ Clear</button>' +
                '<span id="historySearchMode" style="font-size:12px;color:var(--text-muted)"></span>' +
            '</div></div>' +
            '<div class="history-layout">' +
                '<div class="card history-group-panel">' +
                    '<div class="section-title" style="margin-bottom:12px">Groups</div>' +
                    '<div id="historyGroupList" class="group-list history-group-scroll"></div>' +
                '</div>' +
                '<div id="historyDetailsCard" style="display:none;min-width:0">' +
                    '<div class="card">' +
                        '<div class="card-header">' +
                            '<div class="section-title" id="historyDetailsTitle">History</div>' +
                            '<button class="btn btn-secondary btn-sm" onclick="printHistory()" style="font-size:12px">🖨️ Print / Export PDF</button>' +
                        '</div>' +
                        '<div id="historyDetails"></div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        displayHistoryGroups();
    }
    else if (page === "due") {
        title.textContent = "Due List";
        if (window._dueSearch === undefined) window._dueSearch = '';
        showDueList();
    }
    else if (page === "penalty") {
        title.textContent = "Penalty List";
        if (window._penaltySearch === undefined) window._penaltySearch = '';
        showPenaltyList();
    }
    else if (page === "notices") {
        title.textContent = "Notices";
        content.innerHTML =
            '<div class="card"><div class="card-header" style="margin-bottom:4px"><div class="section-title">📢 Add Reminder</div></div>' +
            '<p style="color:var(--text-muted);font-size:13px;margin-bottom:18px;">Set a reminder — it will appear on the Home page, colour-coded by urgency.</p>' +
            '<div class="form-grid" style="margin-bottom:12px">' +
                '<div class="field"><label>Reminder Title</label><input id="remTitle" type="text" placeholder="e.g. Collect payments from Group A"></div>' +
                '<div class="field"><label>Due Date</label><input id="remDate" type="date"></div>' +
            '</div>' +
            '<div class="field" style="margin-bottom:16px"><label>Notes (optional)</label><input id="remNote" type="text" placeholder="Any extra details…"></div>' +
            '<div class="urgency-legend">' +
                '<span class="legend-dot rem-overdue-tag">🔴 Overdue</span>' +
                '<span class="legend-dot rem-urgent-tag">🟠 Urgent (0–2 days)</span>' +
                '<span class="legend-dot rem-soon-tag">🟡 Soon (3–7 days)</span>' +
                '<span class="legend-dot rem-upcoming-tag">🟢 Upcoming (8+ days)</span>' +
            '</div>' +
            '<div class="btn-row" style="margin-top:8px"><button class="btn btn-primary" onclick="addReminder()">➕ Add Reminder</button></div></div>' +
            '<div class="card"><div class="card-header" style="margin-bottom:14px"><div class="section-title">📋 All Reminders</div></div><div id="reminderList"></div></div>';
        displayReminders();
        let remDateInput = document.getElementById("remDate");
        if (remDateInput) remDateInput.value = new Date().toISOString().split("T")[0];
    }
    else if (page === "bin") {
        title.textContent = "Bin";
        content.innerHTML =
            '<div class="card"><div class="card-header"><div class="section-title">🗑 Trash</div></div>' +
            '<p style="color:var(--text-muted);font-size:13px;margin-bottom:14px">Groups are auto-deleted after 2 days.</p>' +
            '<div class="trash-list" id="trashList"></div></div>';
        displayTrash();
    }
    else if (page === "moneygiven") {
        title.textContent = "Money Given";
        content.innerHTML =
            '<div class="card"><div class="card-header"><div class="section-title">💸 Money Given (Payout Management)</div></div>' +
            '<div class="search-row">' +
                '<input id="mgSearchBox" type="text" placeholder="🔍 Search group or member…" oninput="mgLiveSearch()" autocomplete="off">' +
                '<button class="btn btn-secondary" onclick="mgLiveSearch()">🔍 Search</button>' +
                '<button class="btn btn-ghost" onclick="mgClearSearch()" style="padding:8px 12px">✕</button>' +
            '</div>' +
            '<div id="mgSearchBanner" style="display:none;padding:6px 12px;font-size:13px;color:var(--text-muted);background:var(--surface2);border-radius:var(--radius-sm);margin-top:4px"></div>' +
            '<div id="mgGroupList" class="group-list"></div></div>' +
            '<div class="card"><div class="card-header"><div class="section-title">Payout Details</div></div>' +
            '<div id="mgDetails" style="color:var(--text-muted);font-size:14px;padding:12px 0;">👈 Select a group to view PS members and record payouts.</div></div>';
        mgDisplayGroups();
        if (window._mgActiveGroup && groups[window._mgActiveGroup]) mgShowGroup(window._mgActiveGroup);
    }
}

/* ═══════════════════════════════════════════════════════════
   DATA MIGRATION — back-fill previousDue / currentMonthDue
   for members created before this penalty system upgrade.
   ═══════════════════════════════════════════════════════════ */
(function migrateExistingMembers() {
    let changed = false;
    for (let gn in groups) {
        let g = groups[gn];
        g.members.forEach(function(m) {
            if (m.previousDue === undefined || m.currentMonthDue === undefined) {
                // Re-derive split from currentDue
                let base = g.totalAmount / g.months;
                let currentMonthlyInstalment = (m.taken && m.takenMonth !== null && g.currentMonth > m.takenMonth)
                    ? base + g.increment : base;
                let due = m.currentDue || 0;
                if (due <= 0) {
                    m.previousDue     = 0;
                    m.currentMonthDue = 0;
                } else if (due <= currentMonthlyInstalment) {
                    m.previousDue     = 0;
                    m.currentMonthDue = due;
                } else {
                    m.previousDue     = due - currentMonthlyInstalment;
                    m.currentMonthDue = currentMonthlyInstalment;
                }
                changed = true;
            }
            // Backfill receiptDate on history entries that don't have it
            if (m.history) {
                m.history.forEach(function(h) {
                    if (!h.receiptDate && h.date) {
                        h.receiptDate = h.date;
                        changed = true;
                    }
                });
                // Sort history by receiptDate descending after backfill
                m.history.sort(function(a, b) {
                    return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
                });
            }
        });
    }
    // Backfill receiptDate on transaction log entries
    transactions.forEach(function(t) {
        if (!t.receiptDate && t.date) {
            t.receiptDate = t.date;
            changed = true;
        }
    });
    if (changed) {
        transactions.sort(function(a, b) {
            return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
        });
        save();
    }
})();

/* ═══════════════════════════════════════════════════════════
   DATA MIGRATION — back-fill receiptDate for all existing
   history entries and transactions that pre-date this upgrade.
   ═══════════════════════════════════════════════════════════ */
(function migrateReceiptDates() {
    let changed = false;
    for (let gn in groups) {
        groups[gn].members.forEach(function(m) {
            (m.history || []).forEach(function(h) {
                if (!h.receiptDate) {
                    h.receiptDate = h.date || new Date().toISOString();
                    changed = true;
                }
            });
            // Sort each member's history by receiptDate descending
            if (m.history && m.history.length > 1) {
                m.history.sort(function(a, b) {
                    return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
                });
                changed = true;
            }
        });
    }
    transactions.forEach(function(t) {
        if (!t.receiptDate) {
            t.receiptDate = t.date || new Date().toISOString();
            changed = true;
        }
    });
    if (transactions.length > 1) {
        transactions.sort(function(a, b) {
            return new Date(b.receiptDate || b.date) - new Date(a.receiptDate || a.date);
        });
        changed = true;
    }
    if (changed) save();
})();


autoTickAllGroups();
navigate("home", document.querySelector('.nav-item'));
/* ═══════════════════════════════════════════════════════════
   MONEY GIVEN — Payout Management Module
   ═══════════════════════════════════════════════════════════ */

/* State */
window._mgActiveGroup = window._mgActiveGroup || null;

/* ── Display group list (PS members only indicator) ── */
function mgDisplayGroups() {
    let list = document.getElementById("mgGroupList");
    if (!list) return;
    list.innerHTML = "";
    let keys = Object.keys(groups);
    if (keys.length === 0) {
        list.innerHTML = '<div class="group-empty">📭 No groups yet. Create one!</div>';
        return;
    }
    keys.forEach(function(name) {
        let g = groups[name];
        let psCount = g.members.filter(function(m){ return m.taken; }).length;
        let div = document.createElement("div");
        div.className = "group-item" + (name === window._mgActiveGroup ? " active" : "");
        div.dataset.groupname = name.toLowerCase();
        div.innerHTML =
            '<div class="group-item-name">' +
                '<div class="group-title">' + name + '</div>' +
                '<div class="group-sub">Month ' + g.currentMonth + '/' + g.months +
                    ' &nbsp;·&nbsp; <span style="color:var(--accent)">' + psCount + ' PS member' + (psCount !== 1 ? 's' : '') + '</span>' +
                '</div>' +
            '</div>';
        div.onclick = function() {
            window._mgActiveGroup = name;
            document.querySelectorAll("#mgGroupList .group-item").forEach(function(el){ el.classList.remove("active"); });
            div.classList.add("active");
            mgShowGroup(name);
        };
        list.appendChild(div);
    });
}

/* ── Render payout table for selected group ── */
function mgShowGroup(name) {
    let details = document.getElementById("mgDetails");
    if (!details) return;
    let group = groups[name];
    if (!group) return;

    let psMembers = group.members.filter(function(m){ return m.taken && m.takenMonth !== null; });

    if (psMembers.length === 0) {
        details.innerHTML =
            '<div style="color:var(--text-muted);font-size:14px;padding:16px 0;">' +
            '📭 No PS members in this group yet. Mark members as PS in the Tables page first.' +
            '</div>';
        return;
    }

    let rows = "";
    psMembers.forEach(function(m) {
        let mi          = group.members.indexOf(m);
        let payoutAmt   = calcPayout(group, m.takenMonth);
        let totalGiven  = transactions
            .filter(function(t){ return t.type === "payout_given" && t.member === m.name && t.group === name; })
            .reduce(function(s,t){ return s + (t.amount || 0); }, 0);
        let remaining   = Math.max(0, payoutAmt - totalGiven);
        let statusCls   = remaining <= 0 ? "mg-status-full" : (totalGiven > 0 ? "mg-status-partial" : "mg-status-pending");
        let statusLabel = remaining <= 0 ? "\u2705 Fully Paid" : (totalGiven > 0 ? "\u23f3 Partial" : "\u274c Pending");
        let pct         = payoutAmt > 0 ? Math.min(100, Math.round((totalGiven / payoutAmt) * 100)) : 0;

        let givenHistory = transactions
            .filter(function(t){ return t.type === "payout_given" && t.member === m.name && t.group === name; })
            .sort(function(a,b){ return new Date(b.receiptDate||b.date) - new Date(a.receiptDate||a.date); });

        let historyRows = "";
        if (givenHistory.length > 0) {
            historyRows += '<tr class="mg-history-row"><td colspan="7" style="padding:0 0 10px 0">' +
                '<table style="width:100%;border-collapse:collapse">' +
                '<thead><tr style="background:var(--surface2)">' +
                    '<td style="padding:5px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Date</td>' +
                    '<td style="padding:5px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Amount</td>' +
                    '<td style="padding:5px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Narration</td>' +
                    '<td style="padding:5px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;text-align:center">Actions</td>' +
                '</tr></thead><tbody>';
            givenHistory.forEach(function(t) {
                let dStr  = t.receiptDate ? new Date(t.receiptDate).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "\u2014";
                let tid   = String(t.id);
                let safeN = (t.narration || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
                historyRows +=
                    '<tr style="border-top:1px dashed var(--border)" id="mgRow_' + tid + '">' +
                        '<td style="padding:7px 14px;color:var(--text-muted);font-size:12px;white-space:nowrap">' + dStr + '</td>' +
                        '<td style="padding:7px 14px;color:var(--accent);font-weight:700;font-size:13px;white-space:nowrap">' + fmt(t.amount) + '</td>' +
                        '<td style="padding:7px 14px;font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:360px" id="mgNarrCell_' + tid + '">' +
                            '<span class="mg-narr-text" id="mgNarrText_' + tid + '">' + (t.narration || '<span style="opacity:0.35">\u2014</span>') + '</span>' +
                        '</td>' +
                        '<td style="padding:7px 14px;text-align:center;white-space:nowrap">' +
                            '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;margin-right:4px" ' +
                                'onclick="mgStartEditNarr(\'' + tid + '\',\'' + esc(name) + '\',' + mi + ',\'' + safeN + '\')">' +
                                '\u270f\ufe0f Edit' +
                            '</button>' +
                            '<button class="btn btn-danger" style="padding:4px 10px;font-size:12px" ' +
                                'onclick="mgDeletePayout(\'' + tid + '\',\'' + esc(name) + '\',' + mi + ')">' +
                                '\ud83d\uddd1 Delete' +
                            '</button>' +
                        '</td>' +
                    '</tr>';
            });
            historyRows += '</tbody></table></td></tr>';
        }

        let progressBar =
            '<div style="height:4px;background:var(--border);border-radius:4px;margin-top:6px;overflow:hidden">' +
                '<div style="height:100%;width:' + pct + '%;background:' + (remaining<=0?'var(--accent)':'var(--primary)') + ';border-radius:4px"></div>' +
            '</div>' +
            '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + pct + '% disbursed</div>';

        rows +=
            '<tr data-mg-member="' + esc(m.name) + '" data-mg-idx="' + mi + '" style="border-top:2px solid var(--border)">' +
                '<td>' +
                    '<strong style="font-size:14px">' + m.name + '</strong>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + (m.phone||'\u2014') + '</div>' +
                '</td>' +
                '<td style="text-align:center">' +
                    '<span style="font-weight:700;font-size:14px">Month ' + m.takenMonth + '</span>' +
                    (m.takenDate ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' +
                        new Date(m.takenDate).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) + '</div>' : '') +
                '</td>' +
                '<td style="text-align:right"><span class="mg-payout-amt">' + fmt(payoutAmt) + '</span></td>' +
                '<td class="mg-given-cell">' +
                    '<div style="font-weight:700;font-size:14px;color:var(--accent)">' + fmt(totalGiven) + '</div>' +
                    '<span class="' + statusCls + '">' + statusLabel + '</span>' +
                    (remaining > 0 ? '<div style="font-size:11px;color:var(--danger);margin-top:3px">Remaining: <b>' + fmt(remaining) + '</b></div>' : '') +
                    progressBar +
                '</td>' +
                '<td><div class="mg-input-group">' +
                    '<input type="number" id="mgAmt_' + mi + '" placeholder="Amount (\u20b9)" min="0">' +
                    '<input type="date"   id="mgDate_' + mi + '" value="' + systemDate.toISOString().split("T")[0] + '">' +
                '</div></td>' +
                '<td class="mg-narration-cell">' +
                    '<textarea id="mgNarr_' + mi + '" placeholder="e.g. \u20b950,000 given in cash \xb7 \u20b91,000 deducted for paper charge \xb7 remaining via online transfer\u2026"></textarea>' +
                '</td>' +
                '<td style="white-space:nowrap;vertical-align:middle">' +
                    '<button class="btn btn-primary" onclick="mgRecordPayout(\'' + esc(name) + '\',' + mi + ')">\ud83d\udcb8 Record</button>' +
                '</td>' +
            '</tr>' + historyRows;
    });

    let totalPayoutDue = psMembers.reduce(function(s,m){ return s + calcPayout(group, m.takenMonth); }, 0);
    let totalGivenAll  = psMembers.reduce(function(acc,m) {
        return acc + transactions
            .filter(function(t){ return t.type === "payout_given" && t.member === m.name && t.group === name; })
            .reduce(function(s,t){ return s + (t.amount||0); }, 0);
    }, 0);
    let totalRemaining = Math.max(0, totalPayoutDue - totalGivenAll);

    details.innerHTML =
        '<div class="group-detail-header">' +
            '<h4>\ud83d\udcb8 ' + name + ' \u2014 Payout Register</h4>' +
            '<div class="meta"><span class="meta-pill">\ud83d\udcc5 Month ' + group.currentMonth + '/' + group.months + '</span></div>' +
        '</div>' +
        '<div class="mg-summary-bar">' +
            '<span class="mg-chip mg-chip-members">\ud83d\udc65 ' + psMembers.length + ' PS Member' + (psMembers.length!==1?'s':'') + '</span>' +
            '<span class="mg-chip mg-chip-total">\ud83d\udcb0 Total Due: <b style="margin-left:4px">' + fmt(totalPayoutDue) + '</b></span>' +
            '<span class="mg-chip mg-chip-given">\u2705 Given: <b style="margin-left:4px">' + fmt(totalGivenAll) + '</b></span>' +
            '<span class="mg-chip mg-chip-pending">\u23f3 Remaining: <b style="margin-left:4px">' + fmt(totalRemaining) + '</b></span>' +
        '</div>' +
        '<div class="table-wrap"><table>' +
        '<thead><tr>' +
            '<th>Name &amp; Phone</th>' +
            '<th style="text-align:center">Taken Month</th>' +
            '<th style="text-align:right">Payout Due</th>' +
            '<th>Amount Given</th>' +
            '<th>Record New Payment</th>' +
            '<th class="mg-narration-cell">Narration</th>' +
            '<th></th>' +
        '</tr></thead>' +
        '<tbody id="mgTableBody">' + rows + '</tbody>' +
        '</table></div>';
}


/* ── Record a payout entry ── */
function mgRecordPayout(groupName, memberIdx) {
    let group  = groups[groupName];
    let member = group.members[memberIdx];
    if (!member || !member.taken) { showToast("⚠️ Member is not in PS state", "warning"); return; }

    let amtEl  = document.getElementById("mgAmt_"  + memberIdx);
    let narrEl = document.getElementById("mgNarr_" + memberIdx);
    let dateEl = document.getElementById("mgDate_" + memberIdx);

    let amount  = amtEl  ? parseFloat(amtEl.value)  : 0;
    let narration = narrEl ? narrEl.value.trim() : "";
    let dateStr = (dateEl && dateEl.value) ? dateEl.value : systemDate.toISOString().split("T")[0];

    if (!amount || isNaN(amount) || amount <= 0) {
        showToast("⚠️ Enter a valid amount to record", "warning");
        return;
    }

    let receiptDateISO = new Date(dateStr).toISOString();

    // Store as payout_given transaction
    transactions.push({
        id:          Date.now() + Math.random(),
        type:        "payout_given",
        member:      member.name,
        group:       groupName,
        amount:      amount,
        narration:   narration,
        date:        receiptDateISO,
        receiptDate: receiptDateISO,
        takenMonth:  member.takenMonth,
        reason:      narration || ("Payout given to " + member.name + " (Month " + member.takenMonth + ")")
    });

    // Also push to member history
    if (!member.history) member.history = [];
    member.history.push({
        type:        "payout",        // distinguishes payout from payment entries
        amount:      0,               // not a payment, don't count against dues
        payoutAmount: amount,         // actual payout amount for display
        takenMonth:  member.takenMonth,
        date:        receiptDateISO,
        receiptDate: receiptDateISO,
        narration:   narration || ("Payout given to " + member.name + " (Month " + member.takenMonth + ")")
    });
    member.history.sort(function(a,b){ return new Date(b.receiptDate||b.date) - new Date(a.receiptDate||a.date); });

    // Cap: don't allow over-payout
    let payoutDue  = calcPayout(group, member.takenMonth);
    let totalGiven = transactions
        .filter(function(t){ return t.type === "payout_given" && t.member === member.name && t.group === groupName; })
        .reduce(function(s,t){ return s + (t.amount||0); }, 0);
    if (totalGiven > payoutDue) {
        showToast("⚠️ Warning: Total given (" + fmt(totalGiven) + ") exceeds payout due (" + fmt(payoutDue) + ")", "warning");
    }

    // Keep last 2000 transactions
    if (transactions.length > 2000) transactions.splice(0, transactions.length - 2000);
    transactions.sort(function(a,b){ return new Date(b.receiptDate||b.date) - new Date(a.receiptDate||a.date); });

    save();
    showToast("✅ Payout of " + fmt(amount) + " recorded for " + member.name, "success");

    // Clear inputs, refresh view
    if (amtEl)  amtEl.value  = "";
    if (narrEl) narrEl.value = "";
    mgShowGroup(groupName);
}

/* ── Search / filter ── */
/* ── Inline narration edit ── */
function mgStartEditNarr(tid, groupName, memberIdx, currentText) {
    let cell = document.getElementById("mgNarrText_" + tid);
    if (!cell) return;
    // Avoid double-editing
    if (cell.querySelector("textarea")) return;
    let textarea = document.createElement("textarea");
    textarea.value = currentText;
    textarea.style.cssText = "width:100%;min-height:56px;resize:vertical;padding:6px 8px;background:var(--surface);border:1.5px solid var(--primary);border-radius:6px;color:var(--text);font-family:inherit;font-size:12px;line-height:1.5;box-shadow:0 0 0 3px rgba(37,99,235,0.12);outline:none";
    // Save button
    let saveBtn = document.createElement("button");
    saveBtn.textContent = "\u2713 Save";
    saveBtn.className   = "btn btn-primary";
    saveBtn.style.cssText = "margin-top:5px;padding:4px 12px;font-size:12px";
    // Cancel button
    let cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className   = "btn btn-secondary";
    cancelBtn.style.cssText = "margin-top:5px;margin-left:6px;padding:4px 10px;font-size:12px";

    saveBtn.onclick = function() {
        let newText = textarea.value.trim();
        // Update in transactions array
        let t = transactions.find(function(tx){ return String(tx.id) === tid; });
        if (t) {
            t.narration = newText;
            t.reason    = newText || t.reason;
        }
        // Update the matching member.history entry
        let group  = groups[groupName];
        let member = group ? group.members[memberIdx] : null;
        if (member && member.history) {
            // find the history entry whose receiptDate matches this transaction
            let tx = transactions.find(function(tx){ return String(tx.id) === tid; });
            if (tx) {
                let he = member.history.find(function(h){
                    return h.receiptDate === tx.receiptDate && h.narration && h.narration.includes("Payout given:");
                });
                if (he) he.narration = "\ud83d\udcb8 Payout given: " + (tx.amount ? tx.amount.toLocaleString("en-IN") : "") + (newText ? " \u2014 " + newText : "");
            }
        }
        save();
        showToast("\u2705 Narration updated", "success");
        mgShowGroup(groupName);
    };
    cancelBtn.onclick = function() { mgShowGroup(groupName); };

    // Replace span content with edit UI
    cell.innerHTML = "";
    cell.appendChild(textarea);
    cell.appendChild(saveBtn);
    cell.appendChild(cancelBtn);
    textarea.focus();
}

/* ── Delete a payout entry ── */
function mgDeletePayout(tid, groupName, memberIdx) {
    let t = transactions.find(function(tx){ return String(tx.id) === tid; });
    if (!t) { showToast("\u26a0\ufe0f Entry not found", "warning"); return; }
    if (!confirm("Delete payout of " + fmt(t.amount) + " on " + new Date(t.receiptDate||t.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) + "?")) return;

    // Remove from transactions
    let idx = transactions.findIndex(function(tx){ return String(tx.id) === tid; });
    if (idx !== -1) transactions.splice(idx, 1);

    // Remove matching member.history entry
    let group  = groups[groupName];
    let member = group ? group.members[memberIdx] : null;
    if (member && member.history) {
        let hi = member.history.findIndex(function(h){
            return h.receiptDate === t.receiptDate && h.narration && h.narration.includes("Payout given:");
        });
        if (hi !== -1) member.history.splice(hi, 1);
    }

    save();
    showToast("\ud83d\uddd1 Payout entry deleted", "info");
    mgShowGroup(groupName);
}

function mgLiveSearch() {
    let query = (document.getElementById("mgSearchBox")?.value || "").toLowerCase().trim();
    let banner = document.getElementById("mgSearchBanner");
    let items  = document.querySelectorAll("#mgGroupList .group-item");

    if (!query) {
        items.forEach(function(el){ el.style.display = ""; });
        if (banner) banner.style.display = "none";
        return;
    }

    let hits = 0;
    items.forEach(function(el) {
        let gName = (el.querySelector(".group-title")?.textContent || "").toLowerCase();
        let gObj  = groups[Object.keys(groups).find(function(k){ return k.toLowerCase() === gName; })];
        let memberHit = gObj ? gObj.members.some(function(m){ return m.taken && m.name.toLowerCase().includes(query); }) : false;
        let visible   = gName.includes(query) || memberHit;
        el.style.display = visible ? "" : "none";
        if (visible) hits++;
    });

    if (banner) {
        banner.textContent = hits > 0 ? ("🔍 " + hits + " group" + (hits!==1?"s":"") + " matched") : ("No results for \u201c" + query + "\u201d");
        banner.style.display = "";
    }
}
function mgClearSearch() {
    let box = document.getElementById("mgSearchBox");
    if (box) box.value = "";
    mgLiveSearch();
}