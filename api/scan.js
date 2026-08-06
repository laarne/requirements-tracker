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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Scan-Request-ID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const reqId = req.headers['x-scan-request-id'] || (req.body && req.body.requestId) || ('req_' + Date.now());

  const supabaseUrl = process.env.SUPABASE_URL || "https://gndnmbdzfoamtgjkvnyr.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_zojIDwrTmNXHQLWuOhm7yQ_2pIvgypM";

  const supabase = createClient(supabaseUrl, supabaseKey);

  let jobId = 'job_' + Date.now();
  let job = null;
  let currentStage = 'INIT';

  try {
    console.log(`[SCAN] [${jobId}] Started (reqId: ${reqId}) - Stage: ${currentStage}`);

    // 1. Idempotency Check: Recent scan with exact request_id
    if (reqId) {
      const { data: recentJob } = await supabase
        .from('scan_jobs')
        .select('*')
        .eq('request_id', reqId)
        .gt('created_at', new Date(Date.now() - 60 * 1000).toISOString())
        .maybeSingle();

      if (recentJob) {
        console.log(`[SCAN] [${jobId}] Idempotent request matched recent job: ${recentJob.id}`);
        return res.status(200).json({
          success: recentJob.status === 'COMPLETED',
          jobId: recentJob.id,
          status: recentJob.status,
          idempotent: true
        });
      }
    }

    // 2. Rate-limiting & Stale Job Recovery: Prevent concurrent scans
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: runningJobs } = await supabase
      .from('scan_jobs')
      .select('*')
      .eq('status', 'RUNNING');

    if (runningJobs && runningJobs.length > 0) {
      const activeJob = runningJobs[0];
      if (activeJob.started_at < fifteenMinsAgo) {
        // Recover stale job
        console.warn(`[SCAN] Recovering stale abandoned job: ${activeJob.id}`);
        await supabase
          .from('scan_jobs')
          .update({ status: 'FAILED', error_message: 'Stale scan job abandoned after 15 minutes timeout.' })
          .eq('id', activeJob.id);
      } else {
        console.log(`[SCAN] [${jobId}] Concurrent scan prevented - active job: ${activeJob.id}`);
        return res.status(409).json({
          success: false,
          errorCode: "SCAN_ALREADY_RUNNING",
          error: "A Google Drive scan is already in progress.",
          jobId: activeJob.id,
          status: "RUNNING"
        });
      }
    }

    // 3. Create scan job record with request_id
    currentStage = 'JOB_CREATION';
    const { data: jobData, error: jobErr } = await supabase
      .from('scan_jobs')
      .insert({
        status: 'RUNNING',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobErr) console.warn("[SCAN] Job record creation warning:", jobErr.message, jobErr);
    if (jobData) {
      job = jobData;
      jobId = jobData.id;
      console.log(`[SCAN] [${jobId}] Job record created.`);
    } else {
      console.warn(`[SCAN] Job record NOT created. Continuing with temp ID: ${jobId}`);
    }

    // 4. Connect to Google Drive API
    currentStage = 'AUTHENTICATION';
    console.log(`[SCAN] [${jobId}] Google Drive authentication - Connecting to Google Drive API...`);
    let driveService = null;
    let authError = null;

    try {
      driveService = getGoogleDriveService();
    } catch (authErr) {
      authError = authErr.message;
      console.warn("[SCAN] Google Drive Service initialization warning:", authErr.message);
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

    const dataJsonMap = loadDataJsonFolderIdMap();
    let scannedParticipants = [];

    if (!driveService) {
      const errInfo = classifyGoogleError(new Error(authError || "Google Drive API credentials missing"));
      console.error(`[SCAN ERROR] [${jobId}] Stage: ${currentStage}, ErrorCode: ${errInfo.code}, Error: ${errInfo.message}`);

      if (job && job.id) {
        try {
          await supabase
            .from('scan_jobs')
            .update({ status: 'FAILED', completed_at: new Date().toISOString(), error_message: errInfo.message })
            .eq('id', job.id);
        } catch (e) {}
      }

      return res.status(200).json({
        success: false,
        jobId: jobId,
        status: "FAILED",
        stage: currentStage,
        errorCode: errInfo.code,
        error: errInfo.message,
        foldersFound: 0,
        filesFound: 0,
        resultsSaved: 0
      });
    }

    // 5. REAL GOOGLE DRIVE API ENUMERATION (WITH TRANSIENT RETRY)
    currentStage = 'ROOT_DISCOVERY';
    console.log(`[SCAN] [${jobId}] Root folder discovery - Master Folder: ${MASTER_FOLDER_ID}`);
    
    let gdriveFolders = [];
    try {
      gdriveFolders = await fetchWithRetry(() => listChildFolders(driveService, MASTER_FOLDER_ID));
    } catch (gErr) {
      const errInfo = classifyGoogleError(gErr);
      console.error(`[SCAN ERROR] [${jobId}] Stage: ${currentStage}, ErrorCode: ${errInfo.code}`);
      throw gErr;
    }

    foldersFound = gdriveFolders.length;

    if (foldersFound === 0) {
      const errInfo = classifyGoogleError(new Error(`Google Drive root folder query returned 0 folders for master ID ${MASTER_FOLDER_ID}`));
      console.error(`[SCAN ERROR] [${jobId}] Stage: ${currentStage}, Error: ${errInfo.message}`);

      if (job && job.id) {
        try {
          await supabase
            .from('scan_jobs')
            .update({ status: 'FAILED', completed_at: new Date().toISOString(), error_message: errInfo.message })
            .eq('id', job.id);
        } catch (e) {}
      }

      return res.status(200).json({
        success: false,
        jobId: jobId,
        status: "FAILED",
        stage: currentStage,
        errorCode: errInfo.code,
        error: errInfo.message,
        foldersFound: 0,
        filesFound: 0,
        resultsSaved: 0
      });
    }

    currentStage = 'FOLDER_ENUMERATION';
    console.log(`[SCAN] [${jobId}] Enterprise folder discovery - Found ${foldersFound} folders`);

    const folderMap = new Map();
    gdriveFolders.forEach(f => {
      if (!folderMap.has(f.id)) {
        folderMap.set(f.id, f);
      }
    });
    uniqueFolderIdsCount = folderMap.size;

    const normNameSet = new Map();
    folderMap.forEach((folder, folderId) => {
      const norm = normalizeNameForComparison(folder.name);
      if (normNameSet.has(norm)) {
        possibleDuplicatesCount++;
      } else {
        normNameSet.set(norm, folderId);
      }
    });

    const { data: existingScanData } = await supabase.from('scan_results').select('enterprise_folder_id, enterprise_id');
    const existingFolderIds = new Set((existingScanData || []).map(r => r.enterprise_folder_id || r.enterprise_id));

    currentStage = 'FILE_ENUMERATION_AND_CLASSIFICATION';
    console.log(`[SCAN] [${jobId}] File enumeration and document classification in progress...`);

    const folderEntries = Array.from(folderMap.entries());
    const BATCH_SIZE = 5;

    for (let i = 0; i < folderEntries.length; i += BATCH_SIZE) {
      const batch = folderEntries.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async ([folderId, folder]) => {
        const entId = deriveEnterpriseId(folder.name);
        const isNew = !existingFolderIds.has(folderId) && !existingFolderIds.has(entId);
        if (isNew) newEnterprisesCount++;

        let files = [];
        try {
          files = await fetchWithRetry(() => listFilesInFolder(driveService, folderId));
        } catch (fErr) {
          console.warn(`[SCAN WARNING] File enumeration failed for folder ${folder.name} (${folderId}):`, fErr.message);
        }

        filesFound += files.length;
        filesProcessed += files.length;

        const applicantType = determineApplicantType(folder.name, files);
        const reqs = processFilesForRequirements(files, applicantType);

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

    console.log(`[SCAN] [${jobId}] File processing complete - Scanned ${scannedParticipants.length} enterprises, ${filesProcessed} files.`);

    // STAGING RESULTS IN MEMORY (DO NOT COMMIT YET)
    currentStage = 'STAGING_RESULTS';
    console.log(`[SCAN] [${jobId}] Staging scan_results in memory...`);

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

    // INTEGRITY VALIDATION STEP BEFORE ANY DATABASE MUTATION
    currentStage = 'INTEGRITY_VALIDATION';
    console.log(`[SCAN] [${jobId}] Validating compliance dataset integrity...`);

    const integrity = validateScanIntegrity(scannedParticipants, scanResultsToUpsert);
    if (!integrity.valid) {
      throw new Error(`Integrity check failed: ${integrity.reason}`);
    }

    // DATABASE COMMIT STEP (ATOMIC MUTATION ONLY AFTER VALIDATION SUCCESS)
    currentStage = 'DATABASE_COMMIT';
    console.log(`[SCAN] [${jobId}] Committing ${scanResultsToUpsert.length} staged scan_results to Supabase...`);

    // Try PostgreSQL RPC function first for true server-side transaction
    let rpcCommitted = false;
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('commit_scan_snapshot', {
        p_job_id: jobId,
        p_scan_results: scanResultsToUpsert,
        p_folders_found: foldersFound,
        p_files_processed: filesProcessed,
        p_results_saved: scanResultsToUpsert.length
      });

      if (rpcErr) {
        console.warn(`[SCAN] [${jobId}] RPC commit_scan_snapshot returned error (function may not exist):`, rpcErr.message || JSON.stringify(rpcErr));
      } else if (rpcRes && rpcRes.success) {
        rpcCommitted = true;
        resultsSaved = scanResultsToUpsert.length;
        console.log(`[SCAN] [${jobId}] PostgreSQL RPC commit_scan_snapshot executed successfully.`);
      }
    } catch (e) {
      console.warn(`[SCAN] [${jobId}] PostgreSQL RPC threw exception (function may not exist):`, e.message);
    }

    // Fallback: Single-statement PostgreSQL array upsert (inherently 100% atomic in PostgreSQL)
    if (!rpcCommitted && scanResultsToUpsert.length > 0) {
      console.log(`[SCAN] [${jobId}] RPC not committed. Attempting direct upsert of ${scanResultsToUpsert.length} rows to scan_results...`);
      const { data: upsertData, error: upsertErr } = await supabase
        .from('scan_results')
        .upsert(scanResultsToUpsert, { onConflict: 'enterprise_folder_id,requirement_id' });

      if (upsertErr) {
        console.error(`[SCAN ERROR] [${jobId}] Direct upsert FAILED:`, JSON.stringify(upsertErr));
        throw new Error(`Supabase upsert failed: ${upsertErr.message} (code: ${upsertErr.code || 'N/A'}, details: ${upsertErr.details || 'N/A'})`);
      }
      resultsSaved = scanResultsToUpsert.length;
      console.log(`[SCAN] [${jobId}] Direct upsert succeeded: ${resultsSaved} rows saved.`);
    }

    currentStage = 'COMPLETED';
    console.log(`[SCAN] [${jobId}] Update scan_jobs status to COMPLETED`);

    if (job && job.id) {
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
    const errInfo = classifyGoogleError(err);
    console.error(`[SCAN ERROR] [${jobId}] Stage: ${currentStage}, ErrorCode: ${errInfo.code}, Error: ${errInfo.message}`);

    if (supabase && job && job.id) {
      try {
        await supabase
          .from('scan_jobs')
          .update({
            status: 'FAILED',
            completed_at: new Date().toISOString(),
            error_message: `Stage: ${currentStage} - ${errInfo.message}`
          })
          .eq('id', job.id);
      } catch (e) {}
    }

    return res.status(200).json({
      success: false,
      jobId: jobId,
      status: "FAILED",
      stage: currentStage,
      errorCode: errInfo.code,
      error: `Google Drive scan failed during ${currentStage.toLowerCase().replace(/_/g, ' ')}. ${errInfo.message}`
    });
  }
};

function classifyGoogleError(err) {
  const msg = (err && err.message) ? err.message : "";
  if (msg.includes("credentials") || msg.includes("GOOGLE_SERVICE_ACCOUNT") || msg.includes("DECODER") || msg.includes("crypto") || msg.includes("formatting error")) {
    return { code: "AUTHENTICATION_FAILURE", transient: false, message: `Google Drive authentication error: ${msg}` };
  }
  if (msg.includes("403") || msg.includes("permission") || msg.includes("access")) {
    return { code: "AUTHORIZATION_FAILURE", transient: false, message: "Access denied to configured Google Drive master folder." };
  }
  if (msg.includes("404") || msg.includes("not found")) {
    return { code: "DRIVE_NOT_FOUND", transient: false, message: "Configured Google Drive master folder not found." };
  }
  if (msg.includes("429") || msg.includes("rate") || msg.includes("quota")) {
    return { code: "GOOGLE_API_RATE_LIMIT", transient: true, message: "Google Drive API rate limit exceeded." };
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("timeout") || msg.includes("ECONNRESET")) {
    return { code: "GOOGLE_API_TIMEOUT", transient: true, message: "Google Drive API connection timed out." };
  }
  if (msg.includes("500") || msg.includes("502") || msg.includes("503")) {
    return { code: "GOOGLE_API_500", transient: true, message: "Google Drive API temporarily returned a server error." };
  }
  if (msg.includes("Integrity check failed") || msg.includes("integrity")) {
    return { code: "DATA_VALIDATION_ERROR", transient: false, message: msg };
  }
  if (msg.includes("commit") || msg.includes("database")) {
    return { code: "DATABASE_COMMIT_ERROR", transient: false, message: msg };
  }
  return { code: "UNKNOWN_ERROR", transient: false, message: msg || "Cloud scan error occurred." };
}

async function fetchWithRetry(fn, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const errInfo = classifyGoogleError(err);
      if (!errInfo.transient || attempt >= maxRetries) {
        throw err;
      }
      console.warn(`[SCAN RETRY] Transient error (${errInfo.code}), retrying attempt ${attempt}/${maxRetries} in ${attempt * 1000}ms...`);
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
}

function validateScanIntegrity(participants, scanResults) {
  if (!participants || participants.length === 0) {
    return { valid: false, reason: "No enterprise folders scanned." };
  }
  if (!scanResults || scanResults.length === 0) {
    return { valid: false, reason: "No scan results produced." };
  }

  for (const p of participants) {
    if (!p.enterpriseFolderId || !p.name || !p.applicantType) {
      return { valid: false, reason: `Enterprise ${p.name || 'unknown'} has missing required metadata.` };
    }
    if (!["INDIVIDUAL", "GROUP"].includes(p.applicantType.toUpperCase())) {
      return { valid: false, reason: `Enterprise ${p.name} has invalid applicant type ${p.applicantType}.` };
    }
    if (!p.requirements || Object.keys(p.requirements).length === 0) {
      return { valid: false, reason: `Enterprise ${p.name} has empty requirements checklist.` };
    }
  }

  return { valid: true };
}

function sanitizePrivateKey(key) {
  if (!key || typeof key !== 'string') return null;
  let cleanKey = key.trim();

  // 1. Strip wrapping outer quotes if present (double or single)
  while ((cleanKey.startsWith('"') && cleanKey.endsWith('"')) || (cleanKey.startsWith("'") && cleanKey.endsWith("'"))) {
    cleanKey = cleanKey.slice(1, -1).trim();
  }

  // 2. Unescape double/multiple backslash-n combinations: \\\\n, \\n, etc.
  cleanKey = cleanKey.replace(/\\+n/g, '\n');

  // 3. Remove Windows carriage returns \r
  cleanKey = cleanKey.replace(/\r/g, '');

  // 4. Remove literal escaped quotes \" or \' inside the string
  cleanKey = cleanKey.replace(/\\"/g, '"').replace(/\\'/g, "'");

  // 5. Clean up surrounding spaces on each PEM line
  cleanKey = cleanKey.split('\n').map(line => line.trim()).join('\n').trim();

  return cleanKey;
}

function validatePrivateKeyFormat(privateKey) {
  if (!privateKey) {
    return { valid: false, reason: "Private key string is null or empty." };
  }

  const hasBegin = privateKey.includes("-----BEGIN PRIVATE KEY-----") || privateKey.includes("-----BEGIN RSA PRIVATE KEY-----");
  const hasEnd = privateKey.includes("-----END PRIVATE KEY-----") || privateKey.includes("-----END RSA PRIVATE KEY-----");

  if (!hasBegin || !hasEnd) {
    return { valid: false, reason: `Private key missing PEM headers (BEGIN: ${hasBegin}, END: ${hasEnd}).` };
  }

  try {
    const crypto = require('crypto');
    const keyObj = crypto.createPrivateKey(privateKey);
    return { valid: true, type: keyObj.type, asymmetricKeyType: keyObj.asymmetricKeyType, reason: "PrivateKey parsed successfully by Node.js crypto engine." };
  } catch (err) {
    return { valid: false, reason: `Node.js crypto.createPrivateKey failed: ${err.message}` };
  }
}

function analyzeKeyDetails(rawKey) {
  if (rawKey === undefined || rawKey === null) {
    return { status: "MISSING", length: 0, firstLine: "MISSING", lastLine: "MISSING", beginCount: 0, endCount: 0, hasEscapedN: false, cryptoReason: "Key missing" };
  }

  const clean = sanitizePrivateKey(rawKey);
  if (!clean || clean.length === 0) {
    return { status: "EMPTY", length: 0, firstLine: "MISSING", lastLine: "MISSING", beginCount: 0, endCount: 0, hasEscapedN: false, cryptoReason: "Key empty" };
  }

  const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const firstLine = lines.length > 0 ? lines[0] : "";
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";

  let firstLineClass = "OTHER";
  if (firstLine.includes("BEGIN PRIVATE KEY")) firstLineClass = "BEGIN PRIVATE KEY";
  else if (firstLine.includes("BEGIN RSA PRIVATE KEY")) firstLineClass = "BEGIN RSA PRIVATE KEY";
  else if (lines.length === 0) firstLineClass = "MISSING";

  let lastLineClass = "OTHER";
  if (lastLine.includes("END PRIVATE KEY")) lastLineClass = "END PRIVATE KEY";
  else if (lastLine.includes("END RSA PRIVATE KEY")) lastLineClass = "END RSA PRIVATE KEY";
  else if (lines.length === 0) lastLineClass = "MISSING";

  const beginCount = (clean.match(/-----BEGIN/g) || []).length;
  const endCount = (clean.match(/-----END/g) || []).length;
  const hasEscapedN = clean.includes('\\n');

  const val = validatePrivateKeyFormat(clean);
  const status = val.valid ? "PRESENT_VALID_FORMAT" : "PRESENT_INVALID_FORMAT";

  return {
    status,
    valid: val.valid,
    length: clean.length,
    firstLine: firstLineClass,
    lastLine: lastLineClass,
    beginCount,
    endCount,
    hasEscapedN,
    cryptoReason: val.reason
  };
}

function analyzeKeyStatus(rawKey) {
  return analyzeKeyDetails(rawKey).status;
}

function analyzeEmailStatus(email) {
  if (email === undefined) return "MISSING";
  if (email === null || (typeof email === 'string' && email.trim().length === 0)) return "EMPTY";
  return "PRESENT";
}

function findPrivateKeyInObject(obj) {
  if (!obj || typeof obj !== 'object') return { rawKey: undefined, path: null };

  for (const prop of ["private_key", "privateKey", "key", "secret_key"]) {
    if (prop in obj) {
      return { rawKey: obj[prop], path: prop };
    }
  }

  for (const parent of ["credentials", "gdrive", "service_account", "google"]) {
    if (obj[parent] && typeof obj[parent] === 'object') {
      const nested = findPrivateKeyInObject(obj[parent]);
      if (nested.path) {
        return { rawKey: nested.rawKey, path: `${parent}.${nested.path}` };
      }
    }
  }

  return { rawKey: undefined, path: null };
}

function findClientEmailInObject(obj) {
  if (!obj || typeof obj !== 'object') return { rawEmail: undefined, path: null };

  for (const prop of ["client_email", "clientEmail", "email", "userEmail"]) {
    if (prop in obj) {
      return { rawEmail: obj[prop], path: prop };
    }
  }

  for (const parent of ["credentials", "gdrive", "service_account", "google"]) {
    if (obj[parent] && typeof obj[parent] === 'object') {
      const nested = findClientEmailInObject(obj[parent]);
      if (nested.path) {
        return { rawEmail: nested.rawEmail, path: `${parent}.${nested.path}` };
      }
    }
  }

  return { rawEmail: undefined, path: null };
}

function analyzeCredentials(env) {
  const serviceAccountEnv = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const clientEmailEnv = env.GOOGLE_CLIENT_EMAIL || env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyEnv = env.GOOGLE_PRIVATE_KEY || env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const apiKey = env.GOOGLE_DRIVE_API_KEY || env.GOOGLE_API_KEY;

  let jsonAnalysis = {
    envPresent: Boolean(serviceAccountEnv),
    parsed: false,
    topLevelKeys: [],
    privateKeyStatus: "MISSING",
    clientEmailStatus: "MISSING",
    keyDetails: analyzeKeyDetails(undefined),
    cryptoReason: "JSON not provided"
  };

  let parsedJson = null;
  if (serviceAccountEnv) {
    try {
      parsedJson = JSON.parse(serviceAccountEnv);
      jsonAnalysis.parsed = true;
    } catch (e) {
      try {
        const decoded = Buffer.from(serviceAccountEnv, 'base64').toString('utf8');
        parsedJson = JSON.parse(decoded);
        jsonAnalysis.parsed = true;
      } catch (b64Err) {}
    }

    if (parsedJson && typeof parsedJson === 'object') {
      jsonAnalysis.topLevelKeys = Object.keys(parsedJson);
      const { rawKey } = findPrivateKeyInObject(parsedJson);
      const { rawEmail } = findClientEmailInObject(parsedJson);

      jsonAnalysis.keyDetails = analyzeKeyDetails(rawKey);
      jsonAnalysis.privateKeyStatus = jsonAnalysis.keyDetails.status;
      jsonAnalysis.clientEmailStatus = analyzeEmailStatus(rawEmail);
      jsonAnalysis.cryptoReason = jsonAnalysis.keyDetails.cryptoReason;
    }
  }

  const sepKeyDetails = analyzeKeyDetails(privateKeyEnv);

  let sepAnalysis = {
    clientEmailStatus: analyzeEmailStatus(clientEmailEnv),
    privateKeyStatus: sepKeyDetails.status,
    keyDetails: sepKeyDetails,
    cryptoReason: sepKeyDetails.cryptoReason
  };

  let selectedCreds = null;
  let authSource = "NONE";

  if (jsonAnalysis.privateKeyStatus === "PRESENT_VALID_FORMAT") {
    authSource = "GOOGLE_SERVICE_ACCOUNT_JSON";
    const { rawKey } = findPrivateKeyInObject(parsedJson);
    const { rawEmail } = findClientEmailInObject(parsedJson);
    selectedCreds = {
      client_email: (rawEmail || "").trim(),
      private_key: sanitizePrivateKey(rawKey)
    };
  } else if (sepAnalysis.privateKeyStatus === "PRESENT_VALID_FORMAT") {
    authSource = "GOOGLE_CLIENT_EMAIL_AND_PRIVATE_KEY";
    selectedCreds = {
      client_email: (clientEmailEnv || "").trim(),
      private_key: sanitizePrivateKey(privateKeyEnv)
    };
  }

  return { selectedCreds, apiKey: !selectedCreds ? apiKey : null, jsonAnalysis, sepAnalysis, authSource };
}

function getGoogleDriveService() {
  const diag = analyzeCredentials(process.env);
  const activeKeyDetails = diag.jsonAnalysis.envPresent ? diag.jsonAnalysis.keyDetails : diag.sepAnalysis.keyDetails;

  console.log(`[SCAN AUTH DIAGNOSTIC]
    - Selected Source: ${diag.authSource}
    - GOOGLE_SERVICE_ACCOUNT_JSON present: ${diag.jsonAnalysis.envPresent} (Parsed: ${diag.jsonAnalysis.parsed})
    - JSON top-level keys: [${diag.jsonAnalysis.topLevelKeys.join(", ")}]
    - JSON private_key status: ${diag.jsonAnalysis.privateKeyStatus}
    - JSON client_email status: ${diag.jsonAnalysis.clientEmailStatus}
    - Separate client_email status: ${diag.sepAnalysis.clientEmailStatus}
    - Separate private_key status: ${diag.sepAnalysis.privateKeyStatus}
    - Sanitized Key Length: ${activeKeyDetails.length}
    - First Line Class: ${activeKeyDetails.firstLine}
    - Last Line Class: ${activeKeyDetails.lastLine}
    - BEGIN Markers: ${activeKeyDetails.beginCount} | END Markers: ${activeKeyDetails.endCount}
    - Has Literal \\n: ${activeKeyDetails.hasEscapedN}
    - Crypto Parse Result: ${diag.selectedCreds ? 'OK' : activeKeyDetails.cryptoReason}
  `);

  if (diag.selectedCreds) {
    const auth = new google.auth.GoogleAuth({
      credentials: diag.selectedCreds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    return google.drive({ version: 'v3', auth });
  } else if (diag.apiKey) {
    console.log("[SCAN AUTH DIAGNOSTIC] Source: GOOGLE_DRIVE_API_KEY (API Key Mode)");
    return google.drive({ version: 'v3', auth: diag.apiKey });
  }

  const diagSummary = `Selected Source: ${diag.authSource} | JSON Keys: [${diag.jsonAnalysis.topLevelKeys.join(", ")}] | Key Status: ${diag.jsonAnalysis.privateKeyStatus} | Key Length: ${activeKeyDetails.length} | FirstLine: ${activeKeyDetails.firstLine} | LastLine: ${activeKeyDetails.lastLine} | BEGINs: ${activeKeyDetails.beginCount} | ENDs: ${activeKeyDetails.endCount} | EscapedN: ${activeKeyDetails.hasEscapedN} | CryptoReason: ${activeKeyDetails.cryptoReason}`;

  throw new Error(`Google Drive authentication failed: Service account private key is missing or invalid (${diagSummary}). Please configure a valid GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY in Vercel production environment variables.`);
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
  let allFiles = [];
  let foldersToProcess = [folderId];

  while (foldersToProcess.length > 0) {
    const currentFid = foldersToProcess.shift();

    // 1. Fetch files in current folder level
    let pageToken = null;
    do {
      const res = await drive.files.list({
        q: `'${currentFid}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime)',
        pageSize: 100,
        pageToken: pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      if (res.data && res.data.files) {
        allFiles.push(...res.data.files);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    // 2. Fetch nested subfolders inside current folder level
    pageToken = null;
    do {
      const res = await drive.files.list({
        q: `'${currentFid}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: 100,
        pageToken: pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      if (res.data && res.data.files) {
        res.data.files.forEach(sub => foldersToProcess.push(sub.id));
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  return allFiles;
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

function extractMemberAttribution(f) {
  if (f.folderPath) {
    const parts = f.folderPath.split('/').filter(Boolean);
    if (parts.length > 1) {
      const sub = parts[parts.length - 1].trim();
      const lower = sub.toLowerCase();
      if (sub && !["documents", "files", "requirements", "uncategorized", "root"].includes(lower)) {
        return { memberName: sub.toUpperCase(), memberSource: "folder" };
      }
    }
  }

  const fn = f.name || "";
  const matchParen = fn.match(/[\(\[]([A-Za-z0-9\s_\-]+)[\)\]]/);
  if (matchParen) {
    const candidate = matchParen[1].trim();
    const upper = candidate.toUpperCase();
    if (candidate && !["NEW", "PDF", "DOCX", "XLSX", "JPG", "PNG", "COPY", "UPDATED", "FINAL", "1PAGE"].includes(upper)) {
      return { memberName: upper, memberSource: "filename" };
    }
  }

  const matchSep = fn.match(/[\-_\s]+([A-Z]{3,15})$/i);
  if (matchSep) {
    const candidate = matchSep[1].trim();
    const upper = candidate.toUpperCase();
    if (candidate && !["NEW", "PDF", "DOCX", "XLSX", "JPG", "PNG", "COPY", "UPDATED", "FINAL"].includes(upper)) {
      return { memberName: upper, memberSource: "filename" };
    }
  }

  return { memberName: null, memberSource: "unknown" };
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
        const attr = extractMemberAttribution(f);
        matchedFiles.push({
          fileId: f.id,
          name: f.name,
          confidence: confidence,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          detectionMethod: matchSource,
          size: parseInt(f.size || '0', 10),
          memberName: attr.memberName,
          memberSource: attr.memberSource
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
      } else if (applicantType !== "GROUP" && matchedFiles.length > 1) {
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

module.exports.sanitizePrivateKey = sanitizePrivateKey;
module.exports.validatePrivateKeyFormat = validatePrivateKeyFormat;
module.exports.analyzeCredentials = analyzeCredentials;
module.exports.getGoogleDriveService = getGoogleDriveService;
module.exports.classifyGoogleError = classifyGoogleError;

