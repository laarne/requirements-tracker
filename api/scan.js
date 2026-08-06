const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

const CANONICAL_REQUIREMENTS = {
  "applicationLetter": {
    name: "Application Letter",
    keywords: ["application letter", "letter of application", "app letter", "intent letter", "joint application", "start up individual application"]
  },
  "applicationForm": {
    name: "Application Form",
    keywords: ["application form", "app form", "form b", "start up form", "entry form", "registration form"]
  },
  "businessModelCanvas": {
    name: "Business Model Canvas (BMC)",
    keywords: ["business model canvas", "business model", "bmc template", "canvas", "bmc"]
  },
  "bmcFinancials": {
    name: "BMC Financials",
    keywords: ["bmc financial", "financial projections", "projections", "financial plan"]
  },
  "financialFigures": {
    name: "Financial Figures / Expenses",
    keywords: ["activity and financial plan", "financial plan", "cashflow", "cash flow", "financial statement", "budget", "income statement", "balance sheet", "expenses"]
  },
  "validId": {
    name: "Valid ID",
    keywords: ["valid id", "government id", "national id", "philid", "driver license", "drivers license", "umid", "voter id", "postal id", "prc id", "passport id", "passport", "id card", "scanned copy valid id"]
  },
  "swornStatement": {
    name: "Sworn Statement of New Business",
    keywords: ["sworn statement", "affidavit", "form c", "form j", "declaration new business", "authority to use land"]
  },
  "proofOfResidency": {
    name: "Proof of Residency",
    keywords: ["proof of residency", "residency", "residence", "barangay certificate", "barangay clearance", "certificate of residency", "proof of address"]
  },
  "endorsementLetter": {
    name: "Endorsement Letter",
    keywords: ["endorsement letter", "endorsement", "endorsment", "recommending letter", "recommendation", "reccomendation", "lgu endorsement", "endorse", "agriculture office"]
  },
  "photo2x2": {
    name: "2 x 2 Photo",
    keywords: ["2x2", "2 x 2", "2by2", "id photo", "applicant photo", "headshot", "passport photo", "picture", "photo"]
  },
  "signatures": {
    name: "Required Signatures",
    keywords: ["signed", "signature", "signed form", "signed copy", "with signature"]
  },
  "declarationOfIntent": {
    name: "Declaration of Intent",
    keywords: ["declaration of intent", "declaration intent", "intent declaration", "group declaration", "annex a"]
  }
};

const FILENAME_ALIASES = {
  "passport id": "validId",
  "passport": "validId",
  "id picture": "validId",
  "id pic": "validId",
  "2x2 picture": "photo2x2",
  "2x2 photo": "photo2x2",
  "id photo 2x2": "photo2x2",
  "passport picture": "photo2x2",
  "headshot": "photo2x2",
  "bmc financials": "bmcFinancials",
  "bmc financial": "bmcFinancials",
};

