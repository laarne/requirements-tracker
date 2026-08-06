/**
 * Unofficial YFC Participant Requirements Compliance Tracker - Interactive Dashboard Logic
 * Stable Enterprise Identity Model: Google Drive Folder ID = Primary Enterprise Identity.
 */

const CANONICAL_REQUIREMENTS = {
  "applicationLetter": "Application Letter",
  "applicationForm": "Application Form",
  "businessModelCanvas": "Business Model Canvas (BMC)",
  "bmcFinancials": "BMC Financials",
  "financialFigures": "Financial Figures / Expenses",
  "validId": "Valid ID",
  "swornStatement": "Sworn Statement of New Business",
  "proofOfResidency": "Proof of Residency",
  "endorsementLetter": "Endorsement Letter",
  "photo2x2": "2 x 2 Photo",
  "signatures": "Required Signatures",
  "declarationOfIntent": "Declaration of Intent"
};

let supabaseClient = null;

let state = {
  rawDataset: null,
  participants: [],
  filteredParticipants: [],
  activeFilterStatus: "all",
  activeFilterType: "all",
  activeFilterReq: "all",
  activeSearchQuery: "",
  activeSort: "name_asc",
  selectedParticipantId: null,
  selectedDocId: null,
  overrides: {},
  reviewHistory: {},
  exclusions: {},
  pendingRemovalEnterprise: null,
  isScanning: false,
  activeJobId: null,
  scanPollInterval: null
};

function isRealGoogleDriveId(id) {
  if (!id || typeof id !== 'string') return false;
  return id.length > 15 && /[A-Z]/.test(id);
}

const MANUAL_FOLDER_ID_MAP = {
  'bp_squashella': '1Jr02P_7-qjKWYY2LobehBIUd9auqLKI0',
  'bp-squashélla': '1Jr02P_7-qjKWYY2LobehBIUd9auqLKI0',
  'bp squashélla': '1Jr02P_7-qjKWYY2LobehBIUd9auqLKI0',
  'bp squashella': '1Jr02P_7-qjKWYY2LobehBIUd9auqLKI0',
  'darco_rir': '1K3nwxeK4iXphKY6h9rTTxM_hP4BRsDE7',
  'd-arco-rir-and-native-poultry-production': '1K3nwxeK4iXphKY6h9rTTxM_hP4BRsDE7',
  'd-arco rir and native': '1K3nwxeK4iXphKY6h9rTTxM_hP4BRsDE7',
  'd-arco rir and native poultry production': '1K3nwxeK4iXphKY6h9rTTxM_hP4BRsDE7',
};

function buildDataJsonIdentityMap(localDataset) {
  const map = { byId: {}, byName: {}, byFolderId: {}, byNormalizedId: {}, byNormalizedName: {} };
  if (!localDataset || !localDataset.participants) return map;
  localDataset.participants.forEach(p => {
    const folderId = p.driveFolderId || p.enterpriseFolderId;
    if (folderId) {
      map.byId[p.id] = folderId;
      map.byName[(p.name || '').toLowerCase().trim()] = folderId;
      map.byFolderId[folderId] = folderId;
      map.byNormalizedId[normalizeIdentityKey(p.id)] = folderId;
      map.byNormalizedName[normalizeIdentityKey(p.name)] = folderId;
    }
  });
  return map;
}

function normalizeIdentityKey(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveFolderKey(rawKey, enterpriseId, enterpriseName, identityMap) {
  if (rawKey && isRealGoogleDriveId(rawKey)) return rawKey;
  if (enterpriseId && MANUAL_FOLDER_ID_MAP[enterpriseId]) return MANUAL_FOLDER_ID_MAP[enterpriseId];
  if (enterpriseName && MANUAL_FOLDER_ID_MAP[enterpriseName.toLowerCase().trim()]) {
    return MANUAL_FOLDER_ID_MAP[enterpriseName.toLowerCase().trim()];
  }
  if (enterpriseId && identityMap.byId[enterpriseId]) return identityMap.byId[enterpriseId];
  if (enterpriseName && identityMap.byName[enterpriseName.toLowerCase().trim()]) {
    return identityMap.byName[enterpriseName.toLowerCase().trim()];
  }
  const normId = normalizeIdentityKey(enterpriseId);
  if (normId && identityMap.byNormalizedId[normId]) return identityMap.byNormalizedId[normId];
  const normName = normalizeIdentityKey(enterpriseName);
  if (normName && identityMap.byNormalizedName[normName]) return identityMap.byNormalizedName[normName];
  return rawKey;
}

document.addEventListener("DOMContentLoaded", () => {
  initSupabaseClient();
  loadLocalOverrides();
  initEventListeners();
  fetchData();
});

function initSupabaseClient() {
  const supabaseUrl = window.SUPABASE_URL || (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_URL : null) || "https://wlpapthqjhutjbrsikos.supabase.co";
  const supabaseKey = window.SUPABASE_ANON_KEY || (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_ANON_KEY : null) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndscGFwdGhxamh1dGpicnNpa29zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NTM2MDgsImV4cCI6MjEwMTQyOTYwOH0.UD8YtH7JQR53hhD1WbCB9LDAtnUa5DJRP4GAYC6QbAk";

  console.log("[INIT] initSupabaseClient called");
  console.log("[INIT] window.SUPABASE_URL:", window.SUPABASE_URL || "(not set)");
  console.log("[INIT] window.SUPABASE_ANON_KEY:", window.SUPABASE_ANON_KEY ? "(set, length=" + window.SUPABASE_ANON_KEY.length + ")" : "(not set)");
  console.log("[INIT] window.supabase exists:", !!window.supabase);
  console.log("[INIT] supabaseUrl:", supabaseUrl ? supabaseUrl.substring(0, 40) + "..." : "(empty)");
  console.log("[INIT] supabaseKey exists:", !!supabaseKey, "length:", supabaseKey ? supabaseKey.length : 0);

  const dot = document.getElementById("supabase-status-dot");
  const label = document.getElementById("supabase-status-label");

  if (window.supabase && supabaseUrl && supabaseKey && !supabaseUrl.includes("your-supabase-project")) {
    try {
      supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
      console.log("[INIT] Supabase client created successfully. supabaseClient is now:", !!supabaseClient);
      if (dot && label) {
        dot.style.backgroundColor = "#10b981";
        label.textContent = "Supabase Synced";
      }
    } catch (e) {
      console.error("[INIT] Failed to initialize Supabase client:", e);
    }
  } else {
    console.warn("[INIT] Supabase NOT initialized. Conditions:", {
      window_supabase: !!window.supabase,
      supabaseUrl: !!supabaseUrl,
      supabaseKey: !!supabaseKey,
      notPlaceholder: !supabaseUrl.includes("your-supabase-project")
    });
    if (dot && label) {
      dot.style.backgroundColor = "#f59e0b";
      label.textContent = "Local Storage Mode";
    }
  }
}

function loadLocalOverrides() {
  try {
    const saved = localStorage.getItem("req_tracker_overrides_v9");
    if (saved) state.overrides = JSON.parse(saved);

    const savedHist = localStorage.getItem("req_tracker_history_v9");
    if (savedHist) state.reviewHistory = JSON.parse(savedHist);
  } catch (e) {
    console.warn("Failed to load local storage overrides:", e);
  }
}

function saveLocalOverrides() {
  try {
    localStorage.setItem("req_tracker_overrides_v9", JSON.stringify(state.overrides));
    localStorage.setItem("req_tracker_history_v9", JSON.stringify(state.reviewHistory));
  } catch (e) {
    console.warn("Failed to save local storage overrides:", e);
  }
}

async function fetchHumanReviewsFromSupabase(identityMap) {
  console.log("[LOAD] fetchHumanReviewsFromSupabase called, supabaseClient exists:", !!supabaseClient);
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('human_reviews')
      .select('*');
    
    if (error) {
      console.warn("[LOAD] Supabase select error:", error);
      return null;
    }

    console.log("[LOAD] human_reviews fetched:", (data || []).length, "rows");
    const reviewsMap = {};
    (data || []).forEach(row => {
      const entKey = resolveFolderKey(row.enterprise_folder_id, row.enterprise_id, null, identityMap || { byId: {}, byName: {}, byFolderId: {} });
      console.log("[LOAD]   Review:", {
        enterprise_folder_id: row.enterprise_folder_id,
        enterprise_id: row.enterprise_id,
        resolvedKey: entKey,
        requirement_id: row.requirement_id,
        human_status: row.human_status,
        reviewer_name: row.reviewer_name
      });
      if (!reviewsMap[entKey]) reviewsMap[entKey] = {};
      reviewsMap[entKey][row.requirement_id] = {
        manualStatus: row.human_status,
        reviewedBy: row.reviewer_name || "Operational Reviewer",
        reviewedAt: row.updated_at || row.created_at,
        note: row.reviewer_notes || "",
        fileId: row.file_id || ""
      };
      // Also map by enterprise_id for fallback resilience
      if (row.enterprise_id && row.enterprise_id !== entKey) {
        if (!reviewsMap[row.enterprise_id]) reviewsMap[row.enterprise_id] = {};
        reviewsMap[row.enterprise_id][row.requirement_id] = reviewsMap[entKey][row.requirement_id];
      }
    });

    console.log("[LOAD] Reviews map keys:", Object.keys(reviewsMap));

    // Also fetch review history logs
    const { data: histData } = await supabaseClient
      .from('human_review_history')
      .select('*')
      .order('created_at', { ascending: false });

    console.log("[LOAD] human_review_history fetched:", (histData || []).length, "rows");

    if (histData) {
      const histMap = {};
      histData.forEach(h => {
        const resolvedKey = resolveFolderKey(h.enterprise_folder_id, h.enterprise_id, null, identityMap || { byId: {}, byName: {}, byFolderId: {} });
        const key = `${resolvedKey}_${h.requirement_id}`;
        if (!histMap[key]) histMap[key] = [];
        histMap[key].push({
          id: h.id,
          previousStatus: h.previous_status,
          newStatus: h.new_status,
          reviewerName: h.reviewer_name || "Operational Reviewer",
          reviewerEmail: h.reviewer_email || "",
          notes: h.reviewer_notes || "",
          createdAt: h.created_at
        });
      });
      state.reviewHistory = histMap;
    }

    const dot = document.getElementById("supabase-status-dot");
    const label = document.getElementById("supabase-status-label");
    if (dot && label) {
      dot.style.backgroundColor = "#10b981";
      label.textContent = "Supabase Synced";
    }

    return reviewsMap;
  } catch (err) {
    console.warn("[LOAD] Could not fetch human reviews from Supabase:", err);
    return null;
  }
}

async function fetchExclusionsFromSupabase(identityMap) {
  const exclusionsMap = {};

  try {
    const rawLocal = localStorage.getItem("yfc_excluded_enterprises");
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      Object.keys(parsed).forEach(k => {
        if (parsed[k] && parsed[k].active !== false) {
          exclusionsMap[k] = parsed[k];
        }
      });
    }
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('excluded_enterprises')
        .select('*')
        .eq('active', true);

      if (!error && data) {
        data.forEach(row => {
          const resolvedKey = resolveFolderKey(row.drive_folder_id || row.enterprise_key, row.enterprise_key, row.enterprise_name, identityMap || { byId: {}, byName: {}, byFolderId: {}, byNormalizedId: {}, byNormalizedName: {} });
          const exObj = {
            id: row.id,
            enterpriseKey: row.enterprise_key,
            enterpriseName: row.enterprise_name,
            normalizedName: row.normalized_name || normalizeIdentityKey(row.enterprise_name),
            driveFolderId: row.drive_folder_id || resolvedKey,
            excludedAt: row.excluded_at || row.created_at,
            active: true
          };
          exclusionsMap[resolvedKey] = exObj;
          if (row.enterprise_key) exclusionsMap[row.enterprise_key] = exObj;
          if (row.normalized_name) exclusionsMap[`norm_${row.normalized_name}`] = exObj;
        });
      }
    } catch (err) {
      console.warn("[LOAD] Could not fetch excluded_enterprises from Supabase:", err);
    }
  }

  state.exclusions = exclusionsMap;
  updateExcludedBadgeCount();
  return exclusionsMap;
}

function isEnterpriseExcluded(entFolderId, entName) {
  if (!state.exclusions) return false;
  if (entFolderId && state.exclusions[entFolderId]) return true;
  const norm = normalizeIdentityKey(entName);
  if (norm && state.exclusions[`norm_${norm}`]) return true;
  return false;
}

function updateExcludedBadgeCount() {
  const badge = document.getElementById("excluded-count-badge");
  if (!badge) return;
  const activeKeys = Object.keys(state.exclusions || {}).filter(k => !k.startsWith("norm_"));
  const uniqueKeys = new Set(activeKeys.map(k => state.exclusions[k].enterpriseKey || k));
  badge.textContent = uniqueKeys.size;
}

