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
  const supabaseUrl = window.SUPABASE_URL || (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_URL : null) || "https://gndnmbdzfoamtgjkvnyr.supabase.co";
  const supabaseKey = window.SUPABASE_ANON_KEY || (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_ANON_KEY : null) || "sb_publishable_zojIDwrTmNXHQLWuOhm7yQ_2pIvgypM";

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
      scanMap[resolvedFolderId][row.requirement_id] = {
        automatedStatus: row.automated_status,
        confidence: row.confidence,
        documentType: row.document_type,
        fileName: row.file_name,
        fileId: row.file_id,
        driveUrl: row.drive_url,
        matchedFiles: row.matched_files || []
      };
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
      participantsMap[folderKey] = {
        enterpriseFolderId: folderKey,
        id: entScan._enterpriseId || folderKey,
        name: entScan._enterpriseName || formatEnterpriseNameFromId(folderKey),
        applicantType: entScan._applicantType || "INDIVIDUAL",
        driveUrl: entScan._driveUrl || `https://drive.google.com/drive/folders/${folderKey}`,
        driveFolderId: folderKey,
        requirements: {}
      };

      // Populate requirement statuses from scan_results
      Object.keys(CANONICAL_REQUIREMENTS).forEach(reqKey => {
        const reqScan = entScan[reqKey];
        if (reqScan) {
          participantsMap[folderKey].requirements[reqKey] = {
            status: reqScan.automatedStatus || "MISSING",
            automatedStatus: reqScan.automatedStatus || "MISSING",
            files: reqScan.matchedFiles && reqScan.matchedFiles.length > 0 ? reqScan.matchedFiles : (reqScan.fileName ? [{ name: reqScan.fileName, confidence: reqScan.confidence, fileId: reqScan.fileId, webViewLink: reqScan.driveUrl }] : [])
          };
        }
      });
    });
  }

  // 2. Overlay or seed baseline from local data.json if available
  if (localDataset && localDataset.participants) {
    localDataset.participants.forEach(p => {
      const primaryKey = resolveFolderKey(p.enterpriseFolderId || p.driveFolderId, p.id, p.name, identityMap) || p.id;
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
      console.log("[MERGE] Applying overrides for", copy.name, "entKey:", entKey, "overrideKeys:", Object.keys(activeOverrides));
      Object.keys(activeOverrides).forEach(docKey => {
        if (copy.requirements[docKey]) {
          const oldStatus = copy.requirements[docKey].status;
          copy.requirements[docKey].review = activeOverrides[docKey];
          if (activeOverrides[docKey].manualStatus) {
            copy.requirements[docKey].status = activeOverrides[docKey].manualStatus;
            console.log("[MERGE]   Override", docKey, ":", oldStatus, "->", activeOverrides[docKey].manualStatus);
          }
        } else {
          console.log("[MERGE]   Override key", docKey, "not found in requirements for", copy.name);
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
  const isGroup = (p.applicantType || "INDIVIDUAL").toUpperCase() === "GROUP";

  if (!isGroup) {
    // INDIVIDUAL Calculation (100% Backward Compatible 11-slot model)
    const applicableReqKeys = Object.keys(CANONICAL_REQUIREMENTS).filter(k => {
      return reqs[k] && reqs[k].status !== "NOT_APPLICABLE";
    });

    const totalApplicable = applicableReqKeys.length;
    let completeCount = 0;
    let missingCount = 0;
    let needsReviewCount = 0;

    applicableReqKeys.forEach(k => {
      const st = (reqs[k].status || "MISSING").toUpperCase();
      if (st === "COMPLETE" || st === "APPROVED") completeCount++;
      if (st === "MISSING") missingCount++;
      if (st === "NEEDS_REVIEW") needsReviewCount++;
    });

    p.completionRate = totalApplicable > 0 ? Math.round((completeCount / totalApplicable) * 1000) / 10 : 0.0;
    p.completeCount = completeCount;
    p.missingCount = missingCount;
    p.needsReviewCount = needsReviewCount;
    p.applicableRequirementsCount = totalApplicable;

    if (completeCount === totalApplicable) {
      p.status = "COMPLETE";
      p.priority = "FULLY COMPLIANT";
    } else if (p.completionRate < 60 || missingCount >= 3) {
      p.status = missingCount > 0 ? "INCOMPLETE" : "NEEDS_REVIEW";
      p.priority = "HIGH";
    } else if (needsReviewCount > 0 || missingCount > 0) {
      p.status = needsReviewCount > 0 ? "NEEDS_REVIEW" : "INCOMPLETE";
      p.priority = "MEDIUM";
    } else {
      p.status = "COMPLETE";
      p.priority = "LOW";
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
  applicableSharedKeys.forEach(k => {
    const st = (reqs[k].status || "MISSING").toUpperCase();
    if (st === "COMPLETE" || st === "APPROVED") completedSharedCount++;
  });

  p.memberDetails = {};
  let totalMemberSlots = 0;
  let completedMemberSlots = 0;

  if (membersList.length > 0) {
    membersList.forEach(mName => {
      p.memberDetails[mName] = {};
      personalReqKeys.forEach(reqKey => {
        totalMemberSlots++;
        const doc = reqs[reqKey];
        let mStatus = "MISSING";
        let mFile = null;

        if (doc && doc.files) {
          const matchingFile = doc.files.find(f => (f.memberName || "").toUpperCase() === mName);
          if (matchingFile) {
            mFile = matchingFile;
            mStatus = (matchingFile.confidence || 0.9) >= 0.85 ? "COMPLETE" : "NEEDS_REVIEW";
          }
        }

        // Apply human review override if specifically set for member/requirement
        if (state.overrides && state.overrides[p.enterpriseFolderId] && state.overrides[p.enterpriseFolderId][`${reqKey}_${mName}`]) {
          mStatus = state.overrides[p.enterpriseFolderId][`${reqKey}_${mName}`].manualStatus;
        }

        p.memberDetails[mName][reqKey] = { status: mStatus, file: mFile };
        if (mStatus === "COMPLETE" || mStatus === "APPROVED") {
          completedMemberSlots++;
        }
      });
    });
  } else {
    // Fallback if no specific member names are parsed yet
    personalReqKeys.forEach(reqKey => {
      totalMemberSlots++;
      const st = (reqs[reqKey]?.status || "MISSING").toUpperCase();
      if (st === "COMPLETE" || st === "APPROVED") completedMemberSlots++;
    });
  }

  const totalSharedSlots = applicableSharedKeys.length;
  const grandTotalSlots = totalSharedSlots + totalMemberSlots;
  const grandCompletedSlots = completedSharedCount + completedMemberSlots;

  p.completionRate = grandTotalSlots > 0 ? Math.round((grandCompletedSlots / grandTotalSlots) * 1000) / 10 : 0.0;
  p.completeCount = grandCompletedSlots;
  p.totalGroupSlots = grandTotalSlots;
  p.applicableRequirementsCount = grandTotalSlots;

  if (grandCompletedSlots === grandTotalSlots) {
    p.status = "COMPLETE";
    p.priority = "FULLY COMPLIANT";
  } else if (p.completionRate < 60) {
    p.status = "INCOMPLETE";
    p.priority = "HIGH";
  } else {
    p.status = "NEEDS_REVIEW";
    p.priority = "MEDIUM";
  }
}

function generateNextActionString(p) {
  if (p.completionRate === 100) return "Enterprise is fully compliant! All required documents submitted.";
  
  const reqs = p.requirements || {};
  const missingNames = [];
  const reviewNames = [];

  Object.keys(CANONICAL_REQUIREMENTS).forEach(k => {
    const doc = reqs[k];
    if (doc && doc.status !== "NOT_APPLICABLE") {
      if (doc.status === "MISSING" || doc.status === "REJECTED") {
        missingNames.push(CANONICAL_REQUIREMENTS[k]);
      } else if (doc.status === "NEEDS_REVIEW") {
        reviewNames.push(CANONICAL_REQUIREMENTS[k]);
      }
    }
  });

  if (missingNames.length > 0 && reviewNames.length > 0) {
    return `Submit ${missingNames.slice(0, 2).join(", ")} and verify ${reviewNames.slice(0, 2).join(", ")}.`;
  } else if (missingNames.length > 0) {
    return `Submit ${missingNames.length} missing document${missingNames.length > 1 ? 's' : ''}: ${missingNames.slice(0, 3).join(", ")}.`;
  } else if (reviewNames.length > 0) {
    return `Review ${reviewNames.length} document${reviewNames.length > 1 ? 's' : ''} requiring human verification: ${reviewNames.slice(0, 3).join(", ")}.`;
  }
  return "Review enterprise document checklist.";
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
      list = list.filter(p => p.needsReviewCount > 0 || p.status === "NEEDS_REVIEW");
    } else if (fst === "priority_high") {
      list = list.filter(p => p.priority === "HIGH");
    }
  }

  // Type Filter
  if (state.activeFilterType !== "all") {
    const tp = state.activeFilterType;
    if (tp === "type_individual") {
      list = list.filter(p => (p.applicantType || '').toUpperCase() === "INDIVIDUAL");
    } else if (tp === "type_group") {
      list = list.filter(p => (p.applicantType || '').toUpperCase() === "GROUP");
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

  renderKPICards();
  renderPriorityBar();
  renderAnalyticsBars();
  renderActionCenter();
  renderTable();
}

function renderKPICards() {
  const total = state.participants.length;
  const complete = state.participants.filter(p => p.status === "COMPLETE").length;
  const needsReview = state.participants.filter(p => p.needsReviewCount > 0 || p.status === "NEEDS_REVIEW").length;
  const incomplete = state.participants.filter(p => p.completionRate < 100).length;
  const avgComp = total > 0 ? Math.round((state.participants.reduce((acc, p) => acc + p.completionRate, 0) / total) * 10) / 10 : 0;

  document.getElementById("val-total-participants").textContent = total;
  document.getElementById("val-needs-review").textContent = needsReview;
  document.getElementById("val-incomplete").textContent = incomplete;
  document.getElementById("val-compliance-rate").textContent = `${avgComp}%`;
  document.getElementById("fill-overall-compliance").style.width = `${avgComp}%`;

  document.querySelectorAll(".kpi-card.interactive").forEach(card => {
    card.classList.toggle("active", card.dataset.filter === state.activeFilterStatus);
  });
}

function renderPriorityBar() {
  const total = state.participants.length;
  const complete = state.participants.filter(p => p.status === "COMPLETE").length;
  const needsReview = state.participants.filter(p => p.needsReviewCount > 0).length;
  const highPriority = state.participants.filter(p => p.priority === "HIGH").length;
  const requiringAction = total - complete;

  document.getElementById("priority-cnt-action").textContent = requiringAction;
  document.getElementById("priority-cnt-review").textContent = needsReview;
  document.getElementById("priority-cnt-high").textContent = highPriority;
  document.getElementById("priority-cnt-complete").textContent = complete;

  document.querySelectorAll(".priority-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === state.activeFilterStatus);
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

    let priorityBadgeClass = "priority-medium";
    if (p.priority === "HIGH") priorityBadgeClass = "priority-high";
    if (p.priority === "LOW") priorityBadgeClass = "priority-low";
    if (p.priority === "FULLY COMPLIANT") priorityBadgeClass = "priority-complete";

    tr.innerHTML = `
      <td>
        <div class="participant-name-cell">
          <span class="p-name">${escapeHtml(p.name)}</span>
        </div>
      </td>
      <td><span class="badge" style="background:#1f2937; color:#d1d5db;">${(p.applicantType || 'INDIVIDUAL').toUpperCase()}</span></td>
      <td>
        <div style="display:flex; flex-direction:column; gap:2px; min-width:110px;">
          <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700;">
            <span>${p.completionRate}%</span>
          </div>
          <div class="progress-bar-bg" style="margin-top:2px;">
            <div class="progress-bar-fill" style="width: ${p.completionRate}%;"></div>
          </div>
        </div>
      </td>
      <td><span class="badge badge-approved">${p.completeCount}</span></td>
      <td><span class="badge badge-review">${p.needsReviewCount}</span></td>
      <td><span class="badge badge-missing">${p.missingCount}</span></td>
      <td><span class="badge-priority ${priorityBadgeClass}">${p.priority}</span></td>
      <td style="text-align:right;">
        <button class="btn btn-secondary btn-sm btn-review-row" data-id="${primaryKey}">Review →</button>
      </td>
    `;

    tr.addEventListener("click", () => openDrawer(primaryKey));
    tbody.appendChild(tr);
  });
}

function renderDocStatusBadge(status) {
  const st = (status || "MISSING").toUpperCase();
  switch (st) {
    case "COMPLETE":
    case "APPROVED":
      return `<span class="badge badge-approved">✓ Complete</span>`;
    case "NEEDS_REVIEW":
      return `<span class="badge badge-review">⚠ Needs review</span>`;
    case "REJECTED":
      return `<span class="badge badge-rejected">✕ Missing</span>`;
    case "NOT_APPLICABLE":
      return `<span class="badge badge-na">— Not applicable</span>`;
    case "MISSING":
    default:
      return `<span class="badge badge-missing">✕ Missing</span>`;
  }
}

function openDrawer(participantId) {
  const p = state.participants.find(x => (x.enterpriseFolderId === participantId || x.driveFolderId === participantId || x.id === participantId));
  if (!p) return;

  const primaryFolderId = p.enterpriseFolderId || p.driveFolderId || p.id;
  state.selectedParticipantId = primaryFolderId;

  document.getElementById("drawer-participant-name").textContent = p.name;
  document.getElementById("drawer-applicant-type").textContent = (p.applicantType || 'INDIVIDUAL').toUpperCase();
  document.getElementById("drawer-comp-rate-badge").textContent = `${p.completionRate}% Compliance`;

  const driveLink = document.getElementById("drawer-drive-url");
  driveLink.href = p.driveUrl || `https://drive.google.com/drive/folders/${primaryFolderId}`;

  document.getElementById("drawer-subhead-counts").textContent = `${p.missingCount} Missing · ${p.needsReviewCount} Needs Review · ${p.completeCount} Complete`;

  // Next Action
  document.getElementById("drawer-next-action-text").textContent = generateNextActionString(p);

  const reviewRequiredList = document.getElementById("drawer-review-required-list");
  const completedList = document.getElementById("drawer-completed-list");
  const completedCountTag = document.getElementById("completed-count-tag");

  reviewRequiredList.innerHTML = "";
  completedList.innerHTML = "";

  let reviewCount = 0;
  let completeCount = 0;

  Object.keys(CANONICAL_REQUIREMENTS).forEach(docKey => {
    const docName = CANONICAL_REQUIREMENTS[docKey];
    const docData = p.requirements[docKey] || { status: "MISSING", files: [] };
    const files = docData.files || [];
    const isNotApplicable = docData.status === "NOT_APPLICABLE";
    const isUnresolved = docData.status === "MISSING" || docData.status === "NEEDS_REVIEW" || docData.status === "REJECTED";

    const histKey = `${primaryFolderId}_${docKey}`;
    const histLogs = state.reviewHistory[histKey] || state.reviewHistory[`${p.id}_${docKey}`] || [];
    const histBadgeTag = histLogs.length > 0 ? `<span class="badge" style="background:#374151; color:#a5b4fc; font-size:0.65rem;">📜 ${histLogs.length} review${histLogs.length > 1 ? 's' : ''} logged</span>` : '';

    const card = document.createElement("div");
    card.className = "doc-item-card";
    
    const autoStatusBadge = renderDocStatusBadge(docData.automatedStatus || docData.status);
    const humanReviewBadge = docData.review ? `<span class="badge" style="background:#4f46e5; color:#ffffff;">HUMAN: ${escapeHtml(docData.review.manualStatus)}</span>` : '';

    let memberListHtml = '';
    if (p.applicantType === "GROUP" && ["validId", "proofOfResidency", "photo2x2"].includes(docKey) && p.groupMembers && p.groupMembers.length > 0) {
      const mems = p.groupMembers;
      const compCount = mems.filter(m => p.memberDetails[m] && p.memberDetails[m][docKey] && (p.memberDetails[m][docKey].status === 'COMPLETE' || p.memberDetails[m][docKey].status === 'APPROVED')).length;
      
      memberListHtml = `
        <div style="margin-top:6px; background:#111827; padding:6px 10px; border-radius:4px; border:1px solid #374151;">
          <div style="font-size:0.72rem; font-weight:700; color:#38bdf8; margin-bottom:4px;">
            MEMBER CHECKLIST (${compCount} / ${mems.length} MEMBERS COMPLETE):
          </div>
          <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.72rem;">
            ${mems.map(m => {
              const mInfo = p.memberDetails[m] ? p.memberDetails[m][docKey] : null;
              const isComp = mInfo && (mInfo.status === 'COMPLETE' || mInfo.status === 'APPROVED');
              return `<span style="color:${isComp ? '#4ade80' : '#f87171'}; font-weight:600;">
                ${isComp ? '✓' : '✕'} ${escapeHtml(m)} ${isComp ? '' : '— Missing'}
              </span>`;
            }).join("")}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="doc-item-header">
        <span class="doc-item-title">${docName} ${files.length > 1 ? `<span style="font-size:0.75rem; color:#f59e0b;">(${files.length} files matched)</span>` : ''}</span>
        <div style="display:flex; gap:4px; align-items:center;">
          ${histBadgeTag}
          ${humanReviewBadge}
          ${autoStatusBadge}
        </div>
      </div>
      <div class="doc-item-filename">
        ${files.length > 0 ? `Matched file: <strong>${escapeHtml(files[0].name)}</strong>` : (isNotApplicable ? 'Not applicable for Individual applicant' : 'No candidate document detected.')}
      </div>
      ${memberListHtml}
      ${docData.review ? `<span class="meta-sub" style="font-size:0.7rem; color:#a5b4fc;">Entered by: <strong>${escapeHtml(docData.review.reviewedBy || 'Operational Reviewer')}</strong> (${new Date(docData.review.reviewedAt).toLocaleTimeString()}) ${docData.review.note ? `— <em>"${escapeHtml(docData.review.note)}"</em>` : ''}</span>` : ''}
      ${!isNotApplicable ? `
      <div class="doc-item-actions">
        ${files.length > 0 ? `<button class="btn btn-secondary btn-sm btn-inspect-doc" data-doc="${docKey}">Inspect Evidence</button>` : `<button class="btn btn-secondary btn-sm btn-inspect-doc" data-doc="${docKey}">View Details & History</button>`}
        <button class="btn btn-success btn-sm btn-approve-doc" data-doc="${docKey}">Approve</button>
        <button class="btn btn-danger btn-sm btn-reject-doc" data-doc="${docKey}">Mark Missing</button>
      </div>` : ''}
    `;

    const btnInspect = card.querySelector(".btn-inspect-doc");
    if (btnInspect) btnInspect.addEventListener("click", (e) => { e.stopPropagation(); openDocInspector(docKey); });

    const btnApprove = card.querySelector(".btn-approve-doc");
    if (btnApprove) btnApprove.addEventListener("click", (e) => {
      e.stopPropagation();
      setDocOverride(primaryFolderId, docKey, "COMPLETE");
    });

    const btnReject = card.querySelector(".btn-reject-doc");
    if (btnReject) btnReject.addEventListener("click", (e) => {
      e.stopPropagation();
      setDocOverride(primaryFolderId, docKey, "MISSING");
    });

    if (isUnresolved && !isNotApplicable) {
      reviewRequiredList.appendChild(card);
      reviewCount++;
    } else {
      completedList.appendChild(card);
      completeCount++;
    }
  });

  if (reviewCount === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.fontSize = "0.8rem";
    emptyDiv.style.color = "#10b981";
    emptyDiv.style.fontWeight = "600";
    emptyDiv.textContent = "✓ All mandatory requirements satisfied!";
    reviewRequiredList.appendChild(emptyDiv);
  }

  completedCountTag.textContent = `(${completeCount})`;

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

async function setDocOverride(participantId, docKey, humanStatus, note = "") {
  const p = state.participants.find(x => (x.enterpriseFolderId === participantId || x.id === participantId));
  if (!p || !p.requirements[docKey]) return;

  const primaryFolderId = p.enterpriseFolderId || p.driveFolderId || p.id;
  const doc = p.requirements[docKey];
  const previousStatus = doc.status || "MISSING";
  const topFile = doc.files && doc.files.length > 0 ? doc.files[0] : null;
  const fileId = topFile ? (topFile.fileId || topFile.id || "") : "";

  // Get reviewer name entered by user
  const nameInput = document.getElementById("modal-reviewer-name");
  let reviewerName = nameInput && nameInput.value.trim() !== "" ? nameInput.value.trim() : (localStorage.getItem("yfc_reviewer_name") || "Operational Reviewer");
  
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
    fileId: fileId
  };

  // Create local history entry log
  const histKey = `${primaryFolderId}_${docKey}`;
  if (!state.reviewHistory[histKey]) state.reviewHistory[histKey] = [];
  
  const historyItem = {
    id: 'local_' + Date.now(),
    previousStatus: previousStatus,
    newStatus: humanStatus,
    reviewerName: reviewerName,
    notes: note,
    createdAt: new Date().toISOString()
  };
  
  // Add to top of history list (newest first)
  state.reviewHistory[histKey].unshift(historyItem);

  // 1. Update local state fallback immediately
  if (!state.overrides[primaryFolderId]) state.overrides[primaryFolderId] = {};
  state.overrides[primaryFolderId][docKey] = reviewPayload;
  saveLocalOverrides();

  // 2. Persist to Supabase (upsert latest decision + insert immutable history log)
  console.log("[PERSISTENCE] setDocOverride called:", {
    enterpriseName: p.name,
    enterprise_folder_id: primaryFolderId,
    enterprise_id: p.id,
    requirement_id: docKey,
    human_status: humanStatus,
    reviewer_name: reviewerName,
    supabaseClient_exists: !!supabaseClient,
    supabaseClient_type: supabaseClient ? typeof supabaseClient.from : "null"
  });

  if (supabaseClient) {
    try {
      // Upsert current decision using enterprise_folder_id + requirement_id
      console.log("[PERSISTENCE] Attempting UPSERT to human_reviews...");
      const upsertResult = await supabaseClient
        .from('human_reviews')
        .upsert({
          enterprise_folder_id: primaryFolderId,
          enterprise_id: p.id,
          requirement_id: docKey,
          file_id: fileId,
          automated_status: doc.automatedStatus || doc.status,
          human_status: humanStatus,
          reviewer_name: reviewerName,
          reviewer_notes: note,
          updated_at: new Date().toISOString()
        }, { onConflict: 'enterprise_id,requirement_id' });

      console.log("[PERSISTENCE] UPSERT result:", {
        data: upsertResult.data,
        error: upsertResult.error,
        status: upsertResult.status,
        statusText: upsertResult.statusText
      });

      if (upsertResult.error) {
        console.error("[PERSISTENCE] UPSERT ERROR:", upsertResult.error);
      }

      // Insert immutable audit history record
      console.log("[PERSISTENCE] Attempting INSERT to human_review_history...");
      const histResult = await supabaseClient
        .from('human_review_history')
        .insert({
          enterprise_folder_id: primaryFolderId,
          enterprise_id: p.id,
          requirement_id: docKey,
          file_id: fileId,
          previous_status: previousStatus,
          new_status: humanStatus,
          reviewer_name: reviewerName,
          reviewer_notes: note,
          created_at: new Date().toISOString()
        });

      console.log("[PERSISTENCE] HISTORY INSERT result:", {
        data: histResult.data,
        error: histResult.error,
        status: histResult.status
      });

      if (histResult.error) {
        console.error("[PERSISTENCE] HISTORY INSERT ERROR:", histResult.error);
        showToast(`Saved locally (history insert failed: ${histResult.error.message})`, "error");
      } else {
        showToast(`Review decision & audit history saved to Supabase! ✓ (Reviewer: ${reviewerName})`, "success");
      }
    } catch (err) {
      console.error("[PERSISTENCE] Supabase execution error:", err);
      showToast("Saved locally (Supabase sync failed)", "info");
    }
  } else {
    console.warn("[PERSISTENCE] supabaseClient is NULL - cannot persist to Supabase");
    showToast(`Decision saved locally ✓ (Entered by: ${reviewerName})`, "info");
  }

  if (btnApprove) btnApprove.disabled = false;
  if (btnReject) btnReject.disabled = false;
  if (btnFlag) btnFlag.disabled = false;

  doc.review = reviewPayload;
  doc.status = humanStatus;
  recalculateEnterpriseScores(p);

  applyFiltersAndRender();
  if (state.selectedParticipantId === primaryFolderId) {
    openDrawer(primaryFolderId);
  }
}

// ============================================================================
// ONLINE CLOUD GOOGLE DRIVE SCANNER TRIGGER & STATUS POLLING
// ============================================================================
async function triggerCloudDriveScan() {
  if (state.isScanning) return;

  const btnScan = document.getElementById("btn-trigger-gdrive-scan");
  const scanLabel = document.getElementById("scan-status-label");

  state.isScanning = true;
  if (btnScan) {
    btnScan.disabled = true;
    btnScan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Starting scan...`;
  }
  if (scanLabel) scanLabel.textContent = "Starting Cloud Scan...";

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      const errText = await res.text();
      let errJson = null;
      try { errJson = JSON.parse(errText); } catch (e) {}
      const errMsg = (errJson && errJson.error) ? errJson.error : `HTTP ${res.status}: ${res.statusText || 'Server error'}`;
      showToast(`Scan Error: ${errMsg}`, "error");
      resetScanUI(`Scan error (${res.status})`);
      return;
    }

    const data = await res.json();

    if (!data.success && data.error && !data.jobId) {
      showToast(`Scan Trigger Failed: ${data.error}`, "error");
      resetScanUI("Scan failed");
      return;
    }

    // Handle immediate FAILED response (e.g., Google Drive credentials missing)
    if (data.status === "FAILED") {
      state.isScanning = false;
      if (btnScan) btnScan.disabled = false;
      resetScanUI("Scan failed");
      showToast(`Scan Failed: ${data.error || 'Google Drive scanner unavailable'}`, "error");
      return;
    }

    if (data.success && data.status === "COMPLETED") {
      state.isScanning = false;
      if (btnScan) btnScan.disabled = false;

      await fetchData();

      const folders = data.uniqueEnterpriseFolders || data.foldersFound || state.participants.length;
      const newFound = data.newEnterprisesFound || 0;
      const saved = data.resultsSaved || 0;
      const reconciled = data.legacyRecordsReconciled || 0;

      if (scanLabel) scanLabel.textContent = `Scan complete — ${folders} enterprises`;

      const msgParts = [`${folders} unique enterprise folders scanned`];
      if (newFound > 0) msgParts.push(`${newFound} new enterprise(s) found`);
      if (saved > 0) msgParts.push(`${saved} results saved`);
      if (reconciled > 0) msgParts.push(`${reconciled} legacy records reconciled`);

      showToast(`Scan complete: ${msgParts.join(', ')} ✓`, "success");
      return;
    }

    state.activeJobId = data.jobId;

    if (btnScan) {
      btnScan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Scanning Google Drive...`;
    }

    showToast("Online Cloud Google Drive scan initiated...", "info");
    startScanStatusPolling(data.jobId);

  } catch (err) {
    console.warn("Failed calling /api/scan endpoint, triggering scan data reload fallback:", err);
    showToast("Scan endpoint unreachable. Refreshing data from database...", "info");
    setTimeout(async () => {
      await fetchData();
      resetScanUI("Refreshed (scan endpoint unavailable)");
      showToast("Data refreshed from database ✓", "success");
    }, 1500);
  }
}

function startScanStatusPolling(jobId) {
  if (state.scanPollInterval) clearInterval(state.scanPollInterval);

  const scanLabel = document.getElementById("scan-status-label");

  state.scanPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/scan-status?job_id=${jobId || ''}`);
      const data = await res.json();

      if (scanLabel) {
        scanLabel.textContent = `Scanning Google Drive (${data.uniqueEnterpriseFolders || data.foldersFound || 16} unique enterprise folders)...`;
      }

      if (data.status === 'COMPLETED') {
        clearInterval(state.scanPollInterval);
        state.scanPollInterval = null;
        await fetchData();
        resetScanUI("Scan complete");
        
        const folders = data.uniqueEnterpriseFolders || data.foldersFound || state.participants.length;
        const newFound = data.newEnterprisesFound || 0;
        const msg = newFound > 0 
          ? `Scan complete — ${folders} unique enterprise folders scanned, ${newFound} new enterprise(s) found! ✓`
          : `Scan complete — ${folders} unique enterprise folders scanned! ✓`;

        showToast(msg, "success");
      } else if (data.status === 'FAILED') {
        clearInterval(state.scanPollInterval);
        state.scanPollInterval = null;
        state.isScanning = false;
        const btnScan = document.getElementById("btn-scan");
        if (btnScan) btnScan.disabled = false;
        resetScanUI("Scan failed");
        showToast(`Scan Failed: ${data.error || 'Google Drive scanner unavailable. No changes were made.'}`, "error");
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDocInspector();
      closeDrawer();
    }
  });

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