const MASTER_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = process.env.SUPABASE_URL || "https://gndnmbdzfoamtgjkvnyr.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_zojIDwrTmNXHQLWuOhm7yQ_2pIvgypM";

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Rate-limiting check: Prevent duplicate concurrent scans
    const { data: runningJobs } = await supabase
      .from('scan_jobs')
      .select('*')
      .eq('status', 'RUNNING')
      .gt('started_at', new Date(Date.now() - 3 * 60 * 1000).toISOString());

    if (runningJobs && runningJobs.length > 0) {
      return res.status(200).json({
        success: false,
        error: "A scan is already in progress.",
        jobId: runningJobs[0].id,
        status: "RUNNING"
      });
    }

    // 2. Create scan job record
    const { data: job, error: jobErr } = await supabase
      .from('scan_jobs')
      .insert({
        status: 'RUNNING',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobErr) console.warn("Job record creation warning:", jobErr);
    const jobId = job ? job.id : ('job_' + Date.now());

    // 3. Connect to Google Drive API
    let driveService = null;
    let authError = null;

    try {
      driveService = getGoogleDriveService();
    } catch (authErr) {
      authError = authErr.message;
      console.warn("Google Drive Service initialization warning:", authErr.message);
    }

    // Diagnostic Counters
    let foldersFound = 0;
    let uniqueFolderIdsCount = 0;
    let filesFound = 0;
    let filesProcessed = 0;
    let resultsSaved = 0;
    let newEnterprisesCount = 0;
    let duplicateRecordsRemoved = 0;
    let legacyRecordsReconciled = 0;
    let possibleDuplicatesCount = 0;
    let staleRecordsArchived = 0;
    let humanReviewsPreservedCount = 0;

    // Load data.json identity map for resolving legacy/synthetic folder IDs
    const dataJsonMap = loadDataJsonFolderIdMap();

    let scannedParticipants = [];

    if (driveService) {
      // REAL GOOGLE DRIVE API ENUMERATION & CLOUD SCAN
      const gdriveFolders = await listChildFolders(driveService, MASTER_FOLDER_ID);
      foldersFound = gdriveFolders.length;

      // Ensure stable enterprise identity by folder ID
      const folderMap = new Map();
      gdriveFolders.forEach(f => {
        if (!folderMap.has(f.id)) {
          folderMap.set(f.id, f);
        }
      });
      uniqueFolderIdsCount = folderMap.size;

      // Check near-duplicate folder names across DIFFERENT folder IDs for diagnostic flagging
      const normNameSet = new Map();
      folderMap.forEach((folder, folderId) => {
        const norm = normalizeNameForComparison(folder.name);
        if (normNameSet.has(norm)) {
          possibleDuplicatesCount++;
        } else {
          normNameSet.set(norm, folderId);
        }
      });

      // Get existing scan_results to check for new enterprises & legacy records
      const { data: existingScanData } = await supabase.from('scan_results').select('enterprise_folder_id, enterprise_id');
      const existingFolderIds = new Set((existingScanData || []).map(r => r.enterprise_folder_id || r.enterprise_id));

      const folderEntries = Array.from(folderMap.entries());
      const BATCH_SIZE = 5;

      for (let i = 0; i < folderEntries.length; i += BATCH_SIZE) {
        const batch = folderEntries.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ([folderId, folder]) => {
          const entId = deriveEnterpriseId(folder.name);
          const isNew = !existingFolderIds.has(folderId) && !existingFolderIds.has(entId);
          if (isNew) newEnterprisesCount++;

          console.log(`[FOLDER_DIAG] PROCESSING: name="${folder.name}" id="${folderId}" entId="${entId}" isNew=${isNew}`);

          const files = await listFilesInFolder(driveService, folderId);
          filesFound += files.length;
          filesProcessed += files.length;

          console.log(`[FOLDER_DIAG]   Files in folder: ${files.length}`);
          files.forEach(f => {
            console.log(`[FOLDER_DIAG]     File: "${f.name}" mimeType="${f.mimeType}" size="${f.size}" id="${f.id}"`);
          });

          const applicantType = determineApplicantType(folder.name, files);
          const reqs = processFilesForRequirements(files, applicantType);

          console.log(`[FOLDER_DIAG]   applicantType=${applicantType}`);

          scannedParticipants.push({
            enterpriseFolderId: folderId,
            id: entId,
            name: folder.name,
            applicantType: applicantType,
            driveUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folderId}`,
            driveFolderId: folderId,
            requirements: reqs
          });
        }));
      }

      console.log(`[FOLDER_DIAG] SCAN COMPLETE: ${scannedParticipants.length} enterprises processed from ${folderMap.size} unique folders (from ${gdriveFolders.length} raw API results)`);
    }

    // CRITICAL: If Google Drive is unavailable or returned 0 folders, FAIL EXPLICITLY
    // Do NOT generate fake data. Do NOT overwrite existing scan_results.
    if (!driveService) {
      const errorMsg = "Google Drive scanner unavailable: Google Drive API credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON in Vercel environment variables.";
      console.error(errorMsg);

      if (job) {
        await supabase
          .from('scan_jobs')
          .update({
            status: 'FAILED',
            completed_at: new Date().toISOString(),
            folders_found: 0,
            unique_enterprise_folders: 0,
            files_found: 0,
            files_processed: 0,
            results_saved: 0,
            error_message: errorMsg
          })
          .eq('id', job.id);
      }

      return res.status(200).json({
        success: false,
        jobId: jobId,
        status: "FAILED",
        error: errorMsg,
        foldersFound: 0,
        filesFound: 0,
        resultsSaved: 0
      });
    }

    if (foldersFound === 0) {
      const errorMsg = `Google Drive scan found 0 enterprise folders under master folder ${MASTER_FOLDER_ID}. Verify the master folder ID is correct and the service account has access.`;
      console.error(errorMsg);

      if (job) {
        await supabase
          .from('scan_jobs')
          .update({
            status: 'FAILED',
            completed_at: new Date().toISOString(),
            folders_found: 0,
            unique_enterprise_folders: 0,
            files_found: 0,
            files_processed: 0,
            results_saved: 0,
            error_message: errorMsg
          })
          .eq('id', job.id);
      }

      return res.status(200).json({
        success: false,
        jobId: jobId,
        status: "FAILED",
        error: errorMsg,
        foldersFound: 0,
        filesFound: 0,
        resultsSaved: 0
      });
    }

    // 4. Reconcile Legacy DB Records & Idempotent Upsert to Supabase scan_results
    // Only reached when we have REAL Google Drive data
    const validFolderIds = new Set(scannedParticipants.map(p => p.enterpriseFolderId));

    // A. Reconcile Human Reviews to point to enterprise_folder_id
    const { data: humanRevs } = await supabase.from('human_reviews').select('*');
    if (humanRevs && humanRevs.length > 0) {
      humanReviewsPreservedCount = humanRevs.length;
      for (const rev of humanRevs) {
        const resolvedFolderId = resolveToRealFolderId(
          rev.enterprise_folder_id, rev.enterprise_id, null, dataJsonMap
        );
        if (resolvedFolderId && resolvedFolderId !== rev.enterprise_folder_id) {
          await supabase
            .from('human_reviews')
            .update({ enterprise_folder_id: resolvedFolderId })
            .eq('id', rev.id);
          legacyRecordsReconciled++;
        } else if (!rev.enterprise_folder_id && resolvedFolderId) {
          await supabase
            .from('human_reviews')
            .update({ enterprise_folder_id: resolvedFolderId })
            .eq('id', rev.id);
          legacyRecordsReconciled++;
        }
      }
    }

    // B. Reconcile Human Review History logs
    const { data: humanHist } = await supabase.from('human_review_history').select('*');
    if (humanHist && humanHist.length > 0) {
      for (const hist of humanHist) {
        const resolvedFolderId = resolveToRealFolderId(
          hist.enterprise_folder_id, hist.enterprise_id, null, dataJsonMap
        );
        if (resolvedFolderId && resolvedFolderId !== hist.enterprise_folder_id) {
          await supabase
            .from('human_review_history')
            .update({ enterprise_folder_id: resolvedFolderId })
            .eq('id', hist.id);
        } else if (!hist.enterprise_folder_id && resolvedFolderId) {
          await supabase
            .from('human_review_history')
            .update({ enterprise_folder_id: resolvedFolderId })
            .eq('id', hist.id);
        }
      }
    }

    // C. Reconcile existing scan_results with synthetic/legacy folder IDs
    const { data: existingResults } = await supabase.from('scan_results').select('id, enterprise_folder_id, enterprise_id, enterprise_name');
    if (existingResults && existingResults.length > 0) {
      for (const row of existingResults) {
        if (!isRealGoogleDriveId(row.enterprise_folder_id)) {
          const resolvedFolderId = resolveToRealFolderId(
            row.enterprise_folder_id, row.enterprise_id, row.enterprise_name, dataJsonMap
          );
          if (resolvedFolderId && resolvedFolderId !== row.enterprise_folder_id) {
            await supabase
              .from('scan_results')
              .update({ enterprise_folder_id: resolvedFolderId })
              .eq('id', row.id);
            legacyRecordsReconciled++;
          }
        }
      }
    }

    // D. Upsert Current Scan Results
    const scanResultsToUpsert = [];
    scannedParticipants.forEach(p => {
      const folderId = p.enterpriseFolderId;
      Object.keys(CANONICAL_REQUIREMENTS).forEach(reqKey => {
        const doc = (p.requirements && p.requirements[reqKey]) ? p.requirements[reqKey] : { status: "MISSING", files: [] };
        const topFile = doc.files && doc.files.length > 0 ? doc.files[0] : null;

        scanResultsToUpsert.push({
          enterprise_folder_id: folderId,
          enterprise_id: p.id,
          enterprise_name: p.name,
          applicant_type: p.applicantType || "INDIVIDUAL",
          requirement_id: reqKey,
          file_id: topFile ? (topFile.fileId || topFile.id || "") : "",
          file_name: topFile ? topFile.name : "",
          automated_status: doc.automatedStatus || doc.status || "MISSING",
          confidence: topFile ? (topFile.confidence || 0.0) : 0.0,
          document_type: CANONICAL_REQUIREMENTS[reqKey].name,
          drive_url: p.driveUrl || `https://drive.google.com/drive/folders/${folderId}`,
          matched_files: doc.files || [],
          scanned_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      });
    });

    if (scanResultsToUpsert.length > 0) {
      const { error: upsertErr } = await supabase
        .from('scan_results')
        .upsert(scanResultsToUpsert, { onConflict: 'enterprise_folder_id,requirement_id' });

      if (upsertErr) console.warn("Scan results upsert warning:", upsertErr);
      resultsSaved = scanResultsToUpsert.length;
    }

    // NOTE: Stale row deletion removed for safety.
    // A successful scan upserts new data. Orphaned rows from deleted folders
    // are handled by reconciliation, not deletion.

    // 5. Update scan_jobs record with status COMPLETED and safe diagnostic metrics
    if (job) {
      await supabase
        .from('scan_jobs')
        .update({
          status: 'COMPLETED',
          completed_at: new Date().toISOString(),
          folders_found: foldersFound,
          unique_enterprise_folders: uniqueFolderIdsCount,
          files_found: filesFound,
          files_processed: filesProcessed,
          files_total: filesProcessed,
          results_saved: resultsSaved,
          duplicate_records_consolidated: duplicateRecordsRemoved,
          possible_duplicates: possibleDuplicatesCount,
          new_enterprises_found: newEnterprisesCount,
          error_message: authError || null
        })
        .eq('id', job.id);
    }

    return res.status(200).json({
      success: true,
      jobId: jobId,
      status: "COMPLETED",
      foldersFound: foldersFound,
      uniqueEnterpriseFolders: uniqueFolderIdsCount,
      filesFound: filesFound,
      filesProcessed: filesProcessed,
      resultsSaved: resultsSaved,
      duplicateRecordsRemoved: duplicateRecordsRemoved,
      legacyRecordsReconciled: legacyRecordsReconciled,
      possibleDuplicateNames: possibleDuplicatesCount,
      staleRecordsArchived: staleRecordsArchived,
      humanReviewsPreserved: humanReviewsPreservedCount,
      scannedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error("Cloud scan failed:", err);

    if (job && job.id) {
      try {
        await supabase
          .from('scan_jobs')
          .update({
            status: 'FAILED',
            completed_at: new Date().toISOString(),
            error_message: err.message || "Cloud scan error occurred."
          })
          .eq('id', job.id);
      } catch (e) {}
    }

    return res.status(200).json({
      success: false,
      jobId: jobId,
      status: "FAILED",
      error: err.message || "Cloud scan error occurred."
    });
  }
};

function getGoogleDriveService() {
  const serviceAccountEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_API_KEY;

  if (serviceAccountEnv) {
    let serviceAccountJson = null;
    try {
      serviceAccountJson = JSON.parse(serviceAccountEnv);
    } catch (e) {
      const decoded = Buffer.from(serviceAccountEnv, 'base64').toString('utf8');
      serviceAccountJson = JSON.parse(decoded);
    }

    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountJson,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    return google.drive({ version: 'v3', auth });
  } else if (apiKey) {
    return google.drive({ version: 'v3', auth: apiKey });
  }
  return null;
}

async function listChildFolders(drive, rootFolderId) {
  let folders = [];
  let pageToken = null;
  let pageNum = 0;

  console.log(`[FOLDER_DIAG] listChildFolders called: rootFolderId=${rootFolderId}`);

  do {
    pageNum++;
    const res = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, webViewLink, createdTime, mimeType)',
      pageSize: 100,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const pageFiles = (res.data && res.data.files) ? res.data.files : [];
    console.log(`[FOLDER_DIAG] Page ${pageNum}: returned ${pageFiles.length} folders, nextPageToken=${res.data.nextPageToken ? 'exists' : 'null'}`);

    pageFiles.forEach((f, i) => {
      console.log(`[FOLDER_DIAG]   Folder #${folders.length + i + 1}: name="${f.name}" id="${f.id}" mimeType="${f.mimeType}" createdTime="${f.createdTime}"`);
    });

    if (res.data && res.data.files) {
      folders.push(...res.data.files);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`[FOLDER_DIAG] Total folders returned by Google Drive API: ${folders.length}`);

  // Log all returned folder IDs for easy comparison
  const idList = folders.map(f => `"${f.name}" -> ${f.id}`).join('\n');
  console.log(`[FOLDER_DIAG] All returned folders:\n${idList}`);

  return folders;
}

async function listFilesInFolder(drive, folderId) {
  let files = [];
  let pageToken = null;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime)',
      pageSize: 100,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (res.data && res.data.files) {
      files.push(...res.data.files);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files;
}

function deriveEnterpriseId(folderName) {
  let clean = folderName.replace(/^\d+[\.\s_\-]*/, '').trim();
  clean = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || ('ent_' + Date.now());
}

function normalizeNameForComparison(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

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

function loadDataJsonFolderIdMap() {
  const map = { byId: {}, byName: {}, bySlug: {}, byNormalizedId: {}, byNormalizedName: {} };
  try {
    const fs = require('fs');
    const path = require('path');
    const dataPath = path.join(process.cwd(), 'data.json');
    if (fs.existsSync(dataPath)) {
      const dataJson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (dataJson.participants) {
        dataJson.participants.forEach(p => {
          const folderId = p.driveFolderId || p.enterpriseFolderId;
          if (folderId && isRealGoogleDriveId(folderId)) {
            map.byId[p.id] = folderId;
            map.byName[p.name.toLowerCase().trim()] = folderId;
            if (p.driveFolderId) map.bySlug[p.driveFolderId] = folderId;
            map.byNormalizedId[normalizeIdentityKey(p.id)] = folderId;
            map.byNormalizedName[normalizeIdentityKey(p.name)] = folderId;
          }
        });
      }
    }
  } catch (e) {
    console.warn("Could not load data.json for identity resolution:", e.message);
  }
  return map;
}

function resolveToRealFolderId(folderId, enterpriseId, enterpriseName, dataJsonMap) {
  if (folderId && isRealGoogleDriveId(folderId)) return folderId;
  if (enterpriseId && MANUAL_FOLDER_ID_MAP[enterpriseId]) return MANUAL_FOLDER_ID_MAP[enterpriseId];
  if (enterpriseName && MANUAL_FOLDER_ID_MAP[enterpriseName.toLowerCase().trim()]) {
    return MANUAL_FOLDER_ID_MAP[enterpriseName.toLowerCase().trim()];
  }
  if (enterpriseId && dataJsonMap.byId[enterpriseId]) return dataJsonMap.byId[enterpriseId];
  if (enterpriseName && dataJsonMap.byName[enterpriseName.toLowerCase().trim()]) {
    return dataJsonMap.byName[enterpriseName.toLowerCase().trim()];
  }
  const normId = normalizeIdentityKey(enterpriseId);
  if (normId && dataJsonMap.byNormalizedId[normId]) return dataJsonMap.byNormalizedId[normId];
  const normName = normalizeIdentityKey(enterpriseName);
  if (normName && dataJsonMap.byNormalizedName[normName]) return dataJsonMap.byNormalizedName[normName];
  return folderId;
}

function normalizeIdentityKey(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function determineApplicantType(folderName, files) {
  const normFolder = folderName.toLowerCase();
  if (normFolder.includes("group") || normFolder.includes("association") || normFolder.includes("coop") || normFolder.includes("corp")) {
    return "GROUP";
  }
  for (const f of files) {
    const fn = f.name.toLowerCase();
    if (fn.includes("declaration of intent") || fn.includes("intent declaration")) {
      return "GROUP";
    }
  }
  return "INDIVIDUAL";
}

function processFilesForRequirements(files, applicantType) {
  const reqs = {};

  // Check bmcFinancials BEFORE businessModelCanvas to avoid false positives
  const reqKeyOrder = [
    "applicationLetter", "applicationForm", "bmcFinancials", "businessModelCanvas",
    "financialFigures", "validId", "swornStatement", "proofOfResidency",
    "endorsementLetter", "photo2x2", "signatures", "declarationOfIntent"
  ];

  const fileAssignments = new Map();

  for (const reqKey of reqKeyOrder) {
    const reqDef = CANONICAL_REQUIREMENTS[reqKey];
    const matchedFiles = [];

    files.forEach(f => {
      if (fileAssignments.has(f.id) && fileAssignments.get(f.id) === reqKey) return;

      const fnNorm = f.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      let matched = false;
      let matchSource = "";

      // Layer 1: Filename aliases (highest confidence)
      const aliasKey = fnNorm;
      if (FILENAME_ALIASES[aliasKey] === reqKey) {
        matched = true;
        matchSource = "ALIAS_EXACT";
      }

      // Layer 2: Keyword matching
      if (!matched) {
        for (const kw of reqDef.keywords) {
          const kwNorm = kw.toLowerCase();
          if (kwNorm.length <= 3) {
            const pattern = new RegExp(`\\b${kwNorm.replace(/[^a-z0-9]/g, '')}\\b`, 'i');
            if (pattern.test(fnNorm)) {
              matched = true;
              matchSource = "FILENAME_KEYWORD";
              break;
            }
          } else {
            if (fnNorm.includes(kwNorm)) {
              matched = true;
              matchSource = "FILENAME_KEYWORD";
              break;
            }
          }
        }
      }

      // Layer 3: MIME-type awareness
      if (!matched && f.mimeType) {
        const mime = f.mimeType.toLowerCase();
        if (reqKey === "validId" && (mime.includes("image/") || mime === "application/pdf")) {
          const hasIdHint = /\b(id|passport|license|valid|philid|umid|voter|postal|prc|driver|philhealth|sss)\b/i.test(fnNorm);
          if (hasIdHint) {
            matched = true;
            matchSource = "MIME_TYPE_HINT";
          }
        }
        if (reqKey === "photo2x2" && mime.startsWith("image/")) {
          const hasPhotoHint = /\b(photo|picture|headshot|2x2)\b/i.test(fnNorm);
          if (hasPhotoHint) {
            matched = true;
            matchSource = "MIME_TYPE_HINT";
          }
        }
      }

      if (matched) {
        const confidence = matchSource === "ALIAS_EXACT" ? 0.95 :
                          matchSource === "FILENAME_KEYWORD" ? 0.92 :
                          matchSource === "MIME_TYPE_HINT" ? 0.7 : 0.85;
        matchedFiles.push({
          fileId: f.id,
          name: f.name,
          confidence: confidence,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          detectionMethod: matchSource,
          size: parseInt(f.size || '0', 10)
        });
        fileAssignments.set(f.id, reqKey);
      }
    });

    let status = "MISSING";
    if (matchedFiles.length > 0) {
      const topMatch = matchedFiles[0];
      if (reqKey === "photo2x2" || reqKey === "signatures") {
        status = "NEEDS_REVIEW";
      } else if (reqKey === "validId") {
        status = topMatch.confidence >= 0.85 ? "COMPLETE" : "NEEDS_REVIEW";
      } else if (matchedFiles.length > 1) {
        status = "NEEDS_REVIEW";
      } else {
        status = "COMPLETE";
      }
    } else if (reqKey === "declarationOfIntent" && applicantType === "INDIVIDUAL") {
      status = "NOT_APPLICABLE";
    }

    reqs[reqKey] = {
      status: status,
      automatedStatus: status,
      files: matchedFiles
    };
  }

  return reqs;
}