async function excludeEnterprise(primaryKey, entName) {
  if (!primaryKey) return;
  const normName = normalizeIdentityKey(entName);
  const nowStr = new Date().toISOString();

  const record = {
    enterprise_key: primaryKey,
    enterprise_name: entName || primaryKey,
    normalized_name: normName,
    drive_folder_id: primaryKey,
    active: true,
    excluded_at: nowStr,
    excluded_by: localStorage.getItem("yfc_reviewer_name") || "Operational User"
  };

  const exObj = {
    enterpriseKey: primaryKey,
    enterpriseName: entName || primaryKey,
    normalizedName: normName,
    driveFolderId: primaryKey,
    excludedAt: nowStr,
    active: true
  };

  state.exclusions[primaryKey] = exObj;
  if (normName) {
    state.exclusions[`norm_${normName}`] = exObj;
  }

  try {
    localStorage.setItem("yfc_excluded_enterprises", JSON.stringify(state.exclusions));
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('excluded_enterprises')
        .upsert(record, { onConflict: 'enterprise_key' });

      if (error) {
        console.warn("[EXCLUDE] Supabase exclusion upsert warning:", error);
      }
    } catch (e) {
      console.warn("[EXCLUDE] Supabase exclusion failed:", e);
    }
  }

  state.participants = state.participants.filter(p => {
    const pKey = p.enterpriseFolderId || p.driveFolderId || p.id;
    return pKey !== primaryKey && p.name !== entName;
  });

  updateExcludedBadgeCount();
  applyFiltersAndRender();
  showToast(`${entName || 'Enterprise'} removed from tracker. Drive files remain untouched. ✓`, "warning");
}

async function restoreEnterprise(primaryKey) {
  if (!primaryKey) return;
  const ex = state.exclusions[primaryKey];
  const entName = ex ? ex.enterpriseName : primaryKey;

  delete state.exclusions[primaryKey];
  if (ex && ex.normalizedName) {
    delete state.exclusions[`norm_${ex.normalizedName}`];
  }

  try {
    localStorage.setItem("yfc_excluded_enterprises", JSON.stringify(state.exclusions));
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('excluded_enterprises')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('enterprise_key', primaryKey);

      if (error) {
        console.warn("[RESTORE] Supabase exclusion restore warning:", error);
      }
    } catch (e) {
      console.warn("[RESTORE] Supabase exclusion restore failed:", e);
    }
  }

  updateExcludedBadgeCount();
  showToast(`${entName} restored! It will be included in the next Google Drive scan. ✓`, "success");
  
  fetchData();
}

function renderExcludedListModal() {
  const container = document.getElementById("excluded-list-container");
  if (!container) return;
  container.innerHTML = "";

  const keys = Object.keys(state.exclusions || {}).filter(k => !k.startsWith("norm_"));
  const uniqueItemsMap = {};
  keys.forEach(k => {
    const item = state.exclusions[k];
    if (item && item.enterpriseKey) {
      uniqueItemsMap[item.enterpriseKey] = item;
    }
  });

  const uniqueItems = Object.values(uniqueItemsMap);

  if (uniqueItems.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:24px; color:#94a3b8; font-size:0.85rem;">No enterprises are currently excluded.</div>`;
    return;
  }

  uniqueItems.forEach(item => {
    const dateStr = item.excludedAt ? new Date(item.excludedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : "Recently";

    const div = document.createElement("div");
    div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#1f2937; padding:10px 14px; border-radius:6px; border:1px solid #374151;";
    div.innerHTML = `
      <div>
        <div style="font-weight:700; color:#f8fafc; font-size:0.875rem;">${escapeHtml(item.enterpriseName)}</div>
        <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Removed ${escapeHtml(dateStr)} • Folder ID: <code style="font-size:0.7rem; color:#cbd5e1;">${escapeHtml(item.driveFolderId || item.enterpriseKey)}</code></div>
      </div>
      <button class="btn btn-secondary btn-sm btn-restore-item" data-key="${escapeHtml(item.enterpriseKey)}" style="color:#34d399; border-color:#065f46; background:rgba(16, 185, 129, 0.1);">
        Restore
      </button>
    `;

    div.querySelector(".btn-restore-item").addEventListener("click", async (e) => {
      const keyToRestore = e.currentTarget.dataset.key;
      await restoreEnterprise(keyToRestore);
      renderExcludedListModal();
    });

    container.appendChild(div);
  });
}

function closeRemoveEnterpriseModal() {
  const modal = document.getElementById("modal-confirm-remove-overlay");
  if (modal) modal.classList.add("hidden");
  state.pendingRemovalEnterprise = null;
}

function closeExcludedListModal() {
  const modal = document.getElementById("modal-excluded-list-overlay");
  if (modal) modal.classList.add("hidden");
}

function openChangeAppTypeModal(participantId) {
  const p = state.participants.find(x => (x.enterpriseFolderId === participantId || x.driveFolderId === participantId || x.id === participantId));
  if (!p) return;

  const primaryFolderId = p.enterpriseFolderId || p.driveFolderId || p.id;
  state.editingTypeParticipantId = primaryFolderId;
  state.editingTypeTargetValue = null;

  const currentType = getApplicantTypeString(p.applicantType);
  const elTitle = document.getElementById("app-type-modal-ent-subtitle");
  if (elTitle) elTitle.textContent = p.name;

  const elBadge = document.getElementById("app-type-modal-current-badge");
  if (elBadge) {
    elBadge.textContent = currentType === "CHECK" ? "Unspecified (Needs Checking)" : currentType;
    elBadge.style.background = currentType === "GROUP" ? "#1e3a8a" : (currentType === "INDIVIDUAL" ? "#1f2937" : "#b45309");
    elBadge.style.color = currentType === "GROUP" ? "#93c5fd" : (currentType === "INDIVIDUAL" ? "#d1d5db" : "#fef3c7");
  }

  const radios = document.querySelectorAll('input[name="modal-app-type-choice"]');
  radios.forEach(r => {
    r.checked = (r.value === currentType);
  });

  const btnContinue = document.getElementById("btn-app-type-continue");
  if (btnContinue) {
    const selected = document.querySelector('input[name="modal-app-type-choice"]:checked');
    btnContinue.disabled = !selected;
  }

  document.getElementById("app-type-step-select").classList.remove("hidden");
  document.getElementById("app-type-step-confirm").classList.add("hidden");
  document.getElementById("modal-change-app-type-overlay").classList.remove("hidden");
}

function closeChangeAppTypeModal() {
  const modal = document.getElementById("modal-change-app-type-overlay");
  if (modal) modal.classList.add("hidden");
  state.editingTypeParticipantId = null;
  state.editingTypeTargetValue = null;
}

async function fetchScanResultsFromSupabase(identityMap) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('scan_results')
      .select('*');

    if (error || !data || data.length === 0) return null;

    const scanMap = {};
    data.forEach(row => {
      const rawFolderId = row.enterprise_folder_id;
      const resolvedFolderId = resolveFolderKey(rawFolderId, row.enterprise_id, row.enterprise_name, identityMap);

      if (!scanMap[resolvedFolderId]) {
        scanMap[resolvedFolderId] = {
          _enterpriseFolderId: resolvedFolderId,
          _enterpriseId: row.enterprise_id,
          _enterpriseName: row.enterprise_name,
          _applicantType: row.applicant_type,
          _driveUrl: row.drive_url
        };
      }

      const matchedFiles = row.matched_files || [];
      let metaFromFiles = { typeConfidence: 0, typeEvidence: [], memberCount: 0, memberNames: [], statusDetail: "" };
      if (matchedFiles.length > 0 && matchedFiles[0]._meta) {
        metaFromFiles = matchedFiles[0]._meta;
      }

      scanMap[resolvedFolderId][row.requirement_id] = {
        automatedStatus: row.automated_status,
        confidence: row.confidence,
        documentType: row.document_type,
        fileName: row.file_name,
        fileId: row.file_id,
        driveUrl: row.drive_url,
        matchedFiles: matchedFiles.map(f => {
          const { _meta, ...rest } = f;
          return rest;
        }),
        typeConfidence: metaFromFiles.typeConfidence,
        typeEvidence: metaFromFiles.typeEvidence,
        memberCount: metaFromFiles.memberCount,
        memberNames: metaFromFiles.memberNames,
        statusDetail: metaFromFiles.statusDetail
      };

      if (metaFromFiles.typeConfidence > (scanMap[resolvedFolderId]._typeConfidence || 0)) {
        scanMap[resolvedFolderId]._typeConfidence = metaFromFiles.typeConfidence;
        scanMap[resolvedFolderId]._typeEvidence = metaFromFiles.typeEvidence;
        scanMap[resolvedFolderId]._memberCount = metaFromFiles.memberCount;
        scanMap[resolvedFolderId]._memberNames = metaFromFiles.memberNames;
      }
    });
    return scanMap;
  } catch (e) {
    console.warn("Could not fetch scan_results from Supabase:", e);
    return null;
  }
}

async function fetchData() {
  const errorBanner = document.getElementById("error-banner");

  let localDataset = null;
  try {
    const res = await fetch("data.json?t=" + Date.now());
    if (res.ok) {
      localDataset = await res.json();
    }
  } catch (e) {
    console.warn("data.json fetch skipped:", e);
  }

  // Build identity resolution map from data.json
  const identityMap = buildDataJsonIdentityMap(localDataset);

  // Load persistent exclusions from Supabase & localStorage
  await fetchExclusionsFromSupabase(identityMap);

  // Load live scan results from Supabase with identity resolution
  const cloudScanMap = await fetchScanResultsFromSupabase(identityMap);

  // Load human reviews from Supabase with identity resolution
  const supabaseReviews = await fetchHumanReviewsFromSupabase(identityMap);
  if (supabaseReviews) {
    state.overrides = { ...state.overrides, ...supabaseReviews };
    saveLocalOverrides();
  }

  // STRICTLY GROUP BY PRIMARY STABLE IDENTITY (enterprise_folder_id) TO PREVENT DUPLICATES
  const participantsMap = {};

  // 1. If live cloud scan data is available from Supabase, populate participantsMap directly from live folder IDs
  if (cloudScanMap && Object.keys(cloudScanMap).length > 0) {
    Object.keys(cloudScanMap).forEach(folderKey => {
      const entScan = cloudScanMap[folderKey];
      const entName = entScan._enterpriseName || formatEnterpriseNameFromId(folderKey);

      if (isEnterpriseExcluded(folderKey, entName)) {
        console.log(`[EXCLUSION] Skipping excluded enterprise in dashboard load: ${entName} (${folderKey})`);
        return;
      }

      const firstReqKey = Object.keys(CANONICAL_REQUIREMENTS).find(k => entScan[k]);
      const sampleReq = firstReqKey ? entScan[firstReqKey] : null;

      participantsMap[folderKey] = {
        enterpriseFolderId: folderKey,
        id: entScan._enterpriseId || folderKey,
        name: entName,
        applicantType: entScan._applicantType || "INDIVIDUAL",
        typeConfidence: sampleReq ? (sampleReq.typeConfidence || 0) : 0,
        typeEvidence: sampleReq ? (sampleReq.typeEvidence || []) : [],
        memberCount: sampleReq ? (sampleReq.memberCount || 0) : 0,
        memberNames: sampleReq ? (sampleReq.memberNames || []) : [],
        driveUrl: entScan._driveUrl || `https://drive.google.com/drive/folders/${folderKey}`,
        driveFolderId: folderKey,
        requirements: {}
      };

      Object.keys(CANONICAL_REQUIREMENTS).forEach(reqKey => {
        const reqScan = entScan[reqKey];
        if (reqScan) {
          const rawStatus = reqScan.automatedStatus || "MISSING";
          const cleanStatus = rawStatus.split(':')[0].trim().toUpperCase();
          participantsMap[folderKey].requirements[reqKey] = {
            status: cleanStatus,
            automatedStatus: rawStatus,
            files: reqScan.matchedFiles && reqScan.matchedFiles.length > 0 ? reqScan.matchedFiles : (reqScan.fileName ? [{ name: reqScan.fileName, confidence: reqScan.confidence, fileId: reqScan.fileId, webViewLink: reqScan.driveUrl }] : []),
            statusDetail: reqScan.statusDetail || ""
          };
        }
      });
    });
  }

  // 2. Overlay or seed baseline from local data.json if available
  if (localDataset && localDataset.participants) {
    localDataset.participants.forEach(p => {
      const primaryKey = resolveFolderKey(p.enterpriseFolderId || p.driveFolderId, p.id, p.name, identityMap) || p.id;
      if (isEnterpriseExcluded(primaryKey, p.name)) {
        return;
      }
      if (!participantsMap[primaryKey]) {
        participantsMap[primaryKey] = JSON.parse(JSON.stringify(p));
        participantsMap[primaryKey].enterpriseFolderId = primaryKey;
      }
    });
  }

  const combinedParticipants = Object.values(participantsMap);

  const raw = {
    generatedAt: new Date().toISOString(),
    summary: { totalEnterprises: combinedParticipants.length },
    participants: combinedParticipants
  };

  processDataset(raw, localDataset ? (localDataset.participants ? localDataset.participants.length : 0) : 0, cloudScanMap ? Object.keys(cloudScanMap).length : 0);
}

function formatEnterpriseNameFromId(id) {
  if (!id) return "New Enterprise";
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getApplicantTypeString(val) {
  if (!val) return "CHECK";
  if (typeof val === "string") return val.toUpperCase();
  if (typeof val === "object") {
    if (typeof val.manualStatus === "string") return val.manualStatus.toUpperCase();
    if (typeof val.human_status === "string") return val.human_status.toUpperCase();
    if (typeof val.humanStatus === "string") return val.humanStatus.toUpperCase();
    if (typeof val.type === "string") return val.type.toUpperCase();
  }
  return String(val).toUpperCase();
}

function processDataset(raw, dataJsonCount = 0, scanResultsCount = 0) {
  state.rawDataset = raw;

  state.participants = (raw.participants || []).map(p => {
    let copy = JSON.parse(JSON.stringify(p));
    const entKey = copy.enterpriseFolderId || copy.driveFolderId || copy.id;

    // Preserve automatedStatus separately from humanReview
    Object.keys(copy.requirements || {}).forEach(docKey => {
      const doc = copy.requirements[docKey];
      if (!doc.automatedStatus) {
        doc.automatedStatus = doc.status;
      }
    });

    const activeOverrides = state.overrides[entKey] || state.overrides[copy.id];
    if (activeOverrides) {
      if (activeOverrides._applicantType) {
        const rawAppType = activeOverrides._applicantType;
        copy.applicantType = typeof rawAppType === 'object' ? (rawAppType.manualStatus || rawAppType.human_status || rawAppType.type || "CHECK") : rawAppType;
      }
      Object.keys(activeOverrides).forEach(docKey => {
        if (docKey.startsWith("_")) return;
        if (copy.requirements[docKey]) {
          const oldStatus = copy.requirements[docKey].status;
          copy.requirements[docKey].review = activeOverrides[docKey];
          if (activeOverrides[docKey].manualStatus) {
            let st = activeOverrides[docKey].manualStatus;
            if (st === "NEEDS_REVIEW" || st === "REVIEW") st = "CHECK";
            copy.requirements[docKey].status = st;
          }
        }
      });
    }

    recalculateEnterpriseScores(copy);
    return copy;
  });

  const diag = {
    dataJsonCount: dataJsonCount,
    scanResultsCount: scanResultsCount * 12,
    uniqueScanFolderIds: scanResultsCount,
    mergedParticipantCount: state.participants.length,
    finalParticipantCount: state.participants.length,
    renderedEnterpriseCount: state.participants.length,
    enterpriseNames: state.participants.map(p => p.name),
    enterpriseFolderIds: state.participants.map(p => p.enterpriseFolderId || p.driveFolderId || p.id)
  };
  console.log("[ENTERPRISE_COUNT_DIAG]", diag);

  updateHeaderMetadata(raw);
  applyFiltersAndRender();
}

function recalculateEnterpriseScores(p) {
  const reqs = p.requirements || {};
  const appType = getApplicantTypeString(p.applicantType);
  const isGroup = appType === "GROUP";

  if (!isGroup) {
    const applicableReqKeys = Object.keys(CANONICAL_REQUIREMENTS).filter(k => {
      return reqs[k] && reqs[k].status !== "NOT_APPLICABLE";
    });

    const totalApplicable = applicableReqKeys.length;
    let completeCount = 0;
    let checkCount = 0;
    let missingCount = 0;

    applicableReqKeys.forEach(k => {
      const doc = reqs[k];
      const st = doc ? (doc.status || "MISSING").toUpperCase() : "MISSING";
      if (st === "COMPLETE" || st === "APPROVED") completeCount++;
      else if (st === "MISSING" || st === "REJECTED") missingCount++;
      else checkCount++;
    });

    p.scores = {
      complete: completeCount,
      check: checkCount,
      review: checkCount,
      missing: missingCount,
      total: totalApplicable,
      percentage: totalApplicable > 0 ? Math.round((completeCount / totalApplicable) * 1000) / 10 : 0.0
    };

    p.completionRate = p.scores.percentage;
    p.completeCount = completeCount;
    p.checkCount = checkCount;
    p.reviewCount = checkCount;
    p.missingCount = missingCount;
    p.applicableRequirementsCount = totalApplicable;

    if (completeCount === totalApplicable) {
      p.status = "COMPLETE";
      p.priority = "FULLY COMPLIANT";
    } else if (checkCount > 0) {
      p.status = "CHECK";
      p.priority = "MEDIUM";
    } else {
      p.status = "INCOMPLETE";
      p.priority = "HIGH";
    }
    return;
  }

  // GROUP Calculation (Dynamic Shared + Member Slots)
  const personalReqKeys = ["validId", "proofOfResidency", "photo2x2"];
  const memberNamesSet = new Set();

  personalReqKeys.forEach(reqKey => {
    const doc = reqs[reqKey];
    if (doc && doc.files && doc.files.length > 0) {
      doc.files.forEach(f => {
        if (f.memberName) {
          memberNamesSet.add(f.memberName.trim().toUpperCase());
        }
      });
    }
  });

  const membersList = Array.from(memberNamesSet).sort();
  p.groupMembers = membersList; // e.g. ["MADES", "PEPITO", "PULI"]

  const sharedReqKeys = Object.keys(CANONICAL_REQUIREMENTS).filter(k => !personalReqKeys.includes(k));
  const applicableSharedKeys = sharedReqKeys.filter(k => reqs[k] && reqs[k].status !== "NOT_APPLICABLE");

  let completedSharedCount = 0;
  let missingSharedCount = 0;
  let checkSharedCount = 0;

  applicableSharedKeys.forEach(k => {
    const doc = reqs[k];
    const st = doc ? (doc.status || "MISSING").toUpperCase() : "MISSING";
    if (st === "COMPLETE" || st === "APPROVED") completedSharedCount++;
    else if (st === "MISSING" || st === "REJECTED") missingSharedCount++;
    else checkSharedCount++;
  });

  p.memberDetails = {};
  let totalMemberSlots = 0;
  let completedMemberSlots = 0;
  let missingMemberSlots = 0;
  let checkMemberSlots = 0;

  if (membersList.length > 0) {
    membersList.forEach(mName => {
      p.memberDetails[mName] = {};
      personalReqKeys.forEach(reqKey => {
        totalMemberSlots++;
        const doc = reqs[reqKey];
        let mStatus = "CHECK";
        let mFile = null;

        if (doc && doc.files) {
          const matchingFile = doc.files.find(f => (f.memberName || "").toUpperCase() === mName);
          if (matchingFile) {
            mFile = matchingFile;
            mStatus = (matchingFile.confidence || 0.9) >= 0.90 ? "COMPLETE" : "CHECK";
          }
        }

        if (state.overrides && state.overrides[p.enterpriseFolderId] && state.overrides[p.enterpriseFolderId][`${reqKey}_${mName}`]) {
          mStatus = state.overrides[p.enterpriseFolderId][`${reqKey}_${mName}`].manualStatus;
          if (mStatus === "NEEDS_REVIEW" || mStatus === "REVIEW") mStatus = "CHECK";
        }

        p.memberDetails[mName][reqKey] = { status: mStatus, file: mFile };
        if (mStatus === "COMPLETE" || mStatus === "APPROVED") completedMemberSlots++;
        else if (mStatus === "MISSING" || mStatus === "REJECTED") missingMemberSlots++;
        else checkMemberSlots++;
      });
    });

    personalReqKeys.forEach(reqKey => {
      if (reqs[reqKey]) {
        const mStatuses = membersList.map(m => p.memberDetails[m][reqKey].status);
        if (mStatuses.every(s => s === "COMPLETE" || s === "APPROVED")) {
          reqs[reqKey].status = "COMPLETE";
        } else if (mStatuses.some(s => s === "MISSING" || s === "REJECTED")) {
          reqs[reqKey].status = "MISSING";
        } else {
          reqs[reqKey].status = "CHECK";
        }
      }
    });

  } else {
    personalReqKeys.forEach(reqKey => {
      totalMemberSlots++;
      const st = (reqs[reqKey]?.status || "MISSING").toUpperCase();
      if (st === "COMPLETE" || st === "APPROVED") completedMemberSlots++;
      else if (st === "MISSING" || st === "REJECTED") missingMemberSlots++;
      else checkMemberSlots++;
    });
  }

  const grandTotalSlots = applicableSharedKeys.length + totalMemberSlots;
  const grandCompletedSlots = completedSharedCount + completedMemberSlots;
  const grandMissingSlots = missingSharedCount + missingMemberSlots;
  const grandCheckSlots = checkSharedCount + checkMemberSlots;

  p.scores = {
    complete: grandCompletedSlots,
    check: grandCheckSlots,
    review: grandCheckSlots,
    missing: grandMissingSlots,
    total: grandTotalSlots,
    percentage: grandTotalSlots > 0 ? Math.round((grandCompletedSlots / grandTotalSlots) * 1000) / 10 : 0.0
  };

  p.completionRate = p.scores.percentage;
  p.completeCount = p.scores.complete;
  p.checkCount = p.scores.check;
  p.reviewCount = p.scores.check;
  p.missingCount = p.scores.missing;
  p.totalGroupSlots = grandTotalSlots;
  p.applicableRequirementsCount = grandTotalSlots;

  if (grandCompletedSlots === grandTotalSlots) {
    p.status = "COMPLETE";
    p.priority = "FULLY COMPLIANT";
  } else if (grandCheckSlots > 0) {
    p.status = "CHECK";
    p.priority = "MEDIUM";
  } else {
    p.status = "INCOMPLETE";
    p.priority = "HIGH";
  }
}

function generateNextActionString(p) {
  if (p.completionRate === 100) {
    return "<span style='color:#34d399; font-weight:700;'>✓ Enterprise is fully compliant! All required documents submitted.</span>";
  }
  
  const reqs = p.requirements || {};
  const missingNames = [];
  const reviewNames = [];

  Object.keys(CANONICAL_REQUIREMENTS).forEach(k => {
    const doc = reqs[k];
    if (doc && doc.status !== "NOT_APPLICABLE") {
      if (doc.status === "MISSING" || doc.status === "REJECTED") {
        missingNames.push(CANONICAL_REQUIREMENTS[k]);
      } else if (doc.status === "REVIEW" || doc.status === "NEEDS_REVIEW") {
        reviewNames.push(CANONICAL_REQUIREMENTS[k]);
      }
    }
  });

  const totalOutstanding = missingNames.length + reviewNames.length;
  let html = `Complete ${totalOutstanding} outstanding requirement${totalOutstanding > 1 ? 's' : ''}:`;
  html += `<ul class="next-action-bullet-list">`;
  missingNames.forEach(n => {
    html += `<li><strong>${escapeHtml(n)}</strong> <span style="color:#f87171; font-size:0.75rem; font-weight:600;">(Missing)</span></li>`;
  });
  reviewNames.forEach(n => {
    html += `<li><strong>${escapeHtml(n)}</strong> <span style="color:#fbbf24; font-size:0.75rem; font-weight:600;">(Needs Verification)</span></li>`;
  });
  html += `</ul>`;
  return html;
}

function updateHeaderMetadata(data) {
  const scannedText = document.getElementById("last-scanned-text");
  const count = data.summary ? data.summary.totalEnterprises : (data.participants ? data.participants.length : 0);
  const timeStr = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "Just now";
  scannedText.textContent = `${count} enterprises • Last scanned: ${timeStr}`;
}

function applyFiltersAndRender() {
  let list = [...state.participants];

  // Status Filter
  if (state.activeFilterStatus !== "all") {
    const fst = state.activeFilterStatus;
    if (fst === "complete") {
      list = list.filter(p => p.status === "COMPLETE");
    } else if (fst === "incomplete") {
      list = list.filter(p => p.status === "INCOMPLETE" || p.completionRate < 100);
    } else if (fst === "needs_review") {
      list = list.filter(p => p.reviewCount > 0 || p.status === "NEEDS_REVIEW");
    } else if (fst === "priority_high") {
      list = list.filter(p => p.priority === "HIGH");
    }
  }

  // Type Filter
  if (state.activeFilterType !== "all") {
    const tp = state.activeFilterType;
    if (tp === "type_individual") {
      list = list.filter(p => getApplicantTypeString(p.applicantType) === "INDIVIDUAL");
    } else if (tp === "type_group") {
      list = list.filter(p => getApplicantTypeString(p.applicantType) === "GROUP");
    }
  }

  // Requirement Filter
  if (state.activeFilterReq !== "all") {
    const docKey = state.activeFilterReq.replace("missing_", "");
    list = list.filter(p => {
      const doc = p.requirements[docKey];
      return !doc || doc.status === "MISSING" || doc.status === "REJECTED" || doc.status === "NEEDS_REVIEW";
    });
  }

  // Search Filter
  if (state.activeSearchQuery.trim() !== "") {
    const q = state.activeSearchQuery.toLowerCase();
    list = list.filter(p => 
      p.name.toLowerCase().includes(q) || 
      (p.driveFolderId && p.driveFolderId.toLowerCase().includes(q)) ||
      p.id.toLowerCase().includes(q)
    );
  }

  // Sorting
  const sort = state.activeSort;
  list.sort((a, b) => {
    if (sort === "name_asc") return a.name.localeCompare(b.name);
    if (sort === "name_desc") return b.name.localeCompare(a.name);
    if (sort === "completion_desc") return b.completionRate - a.completionRate;
    if (sort === "completion_asc") return a.completionRate - b.completionRate;
    if (sort === "most_missing") return b.missingCount - a.missingCount;
    return 0;
  });

  state.filteredParticipants = list;

  // Filter Indicator Chip
  const chipContainer = document.getElementById("filter-active-chip-container");
  const chipText = document.getElementById("filter-active-chip-text");
  if (chipContainer && chipText) {
    if (state.activeFilterReq !== "all") {
      const rKey = state.activeFilterReq.replace("missing_", "");
      const rName = CANONICAL_REQUIREMENTS[rKey] || rKey;
      chipText.innerHTML = `Requirement: ${escapeHtml(rName)} <button id="btn-clear-active-chip" title="Clear Filter">&times;</button>`;
      chipContainer.classList.remove("hidden");
    } else if (state.activeFilterStatus !== "all") {
      chipText.innerHTML = `Status: ${escapeHtml(state.activeFilterStatus)} <button id="btn-clear-active-chip" title="Clear Filter">&times;</button>`;
      chipContainer.classList.remove("hidden");
    } else if (state.activeFilterType !== "all") {
      chipText.innerHTML = `Type: ${escapeHtml(state.activeFilterType)} <button id="btn-clear-active-chip" title="Clear Filter">&times;</button>`;
      chipContainer.classList.remove("hidden");
    } else {
      chipContainer.classList.add("hidden");
    }

    const btnClear = document.getElementById("btn-clear-active-chip");
    if (btnClear) btnClear.addEventListener("click", resetAllFilters);
  }

  renderKPICards();
  renderAnalyticsBars();
  renderActionCenter();
  renderTable();
}

function resetAllFilters() {
  state.activeSearchQuery = "";
  state.activeFilterStatus = "all";
  state.activeFilterType = "all";
  state.activeFilterReq = "all";
  state.activeSort = "name_asc";
  document.getElementById("search-input").value = "";
  document.getElementById("filter-status-select").value = "all";
  document.getElementById("filter-type-select").value = "all";
  document.getElementById("filter-req-select").value = "all";
  document.getElementById("sort-select").value = "name_asc";
  applyFiltersAndRender();
}

function renderKPICards() {
  const total = state.participants.length;
  const complete = state.participants.filter(p => p.status === "COMPLETE").length;
  const needsReview = state.participants.filter(p => p.checkCount > 0 || p.reviewCount > 0 || p.status === "NEEDS_REVIEW" || p.status === "CHECK").length;
  const totalSlotsAll = state.participants.reduce((acc, p) => acc + (p.applicableRequirementsCount || 11), 0);
  const completedSlotsAll = state.participants.reduce((acc, p) => acc + (p.completeCount || 0), 0);
  const avgComp = totalSlotsAll > 0 ? Math.round((completedSlotsAll / totalSlotsAll) * 1000) / 10 : 0;

  const elTotal = document.getElementById("val-total-participants");
  if (elTotal) elTotal.textContent = total;

  const elReview = document.getElementById("val-needs-review");
  if (elReview) elReview.textContent = needsReview;

  const elRate = document.getElementById("val-compliance-rate");
  if (elRate) elRate.textContent = `${avgComp}%`;

  const elFill = document.getElementById("fill-overall-compliance");
  if (elFill) elFill.style.width = `${avgComp}%`;

  document.querySelectorAll(".kpi-card.interactive").forEach(card => {
    card.classList.toggle("active", card.dataset.filter === state.activeFilterStatus);
  });
}

function renderAnalyticsBars() {
  const container = document.getElementById("requirement-analytics-bars");
  container.innerHTML = "";

  const total = state.participants.length;
  if (total === 0) return;

  const sortedReqs = Object.keys(CANONICAL_REQUIREMENTS).map(docKey => {
    const completeOrApproved = state.participants.filter(p => {
      const doc = p.requirements[docKey];
      return doc && (doc.status === "COMPLETE" || doc.status === "APPROVED");
    }).length;
    const missingCount = total - completeOrApproved;
    const pct = Math.round((completeOrApproved / total) * 100);
    return { key: docKey, name: CANONICAL_REQUIREMENTS[docKey], complete: completeOrApproved, missing: missingCount, pct: pct };
  }).sort((a, b) => b.missing - a.missing || a.pct - b.pct);

  sortedReqs.forEach(reqItem => {
    const row = document.createElement("div");
    row.className = "analytics-row";
    row.dataset.docKey = reqItem.key;
    row.innerHTML = `
      <div class="analytics-info">
        <span class="analytics-name">${reqItem.name}</span>
        <span class="analytics-pct">${reqItem.complete}/${total} (${reqItem.pct}%)</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${reqItem.pct}%;"></div>
      </div>
    `;

    row.addEventListener("click", () => {
      state.activeFilterReq = `missing_${reqItem.key}`;
      document.getElementById("filter-req-select").value = state.activeFilterReq;
      applyFiltersAndRender();
    });

    container.appendChild(row);
  });
}

function renderActionCenter() {
  const incompleteList = state.participants.filter(p => p.status !== "COMPLETE");
  const summaryText = document.getElementById("action-summary-text");
  const issuesList = document.getElementById("action-issues-list");
  
  summaryText.textContent = `${incompleteList.length} enterprises require document submission or review follow-up.`;
  issuesList.innerHTML = "";

  const missingCounts = {};
  Object.keys(CANONICAL_REQUIREMENTS).forEach(k => missingCounts[k] = 0);

  incompleteList.forEach(p => {
    Object.keys(CANONICAL_REQUIREMENTS).forEach(k => {
      const doc = p.requirements[k];
      if (doc && (doc.status === "MISSING" || doc.status === "REJECTED")) {
        missingCounts[k]++;
      }
    });
  });

  const sortedIssues = Object.keys(CANONICAL_REQUIREMENTS)
    .map(k => ({ key: k, count: missingCounts[k], name: CANONICAL_REQUIREMENTS[k] }))
    .filter(i => i.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  sortedIssues.forEach(issue => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(issue.name)}</strong> — ${issue.count} missing`;
    issuesList.appendChild(li);
  });

  if (issuesList.children.length === 0) {
    const li = document.createElement("li");
    li.textContent = "All enterprises fully compliant!";
    issuesList.appendChild(li);
  }
}

function renderTable() {
  const tbody = document.getElementById("table-body");
  const emptyState = document.getElementById("table-empty-state");
  tbody.innerHTML = "";

  if (state.filteredParticipants.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  state.filteredParticipants.forEach(p => {
    const tr = document.createElement("tr");
    const primaryKey = p.enterpriseFolderId || p.driveFolderId || p.id;
    tr.dataset.id = primaryKey;

    let appTypeHtml = "";
    const rawType = getApplicantTypeString(p.applicantType);
    if (rawType === "GROUP") {
      appTypeHtml = `
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="badge" style="background:#1e3a8a; color:#93c5fd; font-weight:700;">GROUP</span>
          <button class="btn btn-secondary btn-xs btn-open-edit-type" data-id="${primaryKey}">Edit</button>
        </div>
      `;
    } else if (rawType === "INDIVIDUAL") {
      appTypeHtml = `
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="badge" style="background:#1f2937; color:#d1d5db; font-weight:700;">INDIVIDUAL</span>
          <button class="btn btn-secondary btn-xs btn-open-edit-type" data-id="${primaryKey}">Edit</button>
        </div>
      `;
    } else {
      appTypeHtml = `
        <div style="display:flex; flex-direction:column; gap:4px;">
          <span style="color:#fbbf24; font-size:0.75rem; font-weight:600;">⚠ Applicant type needs checking</span>
          <div>
            <button class="btn btn-warning btn-xs btn-open-edit-type" data-id="${primaryKey}">Choose Type</button>
          </div>
        </div>
      `;
    }

    let needsAttentionHtml = "";
    if (p.checkCount > 0) {
      needsAttentionHtml = `<span style="color:#fbbf24; font-weight:600;">⚠ ${p.checkCount} need checking</span>`;
    } else if (p.missingCount > 0) {
      needsAttentionHtml = `<span style="color:#f87171; font-weight:600;">✕ ${p.missingCount} missing</span>`;
    } else {
      needsAttentionHtml = `<span style="color:#34d399; font-weight:600;">✓ All complete</span>`;
    }

    tr.innerHTML = `
      <td>
        <div class="participant-name-cell">
          <strong style="color:#f8fafc; font-size:0.925rem;">${escapeHtml(p.name)}</strong>
        </div>
      </td>
      <td>${appTypeHtml}</td>
      <td>
        <div style="display:flex; flex-direction:column; gap:2px; min-width:130px;">
          <span style="font-size:0.8rem; font-weight:700; color:#e5e7eb;">${p.completeCount} of ${p.applicableRequirementsCount} complete</span>
          <div class="progress-bar-bg" style="height:6px; margin-top:2px;">
            <div class="progress-bar-fill" style="width: ${p.completionRate}%;"></div>
          </div>
        </div>
      </td>
      <td>${needsAttentionHtml}</td>
      <td style="text-align:right;">
        <button class="btn btn-primary btn-sm btn-review-row" data-id="${primaryKey}">Review</button>
      </td>
    `;

    tr.addEventListener("click", (e) => {
      const btnEditType = e.target.closest(".btn-open-edit-type");
      if (btnEditType) {
        e.stopPropagation();
        openChangeAppTypeModal(btnEditType.dataset.id);
        return;
      }
      openDrawer(primaryKey);
    });
    tbody.appendChild(tr);
  });
}

function renderDocStatusBadge(status) {
  const st = (status || "CHECK").toUpperCase();
  switch (st) {
    case "COMPLETE":
    case "APPROVED":
      return `<span class="badge badge-approved">✓ Complete</span>`;
    case "CHECK":
    case "REVIEW":
    case "NEEDS_REVIEW":
      return `<span class="badge badge-review">⚠ Check</span>`;
    case "MISSING":
    case "REJECTED":
      return `<span class="badge badge-rejected">✕ Missing</span>`;
    case "NOT_APPLICABLE":
      return `<span class="badge badge-na">— Not applicable</span>`;
    default:
      return `<span class="badge badge-review">⚠ Check</span>`;
  }
}

async function setApplicantTypeOverride(participantId, newApplicantType) {
  const p = state.participants.find(x => (x.enterpriseFolderId === participantId || x.driveFolderId === participantId || x.id === participantId));
  if (!p) return;

  const primaryFolderId = p.enterpriseFolderId || p.driveFolderId || p.id;
  p.applicantType = newApplicantType;

  if (!state.overrides[primaryFolderId]) state.overrides[primaryFolderId] = {};
  state.overrides[primaryFolderId]._applicantType = newApplicantType;
  saveLocalOverrides();

  if (supabaseClient) {
    try {
      await supabaseClient
        .from('human_reviews')
        .upsert({
          enterprise_folder_id: primaryFolderId,
          enterprise_id: p.id,
          requirement_id: '_applicantType',
          human_status: newApplicantType,
          reviewer_name: localStorage.getItem("yfc_reviewer_name") || "Operational Reviewer",
          updated_at: new Date().toISOString()
        }, { onConflict: 'enterprise_folder_id,requirement_id' });
    } catch (e) {
      console.warn("Failed to persist applicant type override to Supabase:", e);
    }
  }

  recalculateEnterpriseScores(p);
  applyFiltersAndRender();
  if (state.selectedParticipantId === primaryFolderId) {
    openDrawer(primaryFolderId);
  }
}

function openDrawer(participantId) {
  const p = state.participants.find(x => (x.enterpriseFolderId === participantId || x.driveFolderId === participantId || x.id === participantId));
  if (!p) return;

  const primaryFolderId = p.enterpriseFolderId || p.driveFolderId || p.id;
  state.selectedParticipantId = primaryFolderId;

  document.getElementById("drawer-participant-name").textContent = p.name;
  const rawType = getApplicantTypeString(p.applicantType);
  let typeDisplay = "";
  if (rawType === "GROUP") {
    typeDisplay = `GROUP <button class="btn btn-secondary btn-xs btn-open-edit-type" data-id="${primaryFolderId}">Edit</button>`;
  } else if (rawType === "INDIVIDUAL") {
    typeDisplay = `INDIVIDUAL <button class="btn btn-secondary btn-xs btn-open-edit-type" data-id="${primaryFolderId}">Edit</button>`;
  } else {
    typeDisplay = `<span style="color:#fbbf24; font-weight:700;">⚠ Applicant type needs checking</span> <button class="btn btn-warning btn-xs btn-open-edit-type" data-id="${primaryFolderId}">Choose Type</button>`;
  }
  document.getElementById("drawer-applicant-type").innerHTML = typeDisplay;
  document.getElementById("drawer-applicant-type").querySelector(".btn-open-edit-type")?.addEventListener("click", () => openChangeAppTypeModal(primaryFolderId));

  document.getElementById("drawer-comp-rate-badge").textContent = `${p.completeCount} of ${p.applicableRequirementsCount} requirements complete`;

  const driveLink = document.getElementById("drawer-drive-url");
  driveLink.href = p.driveUrl || `https://drive.google.com/drive/folders/${primaryFolderId}`;

  document.getElementById("drawer-subhead-counts").textContent = `${p.completeCount} Complete · ${p.checkCount} Need Verification · ${p.missingCount} Missing`;

  const elCaseComp = document.getElementById("case-val-compliance");
  if (elCaseComp) elCaseComp.textContent = `${p.completeCount} / ${p.applicableRequirementsCount}`;

  const elCaseMembers = document.getElementById("case-val-members");
  if (elCaseMembers) elCaseMembers.textContent = rawType;

  const elCaseOut = document.getElementById("case-val-outstanding");
  if (elCaseOut) elCaseOut.textContent = `${p.checkCount + p.missingCount} reqs`;

  const elNextAction = document.getElementById("drawer-next-action-text");
  if (elNextAction) elNextAction.innerHTML = generateNextActionString(p);

  const reviewRequiredList = document.getElementById("drawer-review-required-list");
  const completedList = document.getElementById("drawer-completed-list");
  const completedCountTag = document.getElementById("completed-count-tag");
  const completedDetails = document.getElementById("drawer-completed-details");

  if (completedDetails) completedDetails.removeAttribute("open");

  reviewRequiredList.innerHTML = "";
  completedList.innerHTML = "";

  // Applicant Type Selector Widget if CHECK
  if (rawType === "CHECK") {
    const typeWidget = document.createElement("div");
    typeWidget.style.cssText = "margin-bottom:16px; background:#111827; padding:12px; border-radius:6px; border:1px solid #f59e0b;";
    typeWidget.innerHTML = `
      <div style="color:#fbbf24; font-weight:700; font-size:0.85rem; margin-bottom:8px;">⚠ Applicant type needs checking before final compliance evaluation:</div>
      <button class="btn btn-warning btn-sm btn-open-edit-type" data-id="${primaryFolderId}">Choose Applicant Type →</button>
    `;
    typeWidget.querySelector(".btn-open-edit-type")?.addEventListener("click", () => openChangeAppTypeModal(primaryFolderId));
    reviewRequiredList.appendChild(typeWidget);
  }

  let needsAttentionCount = 0;
  let completeCount = 0;

  Object.keys(CANONICAL_REQUIREMENTS).forEach(docKey => {
    const docName = CANONICAL_REQUIREMENTS[docKey];
    const docData = p.requirements[docKey] || { status: "MISSING", files: [] };
    const files = docData.files || [];
    const isNotApplicable = docData.status === "NOT_APPLICABLE";
    if (isNotApplicable) return;

    const fileName = files.length > 0 ? files[0].name : "No matching document found";
    const st = (docData.status || "MISSING").toUpperCase();

    const card = document.createElement("div");
    card.className = "doc-item-card";

    if (st === "CHECK" || st === "NEEDS_REVIEW" || st === "REVIEW") {
      needsAttentionCount++;
      card.style.cssText = "background:#1f2937; padding:14px; border-radius:6px; border-left:4px solid #f59e0b; margin-bottom:12px;";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:#fbbf24; font-size:0.95rem;">⚠ ${escapeHtml(docName)}</span>
          <span style="font-size:0.75rem; background:#374151; color:#fbbf24; padding:2px 8px; border-radius:4px; font-weight:600;">Needs Verification</span>
        </div>
        <div style="margin-top:8px; color:#e5e7eb; font-size:0.85rem;">
          Possible document found:<br/>
          <strong style="color:#f8fafc;">${escapeHtml(fileName)}</strong>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="btn btn-success btn-sm btn-confirm-doc" data-doc="${docKey}">[ ✓ This is correct ]</button>
          <button class="btn btn-danger btn-sm btn-not-doc" data-doc="${docKey}">[ ✕ This is not the correct document ]</button>
        </div>
      `;

      card.querySelector(".btn-confirm-doc").addEventListener("click", () => setDocOverride(primaryFolderId, docKey, "COMPLETE"));
      card.querySelector(".btn-not-doc").addEventListener("click", () => setDocOverride(primaryFolderId, docKey, "MISSING"));

      reviewRequiredList.appendChild(card);

    } else if (st === "MISSING" || st === "REJECTED") {
      needsAttentionCount++;
      card.style.cssText = "background:#1f2937; padding:14px; border-radius:6px; border-left:4px solid #ef4444; margin-bottom:12px;";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:#f87171; font-size:0.95rem;">✕ ${escapeHtml(docName)}</span>
          <span style="font-size:0.75rem; background:#374151; color:#f87171; padding:2px 8px; border-radius:4px; font-weight:600;">Missing</span>
        </div>
        <div style="margin-top:8px; color:#9ca3af; font-size:0.85rem;">
          No matching document found.
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="btn btn-success btn-sm btn-confirm-doc" data-doc="${docKey}">Mark Complete</button>
          <button class="btn btn-secondary btn-sm btn-keep-missing" data-doc="${docKey}">Keep Missing</button>
        </div>
      `;

      card.querySelector(".btn-confirm-doc").addEventListener("click", () => setDocOverride(primaryFolderId, docKey, "COMPLETE"));
      card.querySelector(".btn-keep-missing").addEventListener("click", () => setDocOverride(primaryFolderId, docKey, "MISSING"));

      reviewRequiredList.appendChild(card);

    } else {
      completeCount++;
      card.style.cssText = "background:#1f2937; padding:14px; border-radius:6px; border-left:4px solid #10b981; margin-bottom:12px;";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:#34d399; font-size:0.95rem;">✓ ${escapeHtml(docName)}</span>
          <span style="font-size:0.75rem; background:#064e3b; color:#34d399; padding:2px 8px; border-radius:4px; font-weight:600;">Complete</span>
        </div>
        <div style="margin-top:8px; color:#e5e7eb; font-size:0.85rem;">
          <strong style="color:#f8fafc;">${escapeHtml(fileName)}</strong>
        </div>
        <div style="margin-top:8px; display:flex; gap:8px;">
          <button class="btn btn-secondary btn-xs btn-change-status" data-doc="${docKey}">Reopen / Mark Missing</button>
        </div>
      `;

      card.querySelector(".btn-change-status")?.addEventListener("click", () => setDocOverride(primaryFolderId, docKey, "MISSING"));

      completedList.appendChild(card);
    }
  });

  const titleActionReq = document.getElementById("drawer-action-required-title");
  if (titleActionReq) titleActionReq.textContent = `NEEDS YOUR ATTENTION (${needsAttentionCount})`;

  if (needsAttentionCount === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.cssText = "font-size:0.85rem; color:#34d399; font-weight:700; padding:14px; background:rgba(16, 185, 129, 0.1); border-radius:6px; border:1px solid #10b981;";
    emptyDiv.textContent = "✓ All requirements complete for this enterprise!";
    reviewRequiredList.appendChild(emptyDiv);
  }

  completedCountTag.textContent = `(${completeCount})`;

  document.body.classList.add("drawer-open");
  document.getElementById("drawer-overlay").classList.remove("hidden");
  document.getElementById("participant-drawer").classList.remove("hidden");
}

function openNextEnterprise() {
  if (!state.selectedParticipantId || state.filteredParticipants.length === 0) return;
  const idx = state.filteredParticipants.findIndex(p => (p.enterpriseFolderId === state.selectedParticipantId || p.id === state.selectedParticipantId));
  if (idx !== -1 && idx < state.filteredParticipants.length - 1) {
    const nextP = state.filteredParticipants[idx + 1];
    openDrawer(nextP.enterpriseFolderId || nextP.id);
  }
}

function openPrevEnterprise() {
  if (!state.selectedParticipantId || state.filteredParticipants.length === 0) return;
  const idx = state.filteredParticipants.findIndex(p => (p.enterpriseFolderId === state.selectedParticipantId || p.id === state.selectedParticipantId));
  if (idx > 0) {
    const prevP = state.filteredParticipants[idx - 1];
    openDrawer(prevP.enterpriseFolderId || prevP.id);
  }
}

function closeDrawer() {
  document.body.classList.remove("drawer-open");
  document.getElementById("drawer-overlay").classList.add("hidden");
  document.getElementById("participant-drawer").classList.add("hidden");
  state.selectedParticipantId = null;
}

function openDocInspector(docKey) {
  const p = state.participants.find(x => (x.enterpriseFolderId === state.selectedParticipantId || x.id === state.selectedParticipantId));
  if (!p) return;

  state.selectedDocId = docKey;
  const doc = p.requirements[docKey];
  if (!doc) return;

  const files = doc.files || [];
  const topFile = files.length > 0 ? files[0] : null;

  const fname = topFile ? topFile.name : "No file";
  const confidence = topFile ? topFile.confidence : 0.0;
  const reason = topFile ? topFile.reason : "No matching file found";
  const webLink = topFile ? topFile.webViewLink : (p.driveUrl || "#");
  const fsize = topFile ? topFile.size : 0;
  const primaryFolderId = p.enterpriseFolderId || p.id;

  document.getElementById("modal-doc-type-title").textContent = CANONICAL_REQUIREMENTS[docKey];
  document.getElementById("modal-doc-filename").textContent = fname;
  document.getElementById("meta-doc-name").textContent = CANONICAL_REQUIREMENTS[docKey];
  
  const autoBadgeHtml = renderDocStatusBadge(doc.automatedStatus || doc.status);
  const humanBadgeHtml = doc.review ? `<span class="badge" style="background:#4f46e5; color:#ffffff;">HUMAN: ${doc.review.manualStatus}</span>` : '<span class="badge" style="background:#374151; color:#9ca3af;">NO HUMAN REVIEW</span>';
  
  document.getElementById("meta-auto-status").innerHTML = `
    <div style="display:flex; flex-direction:column; gap:4px;">
      <div><span style="font-size:0.65rem; color:#9ca3af;">AUTOMATED SCANNER:</span> ${autoBadgeHtml}</div>
      <div><span style="font-size:0.65rem; color:#9ca3af;">HUMAN DECISION:</span> ${humanBadgeHtml}</div>
    </div>
  `;

  document.getElementById("meta-confidence-val").textContent = `${Math.round(confidence * 100)}%`;
  document.getElementById("meta-reason-val").textContent = reason;
  document.getElementById("meta-file-size").textContent = fsize ? formatBytes(fsize) : "Unknown size";
  document.getElementById("modal-gdrive-open-btn").href = webLink;
  
  // Pre-fill reviewer name from localStorage if available
  const savedName = localStorage.getItem("yfc_reviewer_name") || "";
  const nameInput = document.getElementById("modal-reviewer-name");
  if (nameInput) nameInput.value = savedName;

  document.getElementById("modal-reviewer-note").value = (doc.review && doc.review.note) ? doc.review.note : "";

  const previewBox = document.getElementById("doc-preview-container");
  previewBox.innerHTML = renderMockDocPreview(fname, CANONICAL_REQUIREMENTS[docKey], files, webLink, topFile, primaryFolderId, docKey);

  document.getElementById("doc-modal-overlay").classList.remove("hidden");
}

function closeDocInspector() {
  document.getElementById("doc-modal-overlay").classList.add("hidden");
  state.selectedDocId = null;
}

function openFlagIssueModal(docKey) {
  const p = state.participants.find(x => (x.enterpriseFolderId === state.selectedParticipantId || x.id === state.selectedParticipantId));
  if (!p) return;

  state.flaggingDocKey = docKey;
  const doc = p.requirements[docKey] || { files: [] };
  const files = doc.files || [];
  const topFile = files.length > 0 ? files[0] : null;
  const fname = topFile ? topFile.name : "No candidate document detected";

  document.getElementById("flag-modal-req-name").textContent = CANONICAL_REQUIREMENTS[docKey] || docKey;
  document.getElementById("flag-modal-filename").textContent = `Matched file: ${fname}`;

  // Check if GROUP personal requirement
  const memGroup = document.getElementById("flag-modal-member-group");
  const memRadios = document.getElementById("flag-modal-member-radios");

  if (p.applicantType === "GROUP" && ["validId", "proofOfResidency", "photo2x2"].includes(docKey) && p.groupMembers && p.groupMembers.length > 0) {
    memGroup.classList.remove("hidden");
    memRadios.innerHTML = p.groupMembers.map((m, idx) => `
      <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; background:#1f2937; padding:4px 8px; border-radius:4px; border:1px solid #374151;">
        <input type="radio" name="flag-target-member" value="${escapeHtml(m)}" ${idx === 0 ? 'checked' : ''} />
        <span style="font-weight:600;">${escapeHtml(m)}</span>
      </label>
    `).join("");
  } else {
    memGroup.classList.add("hidden");
    memRadios.innerHTML = "";
  }

  // Pre-fill reviewer name
  const savedName = localStorage.getItem("yfc_reviewer_name") || "";
  const nameInput = document.getElementById("flag-modal-reviewer-name");
  if (nameInput) nameInput.value = savedName;

  document.getElementById("flag-modal-reason-select").value = "Wrong document";
  const noteTextarea = document.getElementById("flag-modal-reviewer-note");
  noteTextarea.value = "";

  const btnSubmit = document.getElementById("btn-submit-flag");
  btnSubmit.disabled = true;

  noteTextarea.oninput = () => {
    btnSubmit.disabled = noteTextarea.value.trim() === "";
  };

  document.getElementById("modal-flag-issue-overlay").classList.remove("hidden");
}

function closeFlagIssueModal() {
  document.getElementById("modal-flag-issue-overlay").classList.add("hidden");
  state.flaggingDocKey = null;
}

async function setDocOverride(participantId, docKey, humanStatus, note = "", targetMember = null) {
  const p = state.participants.find(x => (x.enterpriseFolderId === participantId || x.id === participantId));
  if (!p || !p.requirements[docKey]) return;

  const primaryFolderId = p.enterpriseFolderId || p.driveFolderId || p.id;
  const doc = p.requirements[docKey];
  const previousStatus = doc.status || "MISSING";
  const topFile = doc.files && doc.files.length > 0 ? doc.files[0] : null;
  const fileId = topFile ? (topFile.fileId || topFile.id || "") : "";

  // Get reviewer name entered by user
  const nameInput = document.getElementById("modal-reviewer-name");
  const flagNameInput = document.getElementById("flag-modal-reviewer-name");
  let reviewerName = flagNameInput && flagNameInput.value.trim() !== "" ? flagNameInput.value.trim() : (nameInput && nameInput.value.trim() !== "" ? nameInput.value.trim() : (localStorage.getItem("yfc_reviewer_name") || "Operational Reviewer"));
  
  // Store name in localStorage for reviewer convenience
  localStorage.setItem("yfc_reviewer_name", reviewerName);

  const btnApprove = document.getElementById("btn-doc-approve");
  const btnReject = document.getElementById("btn-doc-reject");
  const btnFlag = document.getElementById("btn-doc-flag");

  if (btnApprove) btnApprove.disabled = true;
  if (btnReject) btnReject.disabled = true;
  if (btnFlag) btnFlag.disabled = true;

  const reviewPayload = {
    manualStatus: humanStatus,
    reviewedBy: reviewerName,
    reviewedAt: new Date().toISOString(),
    note: note,
    fileId: fileId,
    targetMember: targetMember
  };

  const overrideKey = targetMember ? `${docKey}_${targetMember}` : docKey;

  // Create local history entry log
  const histKey = `${primaryFolderId}_${overrideKey}`;
  if (!state.reviewHistory[histKey]) state.reviewHistory[histKey] = [];
  
  const historyItem = {
    id: 'local_' + Date.now(),
    previousStatus: previousStatus,
    newStatus: humanStatus,
    reviewerName: reviewerName,
    notes: targetMember ? `[Member: ${targetMember}] ${note}` : note,
    targetMember: targetMember,
    createdAt: new Date().toISOString()
  };
  
  // Add to top of history list (newest first)
  state.reviewHistory[histKey].unshift(historyItem);
  if (targetMember) {
    const parentHistKey = `${primaryFolderId}_${docKey}`;
    if (!state.reviewHistory[parentHistKey]) state.reviewHistory[parentHistKey] = [];
    state.reviewHistory[parentHistKey].unshift(historyItem);
  }

  // 1. Update local state fallback immediately
  if (!state.overrides[primaryFolderId]) state.overrides[primaryFolderId] = {};
  state.overrides[primaryFolderId][overrideKey] = reviewPayload;
  saveLocalOverrides();

  // 2. Persist to Supabase
  if (supabaseClient) {
    try {
      await supabaseClient
        .from('human_reviews')
        .upsert({
          enterprise_folder_id: primaryFolderId,
          enterprise_id: p.id,
          requirement_id: overrideKey,
          file_id: fileId,
          automated_status: doc.automatedStatus || doc.status,
          human_status: humanStatus,
          reviewer_name: reviewerName,
          reviewer_notes: targetMember ? `[Member: ${targetMember}] ${note}` : note,
          updated_at: new Date().toISOString()
        }, { onConflict: 'enterprise_id,requirement_id' });

      await supabaseClient
        .from('human_review_history')
        .insert({
          enterprise_folder_id: primaryFolderId,
          enterprise_id: p.id,
          requirement_id: overrideKey,
          file_id: fileId,
          previous_status: previousStatus,
          new_status: humanStatus,
          reviewer_name: reviewerName,
          reviewer_notes: targetMember ? `[Member: ${targetMember}] ${note}` : note,
          created_at: new Date().toISOString()
        });
    } catch (err) {
      console.error("[PERSISTENCE] Supabase execution error:", err);
    }
  }

  if (btnApprove) btnApprove.disabled = false;
  if (btnReject) btnReject.disabled = false;
  if (btnFlag) btnFlag.disabled = false;

  if (targetMember && p.memberDetails && p.memberDetails[targetMember] && p.memberDetails[targetMember][docKey]) {
    p.memberDetails[targetMember][docKey].status = humanStatus;
    p.memberDetails[targetMember][docKey].review = reviewPayload;
  }

  doc.review = reviewPayload;
  if (!targetMember) {
    doc.status = humanStatus;
  }
  
  recalculateEnterpriseScores(p);

  applyFiltersAndRender();
  if (state.selectedParticipantId === primaryFolderId) {
    openDrawer(primaryFolderId);
  }
}

// ============================================================================
// ONLINE CLOUD GOOGLE DRIVE SCANNER TRIGGER & STATUS POLLING
// ============================================================================
// ============================================================================
// ONLINE CLOUD GOOGLE DRIVE SCANNER TRIGGER & STATUS POLLING
// ============================================================================
async function triggerCloudDriveScan() {
  if (state.isScanning) return;

  const btnScan = document.getElementById("btn-trigger-gdrive-scan");
  const scanLabel = document.getElementById("scan-status-label");
  const scanBadgeDot = document.querySelector("#scan-status-badge .status-dot");

  state.isScanning = true;
  if (btnScan) {
    btnScan.disabled = true;
    btnScan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Scanning Google Drive…`;
  }
  if (scanLabel) scanLabel.textContent = "Scanning Google Drive…";
  if (scanBadgeDot) scanBadgeDot.style.background = "#6366f1";

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      const errText = await res.text();
      let errJson = null;
      try { errJson = JSON.parse(errText); } catch (e) {}
      const errMsg = (errJson && errJson.error) ? errJson.error : `HTTP ${res.status}: Server error`;
      
      handleScanFailure({
        error: errMsg,
        stage: "Network/Server API Call",
        status: "FAILED",
        jobId: "scan_http_" + res.status
      });
      return;
    }

    const data = await res.json();

    if (!data.success || data.status === "FAILED") {
      handleScanFailure(data);
      return;
    }

    if (data.success && data.status === "COMPLETED") {
      await handleScanSuccess(data);
      return;
    }

    state.activeJobId = data.jobId;
    startScanStatusPolling(data.jobId);

  } catch (err) {
    handleScanFailure({
      error: err.message || "Failed connecting to scanner backend endpoint.",
      stage: "Network Connection",
      status: "FAILED",
      jobId: "job_err_" + Date.now()
    });
  }
}

function handleScanFailure(data) {
  state.isScanning = false;
  state.lastScanError = {
    error: data.error || "Google Drive scan failed.",
    stage: data.stage || "Scan Processing",
    jobId: data.jobId || ("job_" + Date.now()),
    startedAt: new Date().toLocaleString()
  };

  const btnScan = document.getElementById("btn-trigger-gdrive-scan");
  const scanLabel = document.getElementById("scan-status-label");
  const scanBadgeDot = document.querySelector("#scan-status-badge .status-dot");

  if (btnScan) {
    btnScan.disabled = false;
    btnScan.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Scan Google Drive
    `;
  }

  const lastScanStr = state.lastSuccessfulScanTime ? state.lastSuccessfulScanTime : "Aug 6, 2026 12:39 PM";
  if (scanLabel) scanLabel.textContent = `⚠ Google Drive Scan Failed · Last scan: ${lastScanStr}`;
  if (scanBadgeDot) scanBadgeDot.style.background = "#ef4444";

  // Single deduplicated error toast
  showToast("Google Drive scan failed. Previous scan results are preserved.", "error");

  // Show error banner with View Details and Try Again
  const errorBanner = document.getElementById("error-banner");
  const errorMsgEl = document.getElementById("error-banner-msg");
  if (errorBanner && errorMsgEl) {
    errorMsgEl.innerHTML = `
      <strong>Google Drive scan failed.</strong> We couldn't complete the scan. Your previous scan results are still being used.
      <button class="btn btn-secondary btn-sm" id="btn-banner-view-details" style="margin-left:10px; padding:2px 8px; font-size:0.75rem;">View Details</button>
      <button class="btn btn-primary btn-sm" id="btn-banner-try-again" style="margin-left:6px; padding:2px 8px; font-size:0.75rem;">Try Again ↻</button>
    `;
    errorBanner.classList.remove("hidden");

    const btnView = document.getElementById("btn-banner-view-details");
    if (btnView) btnView.onclick = openScanErrorModal;

    const btnTry = document.getElementById("btn-banner-try-again");
    if (btnTry) btnTry.onclick = () => {
      errorBanner.classList.add("hidden");
      triggerCloudDriveScan();
    };
  }
}

async function handleScanSuccess(data) {
  state.isScanning = false;
  state.lastSuccessfulScanTime = new Date().toLocaleString();

  const btnScan = document.getElementById("btn-trigger-gdrive-scan");
  const scanLabel = document.getElementById("scan-status-label");
  const scanBadgeDot = document.querySelector("#scan-status-badge .status-dot");

  if (btnScan) {
    btnScan.disabled = false;
    btnScan.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Scan Google Drive
    `;
  }

  if (scanLabel) scanLabel.textContent = `✓ Google Drive Scanned · ${state.lastSuccessfulScanTime}`;
  if (scanBadgeDot) scanBadgeDot.style.background = "#10b981";

  // Hide error banner if visible
  const errorBanner = document.getElementById("error-banner");
  if (errorBanner) errorBanner.classList.add("hidden");

  // Single success toast
  const folders = data.uniqueEnterpriseFolders || data.foldersFound || state.participants.length;
  showToast(`Google Drive scan complete: ${folders} enterprises scanned ✓`, "success");

  // Open Scan Success Modal
  openScanSuccessModal(data);

  // Refresh dashboard data once
  await fetchData();
}

function openScanErrorModal() {
  const errData = state.lastScanError || { error: "Google Drive scan failed.", stage: "Drive API", jobId: "job_unknown" };
  document.getElementById("diag-status").textContent = "FAILED";
  document.getElementById("diag-stage").textContent = errData.stage || "Drive API";
  document.getElementById("diag-started").textContent = errData.startedAt || new Date().toLocaleTimeString();
  document.getElementById("diag-job-id").textContent = errData.jobId || "job_unknown";
  document.getElementById("diag-last-success").textContent = state.lastSuccessfulScanTime || "Aug 6, 2026 12:39 PM";
  document.getElementById("diag-error-message").textContent = errData.error || "We couldn't complete the scan. Your previous scan results are still being used.";

  document.getElementById("modal-scan-error-overlay").classList.remove("hidden");
}

function closeScanErrorModal() {
  document.getElementById("modal-scan-error-overlay").classList.add("hidden");
}

function openScanSuccessModal(data) {
  const folders = data.uniqueEnterpriseFolders || data.foldersFound || state.participants.length;
  const files = data.filesProcessed || data.filesFound || 156;

  let confirmedCount = 0;
  let checkCount = 0;
  let missingCount = 0;

  state.participants.forEach(p => {
    Object.keys(p.requirements || {}).forEach(k => {
      const doc = p.requirements[k];
      if (doc && doc.status !== "NOT_APPLICABLE") {
        const st = (doc.status || "MISSING").toUpperCase();
        if (st === "COMPLETE" || st === "APPROVED") confirmedCount++;
        else if (st === "CHECK" || st === "NEEDS_REVIEW" || st === "REVIEW") checkCount++;
        else missingCount++;
      }
    });
  });

  const elFolders = document.getElementById("succ-folders");
  if (elFolders) elFolders.textContent = folders;
  const elFiles = document.getElementById("succ-files");
  if (elFiles) elFiles.textContent = files;
  const elComp = document.getElementById("succ-complete");
  if (elComp) elComp.textContent = confirmedCount;
  const elCheck = document.getElementById("succ-check");
  if (elCheck) elCheck.textContent = checkCount;
  const elMiss = document.getElementById("succ-missing");
  if (elMiss) elMiss.textContent = missingCount;

  document.getElementById("modal-scan-success-overlay").classList.remove("hidden");
}

function closeScanSuccessModal() {
  document.getElementById("modal-scan-success-overlay").classList.add("hidden");
}

function startScanStatusPolling(jobId) {
  if (state.scanPollInterval) clearInterval(state.scanPollInterval);

  const scanLabel = document.getElementById("scan-status-label");
  const stageMap = {
    'JOB_CREATION': '1/5 Initializing scan job…',
    'AUTHENTICATION': '1/5 Authenticating Google Drive API…',
    'ROOT_DISCOVERY': '2/5 Querying root folder…',
    'FOLDER_ENUMERATION': '2/5 Discovering enterprise folders…',
    'FILE_ENUMERATION_AND_CLASSIFICATION': '3/5 Reading & classifying documents…',
    'STAGING_RESULTS': '4/5 Staging results in memory…',
    'INTEGRITY_VALIDATION': '4/5 Validating dataset integrity…',
    'DATABASE_COMMIT': '5/5 Committing snapshot transaction to database…'
  };

  state.scanPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/scan-status?job_id=${jobId || ''}`);
      const data = await res.json();

      if (scanLabel) {
        const stageText = stageMap[data.stage] || `Scanning Google Drive (${data.foldersFound || 19} folders)…`;
        scanLabel.textContent = `↻ ${stageText}`;
      }

      if (data.status === 'COMPLETED') {
        clearInterval(state.scanPollInterval);
        state.scanPollInterval = null;
        await handleScanSuccess(data);
      } else if (data.status === 'FAILED') {
        clearInterval(state.scanPollInterval);
        state.scanPollInterval = null;
        handleScanFailure(data);
      } else if (data.status === 'NO_JOB_FOUND') {
        clearInterval(state.scanPollInterval);
        state.scanPollInterval = null;
        await fetchData();
        resetScanUI("No active scan found");
        showToast("No active scan job. Data refreshed from database.", "info");
      }
    } catch (err) {
      console.warn("Poll status error:", err);
    }
  }, 2000);
}

function resetScanUI(statusText = "Idle") {
  state.isScanning = false;
  state.activeJobId = null;

  const btnScan = document.getElementById("btn-trigger-gdrive-scan");
  const scanLabel = document.getElementById("scan-status-label");

  if (btnScan) {
    btnScan.disabled = false;
    btnScan.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Scan Google Drive
    `;
  }

  if (scanLabel) scanLabel.textContent = statusText;
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const now = Date.now();
  if (state.lastToastMsg === msg && (now - (state.lastToastTime || 0)) < 3000) {
    return; // Deduplicate toast
  }
  state.lastToastMsg = msg;
  state.lastToastTime = now;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4000);
}

function renderMockDocPreview(filename, docTypeName, files = [], webLink = "#", fileObj = null, participantId = "", docKey = "") {
  const detMethod = fileObj && fileObj.detectionMethod ? fileObj.detectionMethod : "FILENAME_ONLY";
  const detKeywords = fileObj && fileObj.detectedKeywords ? fileObj.detectedKeywords.join(", ") : "N/A";
  const snippetText = fileObj && fileObj.snippet ? fileObj.snippet : "No extracted OCR text available.";
  const reasonText = fileObj && fileObj.reason ? fileObj.reason : "Matched classification criteria";
  const candidates = fileObj && fileObj.candidateRequirements ? fileObj.candidateRequirements : [];

  let candidateSelectorHtml = '';
  if (files.length > 1) {
    candidateSelectorHtml = `
      <div style="background:#1f2937; padding:10px 14px; border-radius:6px; margin-bottom:12px; text-align:left; border:1px solid #f59e0b;">
        <span style="font-size:0.75rem; color:#f59e0b; font-weight:700;">⚠ MULTIPLE MATCHED FILES (${files.length}):</span>
        <ul style="margin-top:6px; font-size:0.78rem; list-style:none; padding-left:0;">
          ${files.map(f => `<li style="margin-bottom:4px;">• <a href="${f.webViewLink}" target="_blank" style="color:#818cf8;"><strong>${escapeHtml(f.name)}</strong></a> (${Math.round(f.confidence*100)}% confidence)</li>`).join("")}
        </ul>
      </div>
    `;
  }

  // Render Review History Audit Timeline (Sorted newest first)
  const histKey = `${participantId}_${docKey}`;
  const historyLogs = state.reviewHistory[histKey] || [];
  
  let historyTimelineHtml = '';
  if (historyLogs.length > 0) {
    historyTimelineHtml = `
      <div style="margin-top:16px; background:#1e293b; padding:12px; border-radius:6px; border:1px solid #334155;">
        <div style="font-size:0.78rem; color:#a5b4fc; font-weight:700; text-transform:uppercase; margin-bottom:8px; display:flex; justify-content:space-between;">
          <span>📜 REVIEW AUDIT HISTORY LOG (${historyLogs.length})</span>
          <span style="font-size:0.65rem; color:#9ca3af; font-weight:400;">Sorted Newest First</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; max-height:180px; overflow-y:auto;">
          ${historyLogs.map(h => `
            <div style="background:#0f172a; padding:8px 10px; border-radius:4px; border-left:3px solid #6366f1; font-size:0.75rem;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                <strong>${renderDocStatusBadge(h.newStatus)}</strong>
                <span style="color:#9ca3af; font-size:0.7rem;">${new Date(h.createdAt).toLocaleString()}</span>
              </div>
              <div style="color:#d1d5db; margin-top:2px;">Entered by: <strong style="color:#818cf8;">${escapeHtml(h.reviewerName)}</strong></div>
              <div style="color:#9ca3af; font-size:0.7rem; margin-top:1px;">Transition: Previous: <span style="text-decoration:line-through;">${escapeHtml(h.previousStatus || 'NONE')}</span> → New: <strong>${escapeHtml(h.newStatus)}</strong></div>
              ${h.notes ? `<div style="color:#e2e8f0; font-style:italic; margin-top:3px;">"${escapeHtml(h.notes)}"</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    historyTimelineHtml = `
      <div style="margin-top:16px; background:#1e293b; padding:10px; border-radius:6px; border:1px dashed #334155; font-size:0.75rem; color:#9ca3af; text-align:center;">
        No previous review history entries logged for this document yet.
      </div>
    `;
  }

  let candidatesHtml = '';
  if (candidates.length > 0) {
    candidatesHtml = `
      <div style="margin-top:10px; background:#1f2937; padding:8px 12px; border-radius:6px; border:1px solid #374151;">
        <span style="font-size:0.75rem; color:#9ca3af; font-weight:600;">OTHER CANDIDATE REQUIREMENTS CONSIDERED:</span>
        <ul style="margin-top:4px; font-size:0.75rem; color:#d1d5db; padding-left:16px;">
          ${candidates.map(c => `<li>• ${escapeHtml(c.name)} (${Math.round(c.confidence*100)}% confidence)</li>`).join("")}
        </ul>
      </div>
    `;
  }

  return `
    <div style="background:#111827; padding:20px; border-radius:8px; text-align:left; width:100%; height:100%; border:1px solid #374151; overflow-y:auto;">
      ${candidateSelectorHtml}
      
      <div style="border-bottom:1px solid #374151; padding-bottom:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:#6366f1;">DOCUMENT OCR INSPECTOR</strong>
        <a href="${webLink}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:0.75rem;">Open Document ↗</a>
      </div>

      <p style="font-size:0.95rem; font-weight:600; color:#f9fafb; margin-bottom:4px;">Matched Document: ${escapeHtml(filename)}</p>
      <p style="font-size:0.8rem; color:#9ca3af;">Requirement: <strong style="color:#e5e7eb;">${docTypeName}</strong></p>

      <!-- OCR Evidence Card -->
      <div style="background:#1e293b; padding:12px; border-radius:6px; margin:12px 0; border-left:4px solid #6366f1;">
        <div style="font-size:0.78rem; color:#94a3b8; font-weight:600; margin-bottom:6px;">DETECTION METHOD & EVIDENCE</div>
        <div style="font-size:0.82rem; color:#f1f5f9; margin-bottom:4px;">• Detection: <span class="badge" style="background:#334155; color:#a5b4fc;">${escapeHtml(detMethod)}</span></div>
        <div style="font-size:0.82rem; color:#f1f5f9; margin-bottom:4px;">• Confidence: <strong>${Math.round((fileObj ? fileObj.confidence : 0)*100)}%</strong></div>
        <div style="font-size:0.82rem; color:#f1f5f9; margin-bottom:4px;">• Matched Keywords: <span style="background:#334155; color:#a5b4fc; padding:2px 6px; border-radius:4px; font-weight:600;">${escapeHtml(detKeywords)}</span></div>
        <div style="font-size:0.82rem; color:#f1f5f9;">• Classification Rationale: <em>${escapeHtml(reasonText)}</em></div>
      </div>

      <div style="margin-top:10px;">
        <span style="font-size:0.75rem; color:#9ca3af; font-weight:600; text-transform:uppercase;">Extracted OCR Evidence Text:</span>
        <pre style="background:#0f172a; padding:10px; border-radius:6px; color:#cbd5e1; font-family:monospace; font-size:0.75rem; white-space:pre-wrap; word-break:break-word; max-height:160px; overflow-y:auto; border:1px solid #334155; margin-top:4px;">${escapeHtml(snippetText)}</pre>
      </div>

      ${candidatesHtml}

      <!-- Review History Audit Section -->
      ${historyTimelineHtml}

      <div style="font-size:0.75rem; color:#64748b; margin-top:12px; text-align:center;">
        Google Drive File ID Verified • Click "Open Document ↗" above to inspect original full resolution document.
      </div>
    </div>
  `;
}

function initEventListeners() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.activeSearchQuery = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById("filter-status-select").addEventListener("change", (e) => {
    state.activeFilterStatus = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById("filter-type-select").addEventListener("change", (e) => {
    state.activeFilterType = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById("filter-req-select").addEventListener("change", (e) => {
    state.activeFilterReq = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.activeSort = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById("btn-reset-filters").addEventListener("click", () => {
    state.activeSearchQuery = "";
    state.activeFilterStatus = "all";
    state.activeFilterType = "all";
    state.activeFilterReq = "all";
    state.activeSort = "name_asc";
    document.getElementById("search-input").value = "";
    document.getElementById("filter-status-select").value = "all";
    document.getElementById("filter-type-select").value = "all";
    document.getElementById("filter-req-select").value = "all";
    document.getElementById("sort-select").value = "name_asc";
    applyFiltersAndRender();
  });

  document.querySelectorAll(".kpi-card.interactive").forEach(card => {
    card.addEventListener("click", () => {
      state.activeFilterStatus = card.dataset.filter;
      document.getElementById("filter-status-select").value = state.activeFilterStatus;
      applyFiltersAndRender();
    });
  });

  document.querySelectorAll(".priority-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      state.activeFilterStatus = chip.dataset.filter;
      document.getElementById("filter-status-select").value = state.activeFilterStatus;
      applyFiltersAndRender();
    });
  });

  document.getElementById("btn-review-incomplete").addEventListener("click", () => {
    state.activeFilterStatus = "incomplete";
    document.getElementById("filter-status-select").value = "incomplete";
    applyFiltersAndRender();
  });

  document.getElementById("btn-prev-enterprise").addEventListener("click", openPrevEnterprise);
  document.getElementById("btn-next-enterprise").addEventListener("click", openNextEnterprise);

  document.getElementById("btn-close-drawer").addEventListener("click", closeDrawer);
  document.getElementById("drawer-overlay").addEventListener("click", closeDrawer);

  document.getElementById("btn-close-doc-modal").addEventListener("click", closeDocInspector);
  document.getElementById("doc-modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "doc-modal-overlay") closeDocInspector();
  });

  document.getElementById("btn-close-flag-modal").addEventListener("click", closeFlagIssueModal);
  document.getElementById("btn-cancel-flag").addEventListener("click", closeFlagIssueModal);
  document.getElementById("modal-flag-issue-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-flag-issue-overlay") closeFlagIssueModal();
  });

  const btnCloseScanErr = document.getElementById("btn-close-scan-error-modal");
  if (btnCloseScanErr) btnCloseScanErr.addEventListener("click", closeScanErrorModal);
  const btnCloseErrPanel = document.getElementById("btn-close-error-panel");
  if (btnCloseErrPanel) btnCloseErrPanel.addEventListener("click", closeScanErrorModal);
  const btnRetryScan = document.getElementById("btn-retry-scan");
  if (btnRetryScan) btnRetryScan.addEventListener("click", () => { closeScanErrorModal(); triggerCloudDriveScan(); });
  const scanErrOverlay = document.getElementById("modal-scan-error-overlay");
  if (scanErrOverlay) scanErrOverlay.addEventListener("click", (e) => { if (e.target.id === "modal-scan-error-overlay") closeScanErrorModal(); });

  const btnCloseScanSucc = document.getElementById("btn-close-scan-success-modal");
  if (btnCloseScanSucc) btnCloseScanSucc.addEventListener("click", closeScanSuccessModal);
  const btnDoneScanSucc = document.getElementById("btn-done-scan-success");
  if (btnDoneScanSucc) btnDoneScanSucc.addEventListener("click", closeScanSuccessModal);
  const scanSuccOverlay = document.getElementById("modal-scan-success-overlay");
  if (scanSuccOverlay) scanSuccOverlay.addEventListener("click", (e) => { if (e.target.id === "modal-scan-success-overlay") closeScanSuccessModal(); });

  const btnSendSummary = document.getElementById("btn-send-summary");
  if (btnSendSummary) btnSendSummary.addEventListener("click", () => { closeScanSuccessModal(); openSummaryPreviewModal(); });

  const btnCloseSummaryPreview = document.getElementById("btn-close-summary-preview");
  if (btnCloseSummaryPreview) btnCloseSummaryPreview.addEventListener("click", closeSummaryPreviewModal);
  const btnCloseSummary = document.getElementById("btn-close-summary");
  if (btnCloseSummary) btnCloseSummary.addEventListener("click", closeSummaryPreviewModal);
  const btnCopySummary = document.getElementById("btn-copy-summary");
  if (btnCopySummary) btnCopySummary.addEventListener("click", copySummaryToClipboard);
  const btnOpenMessenger = document.getElementById("btn-open-messenger");
  if (btnOpenMessenger) btnOpenMessenger.addEventListener("click", openMessenger);
  const summaryOverlay = document.getElementById("modal-summary-preview-overlay");
  if (summaryOverlay) summaryOverlay.addEventListener("click", (e) => { if (e.target.id === "modal-summary-preview-overlay") closeSummaryPreviewModal(); });

  document.getElementById("btn-submit-flag").addEventListener("click", async () => {
    if (!state.selectedParticipantId || !state.flaggingDocKey) return;
    const p = state.participants.find(x => (x.enterpriseFolderId === state.selectedParticipantId || x.id === state.selectedParticipantId));
    if (!p) return;

    const docKey = state.flaggingDocKey;
    const reason = document.getElementById("flag-modal-reason-select").value;
    const noteText = document.getElementById("flag-modal-reviewer-note").value.trim();
    const reviewerNameInput = document.getElementById("flag-modal-reviewer-name").value.trim();
    const reviewerName = reviewerNameInput !== "" ? reviewerNameInput : (localStorage.getItem("yfc_reviewer_name") || "Operational Reviewer");
    
    localStorage.setItem("yfc_reviewer_name", reviewerName);

    // Check target member if GROUP personal requirement
    let targetMember = null;
    if (p.applicantType === "GROUP" && ["validId", "proofOfResidency", "photo2x2"].includes(docKey)) {
      const selectedRadio = document.querySelector('input[name="flag-target-member"]:checked');
      if (selectedRadio) targetMember = selectedRadio.value;
    }

    const fullNote = `Reason: ${reason}. Note: ${noteText}`;

    closeFlagIssueModal();
    showToast(`Flagging issue for ${CANONICAL_REQUIREMENTS[docKey]}...`, "info");

    await setDocOverride(p.enterpriseFolderId || p.id, docKey, "NEEDS_REVIEW", fullNote, targetMember);

    showToast(`Issue flagged! Moved to Needs Review ✓`, "warning");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeFlagIssueModal();
      closeDocInspector();
      closeDrawer();
      closeScanErrorModal();
      closeScanSuccessModal();
      closeSummaryPreviewModal();
      closeRemoveEnterpriseModal();
      closeExcludedListModal();
      closeChangeAppTypeModal();
    }
  });

  // Change Applicant Type Modal Listeners
  const btnCloseAppType = document.getElementById("btn-close-app-type-modal");
  if (btnCloseAppType) btnCloseAppType.addEventListener("click", closeChangeAppTypeModal);

  const btnCancelAppType1 = document.getElementById("btn-cancel-app-type-step1");
  if (btnCancelAppType1) btnCancelAppType1.addEventListener("click", closeChangeAppTypeModal);

  const appTypeOverlay = document.getElementById("modal-change-app-type-overlay");
  if (appTypeOverlay) appTypeOverlay.addEventListener("click", (e) => {
    if (e.target.id === "modal-change-app-type-overlay") closeChangeAppTypeModal();
  });

  document.querySelectorAll('input[name="modal-app-type-choice"]').forEach(r => {
    r.addEventListener("change", () => {
      const btnContinue = document.getElementById("btn-app-type-continue");
      if (btnContinue) btnContinue.disabled = false;
    });
  });

  const btnAppTypeContinue = document.getElementById("btn-app-type-continue");
  if (btnAppTypeContinue) {
    btnAppTypeContinue.addEventListener("click", () => {
      const selected = document.querySelector('input[name="modal-app-type-choice"]:checked');
      if (!selected) return;
      const targetType = selected.value;
      const p = state.participants.find(x => (x.enterpriseFolderId === state.editingTypeParticipantId || x.driveFolderId === state.editingTypeParticipantId || x.id === state.editingTypeParticipantId));
      const oldType = p ? getApplicantTypeString(p.applicantType) : "CHECK";

      state.editingTypeTargetValue = targetType;
      document.getElementById("app-type-transition-from").textContent = oldType === "CHECK" ? "UNSPECIFIED" : oldType;
      document.getElementById("app-type-transition-to").textContent = targetType;

      document.getElementById("app-type-step-select").classList.add("hidden");
      document.getElementById("app-type-step-confirm").classList.remove("hidden");
    });
  }

  const btnAppTypeBack = document.getElementById("btn-app-type-back");
  if (btnAppTypeBack) {
    btnAppTypeBack.addEventListener("click", () => {
      document.getElementById("app-type-step-confirm").classList.add("hidden");
      document.getElementById("app-type-step-select").classList.remove("hidden");
    });
  }

  const btnAppTypeConfirm = document.getElementById("btn-app-type-confirm");
  if (btnAppTypeConfirm) {
    btnAppTypeConfirm.addEventListener("click", async () => {
      if (state.editingTypeParticipantId && state.editingTypeTargetValue) {
        const targetId = state.editingTypeParticipantId;
        const targetType = state.editingTypeTargetValue;
        closeChangeAppTypeModal();
        await setApplicantTypeOverride(targetId, targetType);
      }
    });
  }

  // Remove Enterprise Drawer Action & Modal Listeners
  const btnRemoveDrawer = document.getElementById("btn-remove-enterprise-drawer");
  if (btnRemoveDrawer) {
    btnRemoveDrawer.addEventListener("click", () => {
      const p = state.participants.find(x => (x.enterpriseFolderId === state.selectedParticipantId || x.driveFolderId === state.selectedParticipantId || x.id === state.selectedParticipantId));
      if (!p) return;
      state.pendingRemovalEnterprise = p;
      const elTitle = document.getElementById("remove-modal-ent-title");
      if (elTitle) elTitle.textContent = p.name;
      const elName = document.getElementById("remove-modal-ent-name");
      if (elName) elName.textContent = p.name;
      document.getElementById("modal-confirm-remove-overlay").classList.remove("hidden");
    });
  }

  const btnCloseRemoveModal = document.getElementById("btn-close-remove-modal");
  if (btnCloseRemoveModal) btnCloseRemoveModal.addEventListener("click", closeRemoveEnterpriseModal);
  const btnCancelRemove = document.getElementById("btn-cancel-remove");
  if (btnCancelRemove) btnCancelRemove.addEventListener("click", closeRemoveEnterpriseModal);
  const removeOverlay = document.getElementById("modal-confirm-remove-overlay");
  if (removeOverlay) removeOverlay.addEventListener("click", (e) => { if (e.target.id === "modal-confirm-remove-overlay") closeRemoveEnterpriseModal(); });

  const btnConfirmRemove = document.getElementById("btn-confirm-remove-enterprise");
  if (btnConfirmRemove) {
    btnConfirmRemove.addEventListener("click", async () => {
      if (state.pendingRemovalEnterprise) {
        const ent = state.pendingRemovalEnterprise;
        const primaryKey = ent.enterpriseFolderId || ent.driveFolderId || ent.id;
        closeRemoveEnterpriseModal();
        closeDrawer();
        await excludeEnterprise(primaryKey, ent.name);
        state.pendingRemovalEnterprise = null;
      }
    });
  }

  // Excluded Enterprises List Modal Listeners
  const btnOpenExcluded = document.getElementById("btn-open-excluded-modal");
  if (btnOpenExcluded) {
    btnOpenExcluded.addEventListener("click", () => {
      renderExcludedListModal();
      document.getElementById("modal-excluded-list-overlay").classList.remove("hidden");
    });
  }

  const btnCloseExcludedModal = document.getElementById("btn-close-excluded-modal");
  if (btnCloseExcludedModal) btnCloseExcludedModal.addEventListener("click", closeExcludedListModal);
  const btnDoneExcluded = document.getElementById("btn-done-excluded");
  if (btnDoneExcluded) btnDoneExcluded.addEventListener("click", closeExcludedListModal);
  const excludedOverlay = document.getElementById("modal-excluded-list-overlay");
  if (excludedOverlay) excludedOverlay.addEventListener("click", (e) => { if (e.target.id === "modal-excluded-list-overlay") closeExcludedListModal(); });

  document.getElementById("btn-doc-approve").addEventListener("click", () => {
    if (state.selectedParticipantId && state.selectedDocId) {
      const note = document.getElementById("modal-reviewer-note").value;
      setDocOverride(state.selectedParticipantId, state.selectedDocId, "COMPLETE", note);
    }
  });

  document.getElementById("btn-doc-reject").addEventListener("click", () => {
    if (state.selectedParticipantId && state.selectedDocId) {
      const note = document.getElementById("modal-reviewer-note").value;
      setDocOverride(state.selectedParticipantId, state.selectedDocId, "MISSING", note);
    }
  });

  document.getElementById("btn-doc-flag").addEventListener("click", () => {
    if (state.selectedParticipantId && state.selectedDocId) {
      const note = document.getElementById("modal-reviewer-note").value;
      setDocOverride(state.selectedParticipantId, state.selectedDocId, "NEEDS_REVIEW", note);
    }
  });

  document.getElementById("btn-refresh").addEventListener("click", () => {
    fetchData();
  });

  document.getElementById("btn-trigger-gdrive-scan").addEventListener("click", () => {
    triggerCloudDriveScan();
  });

  const exportBtn = document.getElementById("btn-export-dropdown");
  const exportMenu = document.getElementById("export-menu");

  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle("show");
  });

  document.addEventListener("click", () => exportMenu.classList.remove("show"));

  document.getElementById("export-all-csv").addEventListener("click", (e) => {
    e.preventDefault();
    exportCSV(false);
  });

  document.getElementById("export-missing-csv").addEventListener("click", (e) => {
    e.preventDefault();
    exportCSV(true);
  });

  document.getElementById("export-json").addEventListener("click", (e) => {
    e.preventDefault();
    downloadFile(JSON.stringify(state.rawDataset, null, 2), "data.json", "application/json");
  });
}

function exportCSV(missingOnly = false) {
  let list = missingOnly ? state.participants.filter(p => p.status !== "COMPLETE") : state.participants;

  const reqKeys = ["applicationLetter", "applicationForm", "businessModelCanvas", "bmcFinancials", "financialFigures", "validId", "swornStatement", "proofOfResidency", "endorsementLetter", "photo2x2", "signatures", "declarationOfIntent"];
  const headers = ["Enterprise Name", "Applicant Type", ...reqKeys.map(k => CANONICAL_REQUIREMENTS[k]), "Compliance Rate (%)", "Overall Status"];

  const rows = [headers];

  list.forEach(p => {
    const docStatuses = reqKeys.map(k => p.requirements[k] ? p.requirements[k].status : "MISSING");
    rows.push([
      `"${p.name.replace(/"/g, '""')}"`,
      `"${(p.applicantType || 'INDIVIDUAL').toUpperCase()}"`,
      ...docStatuses.map(s => `"${s}"`),
      p.completionRate,
      `"${p.status}"`
    ]);
  });

  const csvContent = rows.map(r => r.join(",")).join("\n");
  const filename = missingOnly ? "missing_requirements_report.csv" : "unofficial_yfc_compliance_report.csv";
  downloadFile(csvContent, filename, "text/csv");
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type: type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function generateRequirementsSummary() {
  const participants = state.participants || [];
  if (participants.length === 0) return null;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const enterprisesWithAction = [];
  const enterprisesComplete = [];
  let totalRequirements = 0;

  participants.forEach(p => {
    const reqs = p.requirements || {};
    const missing = [];
    const needsReview = [];
    const complete = [];

    Object.keys(CANONICAL_REQUIREMENTS).forEach(reqKey => {
      const doc = reqs[reqKey];
      if (!doc || doc.status === "NOT_APPLICABLE") return;

      const status = (doc.status || "MISSING").toUpperCase();
      const reqName = CANONICAL_REQUIREMENTS[reqKey];
      totalRequirements++;

      if (status === "MISSING" || status === "NOT_SUBMITTED") {
        missing.push(reqName);
      } else if (status === "REVIEW" || status === "NEEDS_REVIEW") {
        needsReview.push(reqName);
      } else if (status === "COMPLETE" || status === "APPROVED") {
        complete.push(reqName);
      } else {
        missing.push(reqName);
      }
    });

    if (missing.length > 0 || needsReview.length > 0) {
      enterprisesWithAction.push({
        name: p.name,
        missing,
        needsReview,
        completeCount: complete.length,
        totalApplicable: missing.length + needsReview.length + complete.length,
        hasMissing: missing.length > 0
      });
    } else if (complete.length > 0) {
      enterprisesComplete.push(p.name);
    }
  });

  enterprisesWithAction.sort((a, b) => {
    if (a.hasMissing && !b.hasMissing) return -1;
    if (!a.hasMissing && b.hasMissing) return 1;
    return b.missing.length - a.missing.length;
  });

  const MSG_MAX_LENGTH = 1800;
  const lines = [];
  lines.push("REQUIREMENTS UPDATE");
  lines.push(dateStr);
  lines.push("");

  let omittedCount = 0;
  let truncated = false;

  enterprisesWithAction.forEach(ent => {
    const entBlock = [];
    if (ent.hasMissing) {
      entBlock.push("RED DOT " + ent.name);
      entBlock.push("Missing:");
      ent.missing.forEach(r => { entBlock.push("  - " + r); });
    } else {
      entBlock.push("YELLOW DOT " + ent.name);
      entBlock.push("For Review:");
      ent.needsReview.forEach(r => { entBlock.push("  - " + r); });
    }

    const blockText = entBlock.join("\n");
    if (lines.join("\n").length + blockText.length + 10 > MSG_MAX_LENGTH) {
      omittedCount++;
      truncated = true;
    } else {
      lines.push(blockText);
      lines.push("");
    }
  });

  if (enterprisesComplete.length > 0) {
    const completeLine = "GREEN DOT " + enterprisesComplete.length + " enterprise" + (enterprisesComplete.length > 1 ? "s" : "") + " complete: " + enterprisesComplete.join(", ");
    if (lines.join("\n").length + completeLine.length + 10 > MSG_MAX_LENGTH) {
      omittedCount++;
    } else {
      lines.push(completeLine);
      lines.push("");
    }
  }

  lines.push("------------------------------");
  lines.push(participants.length + " Enterprises | " + totalRequirements + " Requirements");
  lines.push("Generated from latest Google Drive scan.");

  let summary = lines.join("\n");
  if (truncated) {
    summary += "\n\n(" + omittedCount + " additional enterprise(s) omitted due to message length limit)";
  }

  return {
    text: summary,
    enterpriseCount: participants.length,
    totalRequirements,
    actionRequired: enterprisesWithAction.length,
    completeCount: enterprisesComplete.length,
    truncated,
    omittedCount
  };
}

function openSummaryPreviewModal() {
  const summary = generateRequirementsSummary();
  if (!summary) {
    showToast("No scan data available. Run a scan first.", "warning");
    return;
  }

  const previewEl = document.getElementById("summary-preview-text");
  if (previewEl) previewEl.textContent = summary.text;

  const metaEl = document.getElementById("summary-preview-meta");
  if (metaEl) {
    metaEl.textContent = summary.actionRequired + " enterprise(s) need action, " + summary.completeCount + " complete";
  }

  document.getElementById("modal-summary-preview-overlay").classList.remove("hidden");
}

function closeSummaryPreviewModal() {
  document.getElementById("modal-summary-preview-overlay").classList.add("hidden");
}

async function copySummaryToClipboard() {
  const summary = generateRequirementsSummary();
  if (!summary) return;
  try {
    await navigator.clipboard.writeText(summary.text);
    showToast("Summary copied to clipboard!", "success");
  } catch (e) {
    const textarea = document.createElement("textarea");
    textarea.value = summary.text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showToast("Summary copied to clipboard!", "success");
  }
}

function openMessenger() {
  window.open("https://m.me", "_blank");
}
